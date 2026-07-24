// Runtipi appstore (apps/<id>/{config.json, docker-compose.json|yml, metadata/logo.jpg})
// -> Dokploy blueprint shape.
//
// Prefer the structured docker-compose.json schema; fall back to the standard
// docker-compose.yml. Normalize Runtipi-isms: labels/networks stripped,
// host ports -> expose, ${APP_DATA_DIR} host paths -> named volumes, and every
// referenced ${VAR} (APP_DOMAIN, form-field secrets, …) defined in [config.env].
//
// Usage: node convert-runtipi.mjs <runtipiRepoDir> <outBlueprintsDir>
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import YAML from "yaml";
import { emitTemplateToml, slug, findGithub, findUrl, HANZO_FALLBACK_LOGO } from "./lib.mjs";

const [, , RT_DIR, OUT] = process.argv;
const APPS = join(RT_DIR, "apps");

const stats = { total: 0, written: 0, skipParse: 0, skipDup: 0, skipBuild: 0, skipNoService: 0, skipNoCompose: 0 };
const skipped = [];

function defineVar(name, formTypes) {
  const T = name.toUpperCase();
  if (T === "APP_DOMAIN" || T === "APP_HOST" || T === "DOMAIN") return "${main_domain}";
  if (T === "APP_URL" || /_URL$/.test(T)) return "https://${main_domain}";
  if (T === "APP_PROTOCOL") return "https";
  if (T === "APP_PORT") return "80";
  if (T === "APP_EXPOSED" || T === "APP_EXPOSED_LOCAL") return "true";
  if (T.startsWith("APP_DATA_DIR") || T === "RUNTIPI_APP_DATA_DIR" || T.startsWith("RUNTIPI")) return "";
  if (formTypes[name] === "password" || formTypes[name] === "text") {
    return formTypes[name] === "password" ? "${password:32}" : "";
  }
  if (formTypes[name] === "random") return "${hash:32}";
  if (/PASSWORD|PASSWD|SECRET|TOKEN|_KEY$|APIKEY|API_KEY|SALT|ENCRYPTION/.test(T)) return "${password:32}";
  if (/BASE64/.test(T)) return "${base64:32}";
  if (/USER$|USERNAME/.test(T)) return "${username}";
  return "";
}

// Convert a Runtipi volume host path to a named volume; returns "name:target".
function namedVol(id, containerPath, topVolumes) {
  const nm = slug(`${id}-${basename(containerPath) || "data"}`);
  topVolumes[nm] = {};
  return `${nm}:${containerPath}`;
}

function fromJsonSchema(schema, id, topVolumes) {
  const services = {};
  let webService = null, webPort = null;
  for (const s of schema.services || []) {
    if (!s?.image || !s?.name) return null; // build/malformed -> bail
    const name = slug(s.name);
    const svc = { image: s.image };
    if (s.command) svc.command = s.command;
    if (s.entrypoint) svc.entrypoint = s.entrypoint;
    if (s.user) svc.user = s.user;
    if (Array.isArray(s.environment)) {
      const em = {};
      for (const e of s.environment) if (e?.key) em[e.key] = e.value == null ? "" : String(e.value);
      if (Object.keys(em).length) svc.environment = em;
    } else if (s.environment && typeof s.environment === "object") svc.environment = s.environment;
    if (Array.isArray(s.dependsOn)) svc.depends_on = s.dependsOn.map(slug);
    else if (s.dependsOn && typeof s.dependsOn === "object") svc.depends_on = Object.fromEntries(Object.entries(s.dependsOn).map(([k, v]) => [slug(k), v]));
    const vols = [];
    for (const v of s.volumes || []) {
      if (v?.containerPath) vols.push(namedVol(id, v.containerPath, topVolumes));
    }
    if (vols.length) svc.volumes = vols;
    if (s.internalPort) svc.expose = [String(s.internalPort)];
    svc.restart = "always";
    services[name] = svc;
    if (s.isMain) { webService = name; webPort = s.internalPort ? Number.parseInt(s.internalPort, 10) : null; }
  }
  if (!Object.keys(services).length) return null;
  if (!webService) webService = Object.keys(services)[0];
  return { services, webService, webPort };
}

function fromYaml(doc, id, topVolumes) {
  const services = {};
  let webService = null, webPort = null;
  for (const [sName, srcRaw] of Object.entries(doc.services || {})) {
    if (!srcRaw?.image) return null;
    const name = slug(sName);
    const svc = { image: srcRaw.image };
    if (srcRaw.command !== undefined) svc.command = srcRaw.command;
    if (srcRaw.entrypoint !== undefined) svc.entrypoint = srcRaw.entrypoint;
    if (srcRaw.user !== undefined) svc.user = srcRaw.user;
    if (srcRaw.environment) svc.environment = srcRaw.environment;
    if (srcRaw.depends_on) {
      svc.depends_on = Array.isArray(srcRaw.depends_on) ? srcRaw.depends_on.map(slug)
        : Object.fromEntries(Object.entries(srcRaw.depends_on).map(([k, v]) => [slug(k), v]));
    }
    if (srcRaw.cap_add) svc.cap_add = srcRaw.cap_add;
    if (srcRaw.devices) svc.devices = srcRaw.devices;
    // ports -> expose
    const exposes = [];
    for (const p of srcRaw.ports || []) {
      if (typeof p === "string") { const t = p.split(":").pop().split("/")[0]; if (t && /^\d+$/.test(t)) exposes.push(t); }
      else if (p && typeof p === "object" && p.target != null) exposes.push(String(p.target));
    }
    if (exposes.length) { svc.expose = [...new Set(exposes)]; if (!webPort) { webPort = Number.parseInt(exposes[0], 10); webService = name; } }
    // volumes -> named
    const vols = [];
    for (const v of srcRaw.volumes || []) {
      if (typeof v === "string") {
        const parts = v.split(":");
        const tgt = parts[1] || parts[0];
        if (parts[0].includes("APP_DATA_DIR") || parts[0].startsWith("$")) vols.push(namedVol(id, tgt, topVolumes));
        else { vols.push(v); if (/^[a-zA-Z0-9]/.test(parts[0])) topVolumes[parts[0]] = {}; }
      } else if (v && typeof v === "object" && v.target) {
        vols.push(namedVol(id, v.target, topVolumes));
      }
    }
    if (vols.length) svc.volumes = vols;
    svc.restart = srcRaw.restart || "always";
    services[name] = svc; // labels + networks intentionally dropped
  }
  if (!Object.keys(services).length) return null;
  if (!webService) webService = Object.keys(services)[0];
  return { services, webService, webPort };
}

for (const dir of readdirSync(APPS, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("__")).map((d) => d.name).sort()) {
  stats.total++;
  const appDir = join(APPS, dir);
  let cfg = {};
  try { if (existsSync(join(appDir, "config.json"))) cfg = JSON.parse(readFileSync(join(appDir, "config.json"), "utf8")); } catch { /* tolerate */ }
  const id = slug(cfg.id || dir);
  const outDir = join(OUT, id);
  if (existsSync(outDir)) { stats.skipDup++; continue; }

  const formTypes = {};
  for (const f of cfg.form_fields || []) if (f?.env_variable) formTypes[f.env_variable] = f.type;

  const topVolumes = {};
  let built = null;
  try {
    if (existsSync(join(appDir, "docker-compose.json"))) {
      built = fromJsonSchema(JSON.parse(readFileSync(join(appDir, "docker-compose.json"), "utf8")), id, topVolumes);
    }
    if (!built && existsSync(join(appDir, "docker-compose.yml"))) {
      built = fromYaml(YAML.parse(readFileSync(join(appDir, "docker-compose.yml"), "utf8")), id, topVolumes);
    }
  } catch { stats.skipParse++; skipped.push([id, "parse"]); continue; }
  if (!built) { if (!existsSync(join(appDir, "docker-compose.json")) && !existsSync(join(appDir, "docker-compose.yml"))) { stats.skipNoCompose++; } else { stats.skipBuild++; skipped.push([id, "build-or-noservice"]); } continue; }

  const compose = { services: built.services };
  if (Object.keys(topVolumes).length) compose.volumes = topVolumes;

  const blob = JSON.stringify(compose);
  const env = {};
  for (const m of blob.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
    const name = m[1];
    if (env[name] !== undefined) continue;
    env[name] = defineVar(name, formTypes);
  }

  let composeYml;
  try { composeYml = YAML.stringify(compose, { lineWidth: 0 }); }
  catch { stats.skipParse++; skipped.push([id, "compose-stringify"]); continue; }

  const port = (cfg.port && Number.parseInt(cfg.port, 10)) || built.webPort || 80;
  const toml = emitTemplateToml({
    variables: { main_domain: "${domain}" },
    domains: [{ serviceName: built.webService, port, host: "${main_domain}" }],
    env,
  });

  const tags = new Set();
  for (const c of cfg.categories || []) tags.add(slug(c));
  if (!tags.size) tags.add("self-hosted");
  const source = cfg.source || "";
  const meta = {
    id,
    name: cfg.name || id,
    description: (cfg.short_desc || cfg.description || `${cfg.name || id} (Runtipi app)`).replace(/\s+/g, " ").trim().slice(0, 300),
    version: "latest",
    logo: "logo.jpg",
    links: {
      github: findGithub(source, cfg.website) || "",
      website: (cfg.website && findUrl(cfg.website)) || (source && !source.includes("github.com") ? findUrl(source) : "") || "",
      docs: (cfg.website && findUrl(cfg.website)) || "",
    },
    tags: [...tags],
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "docker-compose.yml"), composeYml);
  writeFileSync(join(outDir, "template.toml"), toml);
  const logoSrc = join(appDir, "metadata", "logo.jpg");
  if (existsSync(logoSrc)) { copyFileSync(logoSrc, join(outDir, "logo.jpg")); meta.logo = "logo.jpg"; }
  else { copyFileSync(HANZO_FALLBACK_LOGO, join(outDir, "logo.svg")); meta.logo = "logo.svg"; }
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  stats.written++;
}

console.log("[runtipi]", JSON.stringify(stats));
if (skipped.length) {
  const by = {};
  for (const [, r] of skipped) by[r] = (by[r] || 0) + 1;
  console.log("[runtipi] skips:", JSON.stringify(by));
}
