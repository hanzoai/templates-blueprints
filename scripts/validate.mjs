// Validate the built catalog against the EXACT contract hanzoai/platform uses
// (pkg/platform/src/templates/github.ts):
//   1. every blueprints/<id>/template.toml parses with the `toml` package
//   2. every blueprints/<id>/docker-compose.yml parses as YAML with >=1 service
//   3. root meta.json parses as an ARRAY; each entry has the required fields
//   4. over HTTP (like the platform's fetch): GET /meta.json -> fetchTemplatesList
//      shape, then for every id GET /blueprints/<id>/{template.toml,docker-compose.yml}
//      and parse them exactly as fetchTemplateFiles does.
//
// Usage: node validate.mjs <catalogRootDir>
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { parse as parseToml } from "toml";
import YAML from "yaml";

const ROOT = process.argv[2];
const BP = join(ROOT, "blueprints");
const META = join(ROOT, "meta.json");
let hard = 0;
const problems = [];
function fail(m) { problems.push(m); hard++; }

// ---- 1+2: parse every blueprint's files with the platform's libraries ------
const dirs = readdirSync(BP, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
let okBlueprints = 0;
for (const id of dirs) {
  const tomlPath = join(BP, id, "template.toml");
  const composePath = join(BP, id, "docker-compose.yml");
  if (!existsSync(tomlPath)) { fail(`${id}: no template.toml`); continue; }
  if (!existsSync(composePath)) { fail(`${id}: no docker-compose.yml`); continue; }
  let cfg;
  try { cfg = parseToml(readFileSync(tomlPath, "utf8")); }
  catch (e) { fail(`${id}: template.toml parse: ${e.message}`); continue; }
  if (!cfg.config) fail(`${id}: template.toml missing [config]`);
  try {
    const compose = YAML.parse(readFileSync(composePath, "utf8"));
    if (!compose || typeof compose !== "object" || !compose.services || !Object.keys(compose.services).length)
      fail(`${id}: docker-compose.yml has no services`);
  } catch (e) { fail(`${id}: docker-compose.yml parse: ${e.message}`); continue; }
  okBlueprints++;
}

// ---- 3: root meta.json is the array the platform expects -------------------
let meta;
try { meta = JSON.parse(readFileSync(META, "utf8")); }
catch (e) { fail(`meta.json parse: ${e.message}`); }
if (!Array.isArray(meta)) fail("meta.json is not an array");
else {
  const ids = new Set();
  for (const t of meta) {
    for (const f of ["id", "name", "description", "version", "logo", "links", "tags"])
      if (t[f] === undefined || t[f] === null || t[f] === "") fail(`meta entry ${t.id || "?"}: missing ${f}`);
    if (t.links && typeof t.links === "object" && typeof t.links.github !== "string")
      fail(`meta entry ${t.id}: links.github not a string`);
    if (!Array.isArray(t.tags)) fail(`meta entry ${t.id}: tags not array`);
    if (ids.has(t.id)) fail(`meta: duplicate id ${t.id}`);
    ids.add(t.id);
    if (!existsSync(join(BP, t.id, "template.toml"))) fail(`meta ${t.id}: no blueprint dir`);
  }
}

// ---- 4: exercise the real HTTP contract (fetch + parse, like the platform) --
async function httpContract() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const p = url === "/" ? join(ROOT, "index.html") : join(ROOT, url);
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.statusCode = 404; return res.end("nf"); }
    try { res.end(readFileSync(p)); } catch { res.statusCode = 500; res.end("err"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // fetchTemplatesList
    const list = await (await fetch(`${base}/meta.json`)).json();
    if (!Array.isArray(list)) throw new Error("meta.json not array over HTTP");
    const mapped = list.map((t) => ({ id: t.id, name: t.name, logo: t.logo, links: t.links, tags: t.tags, version: t.version, description: t.description }));
    // fetchTemplateFiles for EVERY id (parse toml + read compose)
    let checked = 0;
    for (const t of mapped) {
      const [tRes, cRes] = await Promise.all([
        fetch(`${base}/blueprints/${t.id}/template.toml`),
        fetch(`${base}/blueprints/${t.id}/docker-compose.yml`),
      ]);
      if (!tRes.ok || !cRes.ok) { fail(`http ${t.id}: files not 200 (${tRes.status}/${cRes.status})`); continue; }
      const config = parseToml(await tRes.text());
      const compose = await cRes.text();
      if (!config || typeof config !== "object") fail(`http ${t.id}: toml did not parse to object`);
      if (!compose.includes("services")) fail(`http ${t.id}: compose empty`);
      // logo resolves over HTTP too
      const lRes = await fetch(`${base}/blueprints/${t.id}/${t.logo}`);
      if (!lRes.ok) fail(`http ${t.id}: logo ${t.logo} -> ${lRes.status}`);
      checked++;
    }
    console.log(`http-contract: fetched+parsed ${checked}/${mapped.length} templates over HTTP`);
  } finally { server.close(); }
}

await httpContract();

console.log(`\nvalidate: blueprints OK=${okBlueprints}/${dirs.length}, meta entries=${Array.isArray(meta) ? meta.length : "ERR"}, hard failures=${hard}`);
if (problems.length) { console.error("problems (first 40):"); for (const p of problems.slice(0, 40)) console.error("  - " + p); }
process.exit(hard ? 1 : 0);
