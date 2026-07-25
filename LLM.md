# templates-blueprints — AI assistant context

The one-click deploy-template catalog for the Hanzo PaaS, served at
**templates.hanzo.ai** by `hanzoai/static` on `do-sfo3-hanzo-k8s`. NOT a
CDN/Pages/Vercel site — native DOKS + operator ingress.

## The contract (do not break)

`hanzoai/platform/pkg/platform/src/templates/github.ts` fetches with
`baseUrl=https://templates.hanzo.ai`:
- `GET /meta.json` → JSON **array** of `{id,name,description,version,logo,links:{github,website?,docs?},tags:[]}`.
- `GET /blueprints/<id>/template.toml` → parsed with the `toml` package → `{variables,config:{domains,env,mounts}}`.
- `GET /blueprints/<id>/docker-compose.yml` → the compose stack.
- `logo` is a **bare filename** resolved against `/blueprints/<id>/`.

Invariants:
- `meta.json` = aggregate of every `blueprints/<id>/meta.json`; **id == dir name**.
- static runs `-root /public` **without `-spa`** (missing files MUST 404, never
  fall through — a fallthrough corrupts the platform's parse).
- static sets `Access-Control-Allow-Origin: *`; default CSP is fine for
  JSON/TOML/YAML/logos (no script execution here).

## Build / validate

`scripts/` holds deterministic aggregators (one per source) + `generate-meta.mjs`
(writes the root array) + `validate.mjs` (the hard gate: parses every
template.toml with `toml`, every compose as YAML, meta as the array, then an
over-HTTP `fetchTemplatesList`+`fetchTemplateFiles` probe of all entries). CI runs
generate+validate before the image build, so a broken blueprint never ships.
"Valid + parseable" is guaranteed; per-app runtime tuning is best-effort v1.

## Sources (deduped by id: Dokploy→Coolify→CapRover→CasaOS→Runtipi)

Dokploy (MIT, verbatim) · Coolify (Apache-2.0) · CapRover (Apache-2.0) · CasaOS
(Apache-2.0) · Runtipi (GPL-3.0). Each app keeps its upstream license — see
ATTRIBUTION.md. Missing upstream logos fall back to a Hanzo mark.

## Deploy

CI → `ghcr.io/hanzoai/templates-blueprints:sha-<short>-amd64` (arc pool
`hanzo-build-linux-amd64`). Rollout owned by the operator App CR
`crs/templates-blueprints.yaml` (landed via `hanzoai/universe`), host
`templates.hanzo.ai`, TLS via the ingress. DNS: `templates.hanzo.ai` A → the DOKS
ingress LB.

## The storefront UI (oss.hanzo.ai / templates.hanzo.ai) — index.html + catalog.css + app.js

ONE page, three files: the editorial story (hero · beliefs · makers band) above a
searchable 1,030-app launcher. The three presentation files are the ONLY moving
parts; they never touch the contract above (meta.json / blueprints are read-only
to them). `static` serves a strict CSP — verified live:
`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'`.
So: external `app.js` (NO inline `<script>` / handlers), logos same-origin +
favicon/brand-mark inline data:/SVG (NEVER an external favicon), external
`catalog.css`, only `GET /meta.json` on the wire, system-font stack (NO web font).
Verify before shipping: `node --check app.js`; `grep -E 'onerror=|onclick=|onload=' *.js *.html` = 0;
and no public compute-share percentage appears in index.html/catalog.css/app.js (the CTO killed the public number).

Invariants that must not regress:
- **DOM-built, never innerHTML.** Cards come from one factory `card(t)` (logo +
  name + category badge + Deploy + Source). Per-item try/catch — one bad row is
  skipped, never fatal. Logos degrade to a monogram tile on `error` (proven: page
  stays whole even if a logo 404s or the server vanishes).
- **The story is static HTML** (hero · beliefs · makers band) so it first-paints
  instantly and survives a `/meta.json` failure; only the launcher needs data.
- **Search + category chips, not a wall of 1030.** The chip row is **data-driven**:
  a `PREFERRED` order (ai, llm, database, …) shown first when present, then the
  most-common remaining tags fill up to 16; build-provenance tags
  (caprover/dokploy/coolify/casaos/runtipi/docker/free/open-source) are hidden.
  A chip filters by one exact-tag test; search (name+desc+id+tags) is the power
  path. State is shareable in the URL hash (`#q=…&tag=…`); `/` focuses search,
  `Esc` clears. Grid paginated 48 at a time, `content-visibility:auto` + lazy logos.
- **Theme-aware.** Light default; dark via `prefers-color-scheme` and an explicit
  `[data-theme]` toggle persisted to `localStorage['hz-theme']`. `app.js` is loaded
  **blocking in `<head>`** so the theme bootstrap runs before first paint (no flash);
  the catalog work waits for `DOMContentLoaded`. ONE JS file (theme + launcher).
- **Economics are first-class, but the public % is gone:** Deploy →
  `platform.hanzo.ai/templates?deploy=<id>` (proven live 200). The makers band
  promises a **share of the compute a project earns — metered per second, paid out
  automatically**, with NO percentage anywhere (CTO killed the public number). The
  "Claim your project" CTA → `console.hanzo.ai/authors`. Copy stays honest: real
  count (1,030), Techstars '17.
- Motion: hero rises once on load (always ends visible); `prefers-reduced-motion`
  disables all animation.
