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

## The explorer UI (oss.hanzo.ai) — index.html + catalog.css + app.js

The three presentation files are the ONLY moving parts of the storefront; they
never touch the contract above (meta.json / blueprints are read-only to them).
`static` serves a strict CSP: `script-src 'self'` (external app.js, NO inline
`<script>` / handlers), `img-src 'self' data:` (logos same-origin, favicon +
brand mark are inline data: SVGs — NEVER an external favicon URL), `style-src
'self' 'unsafe-inline'` (external catalog.css + inline `<style>` OK), `connect-src
'self'` (only `GET /meta.json`). Verify before shipping: `node --check app.js`,
`grep -E 'onerror=|onclick=|onload=' *.js *.html` = 0.

Invariants that must not regress:
- **DOM-built, never innerHTML.** Cards come from one factory `card(t, opts)`
  (`opts.spotlight`/`opts.note` = the "Start here" dress). Per-item try/catch —
  one bad row is skipped, never fatal. Logos degrade to a monogram tile on
  `error` (proven: page stays whole even if the server vanishes).
- **The story is static HTML** (hero · beliefs · makers band) so it first-paints
  instantly and survives a `/meta.json` failure; only the catalog below needs data.
- **Curated exploration, not a wall of 1030.** `FEATURED` = ~12 hand-picked ids
  + one-liners. `DOMAINS` = 8 browse-domains, each a curated **set of real tags**
  (build-provenance tags caprover/dokploy/coolify/casaos/runtipi are NEVER in a
  set); filtering is one intersection test. Domain cards + the clear-chip both
  call `setDomain()` — one path. Search is the power path.
- **The 1030-grid is deferred** behind an IntersectionObserver (renders on scroll
  or first search/filter), paginated 60 at a time, `content-visibility:auto` +
  lazy logos. Keep it cheap.
- **Economics are first-class:** Deploy → `platform.hanzo.ai/templates?deploy=<id>`;
  maintainer "Earn 20% →" → `console.hanzo.ai/authors?claim=<owner/repo>` parsed
  from `links.github`. Copy is honest — real count (1,030), real 20%, Techstars '17.
- Motion: hero rises on load (always ends visible); below-fold reveal is opt-in
  only under `@supports (animation-timeline: view())` so unsupported browsers and
  `prefers-reduced-motion` always render fully visible.
