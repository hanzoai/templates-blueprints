// Shared helpers for converting foreign one-click catalogs into the Dokploy
// blueprint shape that hanzoai/platform consumes:
//   blueprints/<id>/template.toml   (parsed with the `toml` package)
//   blueprints/<id>/docker-compose.yml
//   blueprints/<id>/meta.json       (aggregated into the root meta.json array)
//
// One deterministic transform per source. Emit, then the validator parses every
// file with the SAME libraries the platform uses — anything that does not parse
// is dropped, never shipped.
import { readFileSync } from "node:fs";

// A basic-string TOML value. JSON string escaping is a valid subset of TOML
// basic-string escaping for the characters that occur here (\" \\ \n \t …); the
// validator re-parses with `toml`, so any bad escape is caught and dropped.
export function tomlStr(v) {
  return JSON.stringify(String(v));
}

// Purpose-built emitter for exactly the Dokploy template.toml shape:
//   [variables] k = "v"
//   [config]
//   [[config.domains]] serviceName/port/host/path
//   [config.env] K = "V"
//   [[config.mounts]] filePath/content
export function emitTemplateToml({ variables = {}, domains = [], env = {}, mounts = [] }) {
  const lines = [];
  lines.push("[variables]");
  for (const [k, v] of Object.entries(variables)) lines.push(`${k} = ${tomlStr(v)}`);
  lines.push("");
  lines.push("[config]");
  for (const d of domains) {
    lines.push("");
    lines.push("[[config.domains]]");
    lines.push(`serviceName = ${tomlStr(d.serviceName)}`);
    lines.push(`port = ${Number.parseInt(d.port, 10)}`);
    if (d.host !== undefined) lines.push(`host = ${tomlStr(d.host)}`);
    if (d.path !== undefined) lines.push(`path = ${tomlStr(d.path)}`);
  }
  const envKeys = Object.keys(env);
  if (envKeys.length) {
    lines.push("");
    lines.push("[config.env]");
    for (const k of envKeys) lines.push(`${k} = ${tomlStr(env[k])}`);
  }
  for (const m of mounts) {
    lines.push("");
    lines.push("[[config.mounts]]");
    lines.push(`filePath = ${tomlStr(m.filePath)}`);
    lines.push(`content = ${tomlStr(m.content)}`);
  }
  return lines.join("\n") + "\n";
}

// Lowercase, hyphenated identifier safe for a directory name, a compose service
// name, and a URL path segment.
export function slug(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// UPPER_SNAKE env-var name from an arbitrary identifier.
export function envName(s) {
  return String(s)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// First github.com URL found in a blob of text, else "".
export function findGithub(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = String(t).match(/https?:\/\/(?:www\.)?github\.com\/[^\s"'<>)]+/i);
    if (m) return m[0].replace(/[.,)]+$/, "");
  }
  return "";
}

// First http(s) URL found, else "".
export function findUrl(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = String(t).match(/https?:\/\/[^\s"'<>)]+/i);
    if (m) return m[0].replace(/[.,)]+$/, "");
  }
  return "";
}

// Recursively map every string leaf in a value (objects/arrays/strings).
export function mapStrings(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = mapStrings(val, fn);
    return out;
  }
  return v;
}

// Coerce a docker-compose `environment:` block (map or list) into a plain map of
// string→string so re-serialization is stable and compose-valid.
export function envToMap(environment) {
  const out = {};
  if (!environment) return out;
  if (Array.isArray(environment)) {
    for (const item of environment) {
      if (typeof item !== "string") continue;
      const eq = item.indexOf("=");
      if (eq === -1) out[item] = ""; // bare `- FOO` (magic decl): keep name, empty value
      else out[item.slice(0, eq)] = item.slice(eq + 1);
    }
  } else if (typeof environment === "object") {
    for (const [k, val] of Object.entries(environment)) {
      out[k] = val === null || val === undefined ? "" : String(val);
    }
  }
  return out;
}

// From a compose `volumes:` list on a service, return the named volumes (bare
// name before the first colon, not a host path). Bind mounts (/host:/ctr) and
// relative mounts (./x) are left in place by the caller; this only collects the
// names that must be declared at the top level.
export function namedVolumesFrom(list) {
  const names = new Set();
  if (!Array.isArray(list)) return names;
  for (const v of list) {
    let src;
    if (typeof v === "string") src = v.split(":")[0];
    else if (v && typeof v === "object" && v.type === "volume") src = v.source;
    else continue;
    if (!src) continue;
    if (src.startsWith("/") || src.startsWith(".") || src.startsWith("$")) continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(src)) continue;
    names.add(src);
  }
  return names;
}

export const HANZO_FALLBACK_LOGO =
  "/Users/a/work/hanzo/hanzoai/brand/assets/logo/logo.svg";

export function readIfExists(p) {
  try { return readFileSync(p); } catch { return null; }
}
