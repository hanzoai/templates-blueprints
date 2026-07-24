// Aggregate every blueprints/<id>/meta.json into the single root meta.json array
// the platform serves at {baseUrl}/meta.json. Ported from Dokploy's
// generate-meta.js; the array shape is identical (id must equal the dir name).
//
// Usage: node generate-meta.mjs <blueprintsDir> <outMetaJson>
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , BP, OUT] = process.argv;
const REQUIRED = ["id", "name", "version", "description", "links", "logo", "tags"];

const errors = [];
const entries = [];
const dirs = readdirSync(BP, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b));

for (const dir of dirs) {
  const metaFile = join(BP, dir, "meta.json");
  if (!existsSync(metaFile)) { errors.push(`${dir}: missing meta.json`); continue; }
  let entry;
  try { entry = JSON.parse(readFileSync(metaFile, "utf8")); }
  catch (e) { errors.push(`${dir}/meta.json: invalid JSON (${e.message})`); continue; }
  if (Array.isArray(entry) || typeof entry !== "object" || entry === null) {
    errors.push(`${dir}/meta.json: must be a single object`); continue;
  }
  if (entry.id !== dir) { errors.push(`${dir}/meta.json: id "${entry.id}" != dir`); continue; }
  let ok = true;
  for (const f of REQUIRED) {
    if (entry[f] === undefined || entry[f] === null || entry[f] === "") { errors.push(`${dir}: missing "${f}"`); ok = false; }
  }
  if (!entry.links || typeof entry.links !== "object") { errors.push(`${dir}: links must be object`); ok = false; }
  if (!Array.isArray(entry.tags) || !entry.tags.length) { errors.push(`${dir}: tags must be non-empty array`); ok = false; }
  // The blueprint's referenced files must exist alongside it.
  for (const f of ["template.toml", "docker-compose.yml"]) {
    if (!existsSync(join(BP, dir, f))) { errors.push(`${dir}: missing ${f}`); ok = false; }
  }
  if (entry.logo && !existsSync(join(BP, dir, entry.logo))) { errors.push(`${dir}: logo "${entry.logo}" not found`); ok = false; }
  if (ok) entries.push(entry);
}

if (errors.length) {
  console.error(`generate-meta: ${errors.length} problem(s):`);
  for (const e of errors.slice(0, 40)) console.error("  - " + e);
  if (errors.length > 40) console.error(`  … +${errors.length - 40} more`);
}
writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");
console.log(`generate-meta: wrote ${entries.length} entries -> ${OUT} (${errors.length} dropped)`);
process.exit(errors.length ? 2 : 0);
