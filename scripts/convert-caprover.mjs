// CapRover one-click-apps ($$cap_* format) -> Dokploy blueprint shape.
//
// Usage: node convert-caprover.mjs <caproverRepoDir> <outBlueprintsDir>
// Dedupe: skips any id that already exists in <outBlueprintsDir>.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import YAML from "yaml";
import {
  emitTemplateToml, slug, envName, findGithub, findUrl, mapStrings,
  envToMap, namedVolumesFrom, HANZO_FALLBACK_LOGO,
} from "./lib.mjs";

const [, , CAP_DIR, OUT] = process.argv;
const APPS = join(CAP_DIR, "public/v4/apps");
const LOGOS = join(CAP_DIR, "public/v4/logos");

const stats = { total: 0, written: 0, skipBuild: 0, skipParse: 0, skipDup: 0, skipUnresolved: 0, skipNoService: 0 };
const skipped = [];

for (const file of readdirSync(APPS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort()) {
  stats.total++;
  const id = slug(basename(file).replace(/\.ya?ml$/, ""));
  const outDir = join(OUT, id);
  if (existsSync(outDir)) { stats.skipDup++; continue; }

  let doc;
  try { doc = YAML.parse(readFileSync(join(APPS, file), "utf8")); }
  catch { stats.skipParse++; skipped.push([id, "yaml-parse"]); continue; }

  const app = doc?.caproverOneClickApp;
  const services = doc?.services;
  if (!app || !services || typeof services !== "object") { stats.skipNoService++; skipped.push([id, "no-service"]); continue; }

  // Every service must ship a prebuilt image; build-from-source apps
  // (dockerfileLines / imageName) cannot be a pure-image compose -> drop.
  const svcNames = Object.keys(services);
  if (svcNames.some((s) => !services[s]?.image)) { stats.skipBuild++; skipped.push([id, "build-only"]); continue; }

  // --- variable table ------------------------------------------------------
  // Each $$cap_<vid> becomes a template variable <vid> plus a config.env entry
  // <VID> = "${<vid>}". Secrets -> generators; the web host -> ${domain}.
  const variables = { main_domain: "${domain}" };
  const env = {};
  const capToEnv = {}; // $$cap_<vid> token -> ${<ENV>}
  let hasHostVar = false;

  for (const v of app.variables || []) {
    if (!v?.id || typeof v.id !== "string" || !v.id.startsWith("$$cap_")) continue;
    const vid = slug(v.id.slice("$$cap_".length));
    if (!vid || vid === "appname" || vid === "root-domain") continue;
    const EV = envName(vid);
    const def = v.defaultValue;
    const looksHost =
      /(^|[-_])(host|domain|url|fqdn)$/.test(vid) ||
      (typeof def === "string" && /^[a-z0-9-]+\.(example\.com|com|org|net|io)$/i.test(def));
    let value;
    if (typeof def === "string" && /\$\$cap_gen_random_hex\((\d+)\)/.test(def)) {
      const n = Number.parseInt(def.match(/\$\$cap_gen_random_hex\((\d+)\)/)[1], 10);
      value = `\${password:${Math.min(Math.max(n, 8), 64)}}`;
    } else if (looksHost) {
      value = "${main_domain}";
      hasHostVar = true;
    } else if (def === undefined || def === null) {
      value = "";
    } else {
      value = String(def);
    }
    variables[vid] = value;
    env[EV] = `\${${vid}}`;
    capToEnv["$$cap_" + v.id.slice("$$cap_".length)] = "${" + EV + "}";
  }
  // Built-in CapRover cluster root domain -> our managed domain.
  env.ROOT_DOMAIN = "${main_domain}";

  // --- token rewrite across the whole services subtree ---------------------
  // Inline random secrets ($$cap_gen_random_hex(N) used directly in a service,
  // not via a declared variable) become a synthetic GENSEC<N> env, generated
  // once in [config.env] and interpolated by compose.
  const gensecNs = new Set();
  const rewrite = (s) => {
    let out = s;
    out = out.replace(/\$\$cap_gen_random_hex\((\d+)\)/g, (_m, n) => {
      const N = Math.min(Math.max(Number.parseInt(n, 10), 8), 64);
      gensecNs.add(N);
      return "${GENSEC" + N + "}";
    });
    // Longest cap tokens first so $$cap_appname-db resolves before $$cap_appname.
    for (const [tok, rep] of Object.entries(capToEnv).sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(tok).join(rep);
    }
    out = out.split("$$cap_root_domain").join("${ROOT_DOMAIN}");
    out = out.split("$$cap_appname").join(id);
    out = out.split("srv-captain--").join("");
    return out;
  };
  let rewritten;
  try { rewritten = mapStrings(services, rewrite); }
  catch { stats.skipParse++; skipped.push([id, "rewrite"]); continue; }

  // --- build the compose object -------------------------------------------
  const outServices = {};
  const topVolumes = {};
  let webService = null, webPort = null;

  for (const sName of svcNames) {
    const src = rewritten[sName];
    const name = rewrite(sName); // service key also carries $$cap_appname
    const extra = src.caproverExtra || {};
    const svc = {};
    svc.image = src.image;
    if (src.command !== undefined) svc.command = src.command;
    const em = envToMap(src.environment);
    if (Object.keys(em).length) svc.environment = em;
    if (Array.isArray(src.volumes) && src.volumes.length) {
      svc.volumes = src.volumes;
      for (const nm of namedVolumesFrom(src.volumes)) topVolumes[nm] = {};
    }
    if (Array.isArray(src.depends_on) && src.depends_on.length) svc.depends_on = src.depends_on;
    else if (src.depends_on && typeof src.depends_on === "object") svc.depends_on = src.depends_on;
    if (src.cap_add) svc.cap_add = src.cap_add;
    if (src.ports) svc.ports = src.ports;
    // web service detection: exposed (not notExposeAsWebApp) with an http port
    const notWeb = String(extra.notExposeAsWebApp) === "true";
    const httpPort = extra.containerHttpPort ? Number.parseInt(extra.containerHttpPort, 10) : null;
    if (!notWeb && httpPort) {
      svc.expose = [String(httpPort)];
      if (!webService || name === id) { webService = name; webPort = httpPort; }
    }
    svc.restart = src.restart || "always";
    outServices[name] = svc;
  }

  // Fallback web service: the primary (id) service if nothing was flagged.
  if (!webService) {
    if (outServices[id]) { webService = id; webPort = 80; }
    else { webService = Object.keys(outServices)[0]; webPort = 80; }
  }

  const compose = { services: outServices };
  if (Object.keys(topVolumes).length) compose.volumes = topVolumes;

  // Register synthetic inline secrets, then guard: any leftover $$cap_ in the
  // FINAL compose (keys included) is an unmapped token -> drop rather than ship
  // dangling CapRover magic.
  for (const N of gensecNs) { variables[`gensec${N}`] = `\${password:${N}}`; env[`GENSEC${N}`] = `\${gensec${N}}`; }
  const composeBlob = JSON.stringify(compose);
  if (composeBlob.includes("$$cap_")) { stats.skipUnresolved++; skipped.push([id, "unresolved-cap"]); continue; }

  let composeYml;
  try { composeYml = YAML.stringify(compose, { lineWidth: 0 }); }
  catch { stats.skipParse++; skipped.push([id, "compose-stringify"]); continue; }

  // Drop the ROOT_DOMAIN env entry if nothing referenced it, keep table lean.
  if (!composeBlob.includes("${ROOT_DOMAIN}")) delete env.ROOT_DOMAIN;

  const toml = emitTemplateToml({
    variables,
    domains: [{ serviceName: webService, port: webPort || 80, host: "${main_domain}" }],
    env,
  });

  // --- meta.json -----------------------------------------------------------
  const docLink = typeof app.documentation === "string" ? app.documentation : "";
  const github = findGithub(docLink, app.description, JSON.stringify(app.instructions || ""));
  const website = findUrl(docLink) && !findUrl(docLink).includes("github.com") ? findUrl(docLink) : "";
  const meta = {
    id,
    name: (app.displayName && String(app.displayName).trim()) || id,
    description: (app.description && String(app.description).trim()) || `${id} (CapRover one-click app)`,
    version: "latest",
    logo: "logo.png",
    links: {
      github: github || "",
      website: website || "",
      docs: (docLink && findUrl(docLink)) || "",
    },
    tags: ["self-hosted", "caprover"],
  };

  // --- write ---------------------------------------------------------------
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "docker-compose.yml"), composeYml);
  writeFileSync(join(outDir, "template.toml"), toml);
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  const logoSrc = join(LOGOS, `${id}.png`);
  if (existsSync(logoSrc)) copyFileSync(logoSrc, join(outDir, "logo.png"));
  else { meta.logo = "logo.svg"; writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n"); copyFileSync(HANZO_FALLBACK_LOGO, join(outDir, "logo.svg")); }
  stats.written++;
}

console.log("[caprover]", JSON.stringify(stats));
if (skipped.length) {
  const by = {};
  for (const [, r] of skipped) by[r] = (by[r] || 0) + 1;
  console.log("[caprover] skips:", JSON.stringify(by));
}
