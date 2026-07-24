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
