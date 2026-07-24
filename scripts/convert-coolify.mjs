// Coolify service templates (compose + magic comments + SERVICE_* magic vars)
// -> Dokploy blueprint shape.
//
// Strategy: keep the compose almost verbatim (re-serialized). Every SERVICE_*
// magic token referenced anywhere is given a concrete definition in
// [config.env] (secrets -> generators, URL/FQDN -> the managed domain), so
// compose interpolation resolves it from the generated .env. Bare magic list
// declarations (`- SERVICE_URL_X_PORT`) are dropped; they only carried Coolify's
// domain wiring, which Dokploy expresses via [[config.domains]].
//
// Usage: node convert-coolify.mjs <coolifyRepoDir> <outBlueprintsDir>
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import YAML from "yaml";
import { emitTemplateToml, slug, findGithub, findUrl, HANZO_FALLBACK_LOGO } from "./lib.mjs";

const [, , CO_DIR, OUT] = process.argv;
const DIR = join(CO_DIR, "templates/compose");

const stats = { total: 0, written: 0, skipParse: 0, skipDup: 0, skipIgnore: 0, skipNoService: 0 };
const skipped = [];

function parseMagic(text) {
  const m = {};
  for (const line of text.split(/\r?\n/)) {
    const mm = line.match(/^#\s*([a-z_]+):\s*(.*)$/);
    if (mm) m[mm[1]] = mm[2].trim();
    else if (line.trim() && !line.startsWith("#")) break; // header block ends at first yaml line
  }
  return m;
}

// Concrete value for a SERVICE_* magic token.
function defineService(tok) {
  const T = tok.toUpperCase();
  if (/^SERVICE_FQDN/.test(T)) return "${main_domain}";
  if (/^SERVICE_URL/.test(T)) return "https://${main_domain}";
  if (/PASSWORD_64|BASE64_64|REALBASE64_64/.test(T)) return "${base64:64}";
  if (/HEX_64/.test(T)) return "${hash:64}";
  if (/PASSWORD/.test(T)) return "${password:32}";
  if (/REALBASE64|BASE64/.test(T)) return "${base64:32}";
  if (/HEX/.test(T)) return "${hash:32}";
  if (/USER/.test(T)) return "${username}";
  if (/SALT|SECRET|KEY|TOKEN|ENCRYPTION|ANON|JWT/.test(T)) return "${password:32}";
  return ""; // unknown magic -> defined-but-empty (valid, avoids a dangling ref)
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()) {
  stats.total++;
  const id = slug(basename(file).replace(/\.ya?ml$/, ""));
  const outDir = join(OUT, id);
  if (existsSync(outDir)) { stats.skipDup++; continue; }

  const text = readFileSync(join(DIR, file), "utf8");
  const magic = parseMagic(text);
  if (String(magic.ignore) === "true") { stats.skipIgnore++; continue; }

  let doc;
  try { doc = YAML.parse(text); }
  catch { stats.skipParse++; skipped.push([id, "yaml-parse"]); continue; }
  const services = doc?.services;
  if (!services || typeof services !== "object" || !Object.keys(services).length) {
    stats.skipNoService++; skipped.push([id, "no-service"]); continue;
  }

  // Strip bare magic list decls (`- SERVICE_URL_X_PORT`) and record the web port.
  let webService = null, webPort = null;
  for (const [sName, svc] of Object.entries(services)) {
    if (svc && Array.isArray(svc.environment)) {
      svc.environment = svc.environment.filter((e) => {
        if (typeof e !== "string") return true;
        const bare = e.match(/^(SERVICE_(?:URL|FQDN)_[A-Z0-9]+)(?:_(\d+))?$/);
        if (bare && !e.includes("=")) {
          if (bare[2] && !webPort) { webPort = Number.parseInt(bare[2], 10); webService = sName; }
          return false; // drop the magic decl
        }
        return true;
      });
      if (!svc.environment.length) delete svc.environment;
    }
  }

  // Collect every SERVICE_* token still referenced (in any string leaf).
  const blob = JSON.stringify(services);
  const tokens = new Set((blob.match(/SERVICE_[A-Z0-9_]+/g) || []));
  const env = {};
  for (const tok of tokens) env[tok] = defineService(tok);

  // Web service/port: explicit magic port -> `# port:` -> 80. Web service: the
  // magic decl's service -> the first service.
  if (!webPort && magic.port && /^\d+$/.test(magic.port)) webPort = Number.parseInt(magic.port, 10);
  if (!webPort) webPort = 80;
  if (!webService) webService = Object.keys(services)[0];

  const compose = { services };
  if (doc.volumes) compose.volumes = doc.volumes;
  if (doc.networks) compose.networks = doc.networks;
  let composeYml;
  try { composeYml = YAML.stringify(compose, { lineWidth: 0 }); }
  catch { stats.skipParse++; skipped.push([id, "compose-stringify"]); continue; }

  const toml = emitTemplateToml({
    variables: { main_domain: "${domain}" },
    domains: [{ serviceName: webService, port: webPort, host: "${main_domain}" }],
    env,
  });

  // tags from `# tags:` + `# category:`
  const tags = new Set();
  if (magic.tags) for (const t of magic.tags.split(",").map((x) => slug(x)).filter(Boolean)) tags.add(t);
  if (magic.category) tags.add(slug(magic.category));
  if (!tags.size) tags.add("self-hosted");

  const docLink = magic.documentation || "";
  const meta = {
    id,
    name: magic.name || id,
    description: (magic.slogan && magic.slogan.trim()) || `${id} (Coolify service template)`,
    version: "latest",
    logo: "logo.svg",
    links: {
      github: findGithub(docLink) || "",
      website: (docLink && !docLink.includes("github.com") && findUrl(docLink)) || "",
      docs: (docLink && findUrl(docLink)) || "",
    },
    tags: [...tags],
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "docker-compose.yml"), composeYml);
  writeFileSync(join(outDir, "template.toml"), toml);
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  copyFileSync(HANZO_FALLBACK_LOGO, join(outDir, "logo.svg"));
  stats.written++;
}

console.log("[coolify]", JSON.stringify(stats));
if (skipped.length) {
  const by = {};
  for (const [, r] of skipped) by[r] = (by[r] || 0) + 1;
  console.log("[coolify] skips:", JSON.stringify(by));
}
