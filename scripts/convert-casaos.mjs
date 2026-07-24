// CasaOS AppStore (Apps/<Name>/docker-compose.yml + top-level x-casaos metadata)
// -> Dokploy blueprint shape.
//
// The compose is standard; strategy mirrors convert-coolify.mjs: keep services
// almost verbatim (re-serialized), normalize CasaOS-isms (long ports -> expose,
// /DATA bind mounts -> named volumes, $AppID -> the id, drop x-casaos/network_mode),
// then define every ${VAR} referenced in [config.env] so interpolation resolves.
//
// Usage: node convert-casaos.mjs <casaosRepoDir> <outBlueprintsDir>
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import YAML from "yaml";
import { emitTemplateToml, slug, findGithub, findUrl, HANZO_FALLBACK_LOGO } from "./lib.mjs";

const [, , CA_DIR, OUT] = process.argv;
const APPS = join(CA_DIR, "Apps");

const stats = { total: 0, written: 0, skipParse: 0, skipDup: 0, skipBuild: 0, skipNoService: 0 };
const skipped = [];

// Concrete value for a referenced ${VAR}. Domain/secret aware; unknown -> "".
function defineVar(name) {
  const T = name.toUpperCase();
  if (/(^|_)(APPID)$/.test(T)) return null; // handled by literal replace
  if (/DOMAIN|FQDN|HOST$|_URL$|^URL$/.test(T)) return "${main_domain}";
  if (/PASSWORD|PASSWD|SECRET|TOKEN|_KEY$|APIKEY|API_KEY|SALT|ENCRYPTION/.test(T)) return "${password:32}";
  if (/BASE64/.test(T)) return "${base64:32}";
  if (/USER$|USERNAME/.test(T)) return "${username}";
  return "";
}

for (const dir of readdirSync(APPS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const composePath = join(APPS, dir, "docker-compose.yml");
  if (!existsSync(composePath)) continue;
  stats.total++;
  let doc;
  try { doc = YAML.parse(readFileSync(composePath, "utf8")); }
  catch { stats.skipParse++; skipped.push([dir, "yaml-parse"]); continue; }

  const services = doc?.services;
  const xc = doc?.["x-casaos"] || {};
  const id = slug(doc?.name || dir);
  if (!id) { stats.skipParse++; continue; }
  const outDir = join(OUT, id);
  if (existsSync(outDir)) { stats.skipDup++; continue; }
  if (!services || typeof services !== "object" || !Object.keys(services).length) { stats.skipNoService++; skipped.push([id, "no-service"]); continue; }
  if (Object.values(services).some((s) => !s?.image)) { stats.skipBuild++; skipped.push([id, "build-only"]); continue; }

  const mainName = xc.main && services[xc.main] ? xc.main : Object.keys(services)[0];
  const topVolumes = {};

  const outServices = {};
  for (const [sName, srcRaw] of Object.entries(services)) {
    // $AppID literal -> id (both $AppID and ${AppID})
    const src = JSON.parse(JSON.stringify(srcRaw, (k, v) => (typeof v === "string" ? v.split("${AppID}").join(id).split("$AppID").join(id) : v)));
    const svc = { image: src.image };
    if (src.command !== undefined) svc.command = src.command;
    if (src.entrypoint !== undefined) svc.entrypoint = src.entrypoint;
    if (src.user !== undefined) svc.user = src.user;
    if (src.environment) svc.environment = src.environment;
    if (src.depends_on) svc.depends_on = src.depends_on;
    if (src.cap_add) svc.cap_add = src.cap_add;
    if (src.devices) svc.devices = src.devices;
    // ports (short "9117:9117" | "9117" | long {target,published,protocol}) -> expose[target]
    const exposes = [];
    for (const p of src.ports || []) {
      if (typeof p === "string") { const t = p.split(":").pop().split("/")[0]; if (t) exposes.push(String(t)); }
      else if (p && typeof p === "object" && p.target != null) exposes.push(String(p.target));
      else if (typeof p === "number") exposes.push(String(p));
    }
    if (exposes.length) svc.expose = [...new Set(exposes)];
    // volumes: /DATA bind mounts -> named volume; keep real host binds (docker sock, /dev)
    const vols = [];
    for (const v of src.volumes || []) {
      if (v && typeof v === "object" && v.type === "bind" && v.source && v.target) {
        if (/\/DATA\//i.test(v.source) || v.source.includes(id)) {
          const nm = slug(`${id}-${basename(v.target) || "data"}`); topVolumes[nm] = {}; vols.push(`${nm}:${v.target}`);
        } else vols.push(`${v.source}:${v.target}${v.read_only ? ":ro" : ""}`);
      } else if (typeof v === "string") {
        const src2 = v.split(":")[0];
        if (/^\/DATA\//i.test(src2)) { const tgt = v.split(":")[1] || "/data"; const nm = slug(`${id}-${basename(tgt)}`); topVolumes[nm] = {}; vols.push(`${nm}:${tgt}`); }
        else { vols.push(v); if (/^[a-zA-Z0-9]/.test(src2)) topVolumes[src2] = {}; }
      }
    }
    if (vols.length) svc.volumes = vols;
    svc.restart = src.restart || "always";
    outServices[sName] = svc;
  }

  const compose = { services: outServices };
  if (Object.keys(topVolumes).length) compose.volumes = topVolumes;

  // Collect ${VAR} / $VAR refs -> config.env definitions.
  const blob = JSON.stringify(compose);
  const env = {};
  for (const m of blob.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
    const name = m[1];
    if (env[name] !== undefined) continue;
    const val = defineVar(name);
    if (val !== null) env[name] = val;
  }

  let composeYml;
  try { composeYml = YAML.stringify(compose, { lineWidth: 0 }); }
  catch { stats.skipParse++; skipped.push([id, "compose-stringify"]); continue; }

  let port = 80;
  if (xc.port_map && /^\d+$/.test(String(xc.port_map))) port = Number.parseInt(xc.port_map, 10);
  else if (outServices[mainName]?.expose?.length) port = Number.parseInt(outServices[mainName].expose[0], 10);

  const toml = emitTemplateToml({
    variables: { main_domain: "${domain}" },
    domains: [{ serviceName: mainName, port, host: "${main_domain}" }],
    env,
  });

  const title = xc.title?.en_US || xc.title?.en_GB || doc?.name || id;
  let desc = xc.tagline?.en_US || xc.description?.en_US || `${title} (CasaOS app)`;
  desc = String(desc).replace(/\s+/g, " ").trim();
  if (desc.length > 300) desc = desc.slice(0, 297).trimEnd() + "...";
  const tags = new Set();
  if (xc.category) tags.add(slug(xc.category));
  if (!tags.size) tags.add("self-hosted");

  const meta = {
    id,
    name: String(title).trim() || id,
    description: desc,
    version: "latest",
    logo: "logo.svg",
    links: {
      github: findGithub(xc.repo, xc.website, xc.support, xc.docs) || "",
      website: (xc.website && findUrl(xc.website)) || "",
      docs: (xc.docs && findUrl(xc.docs)) || (xc.support && findUrl(xc.support)) || "",
    },
    tags: [...tags],
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "docker-compose.yml"), composeYml);
  writeFileSync(join(outDir, "template.toml"), toml);
  // logo: prefer upstream icon.svg then icon.png, else Hanzo fallback
  if (existsSync(join(APPS, dir, "icon.svg"))) { copyFileSync(join(APPS, dir, "icon.svg"), join(outDir, "logo.svg")); meta.logo = "logo.svg"; }
  else if (existsSync(join(APPS, dir, "icon.png"))) { copyFileSync(join(APPS, dir, "icon.png"), join(outDir, "logo.png")); meta.logo = "logo.png"; }
  else copyFileSync(HANZO_FALLBACK_LOGO, join(outDir, "logo.svg"));
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  stats.written++;
}

console.log("[casaos]", JSON.stringify(stats));
if (skipped.length) {
  const by = {};
  for (const [, r] of skipped) by[r] = (by[r] || 0) + 1;
  console.log("[casaos] skips:", JSON.stringify(by));
}
