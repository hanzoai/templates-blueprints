# hanzoai/templates-blueprints

The **one-click deploy-template catalog** for the Hanzo PaaS
([platform.hanzo.ai](https://platform.hanzo.ai)). Served at
**https://templates.hanzo.ai** by the house static server
([`hanzoai/static`](https://github.com/hanzoai/static)) on DOKS — no CDN, no
Cloudflare Pages, no Vercel. The Hanzo PaaS (a Dokploy fork) reads this catalog
to offer 1000+ open-source apps for one-click deployment.

## The contract (what the PaaS fetches)

`hanzoai/platform` `pkg/platform/src/templates/github.ts` fetches, with
`baseUrl = https://templates.hanzo.ai`:

| Request | Response |
|---------|----------|
| `GET /meta.json` | a JSON **array** of `{ id, name, description, version, logo, links:{github,website?,docs?}, tags:string[] }` |
| `GET /blueprints/<id>/template.toml` | TOML parsed to `{ variables, config:{domains,env,mounts} }` |
| `GET /blueprints/<id>/docker-compose.yml` | the compose stack |
| `GET /blueprints/<id>/<logo>` | the app logo (referenced by `meta.json.logo`, a bare filename) |

`meta.json` is the aggregate of every `blueprints/<id>/meta.json` (id **must**
equal the directory name). Logos are bare filenames resolved against
`/blueprints/<id>/`.

## Layout

```
meta.json                     # generated: the array the platform serves
blueprints/<id>/
  template.toml               # variables, domains, env (Dokploy shape)
  docker-compose.yml          # the stack
  meta.json                   # this blueprint's entry (id == dir name)
  logo.(svg|png|…)            # the app logo (or a Hanzo fallback)
index.html, catalog.css       # human landing page
scripts/                      # deterministic aggregators + validator
Dockerfile                    # FROM ghcr.io/hanzoai/static:0.4.1
crs/templates-blueprints.yaml # operator App CR (spec; landed via universe)
```

## Sources

Aggregated from five open-source catalogs, converted into the Dokploy blueprint
shape and de-duplicated by app identity (priority Dokploy → Coolify → CapRover →
CasaOS → Runtipi). Each source keeps its license and each app keeps its upstream
license — see [ATTRIBUTION.md](ATTRIBUTION.md).

**1030 blueprints** (v1), all validated:

| Source | License | Blueprints |
|--------|---------|-----------:|
| [Dokploy Templates](https://github.com/Dokploy/templates) | MIT | 500 |
| [Coolify](https://github.com/coollabsio/coolify) | Apache-2.0 | 174 |
| [CapRover One-Click Apps](https://github.com/caprover/one-click-apps) | Apache-2.0 | 161 |
| [CasaOS App Store](https://github.com/IceWhaleTech/CasaOS-AppStore) | Apache-2.0 | 85 |
| [Runtipi App Store](https://github.com/runtipi/runtipi-appstore) | GPL-3.0 | 110 |
| **Total (deduped by id)** | | **1030** |

Path to more: additional permissive catalogs (Portainer, Yacht, TrueCharts) and
per-app tuning of converted entries land in follow-ups; the aggregators are
deterministic and re-runnable.

## Build

Deterministic, reproducible, zero network at build time (sources are cloned into
a scratch dir; conversion is pure):

```bash
cd scripts && npm ci
# copy Dokploy verbatim, then convert the rest into blueprints/ (each dedupes):
node convert-coolify.mjs  <coolify-repo>  ../blueprints
node convert-caprover.mjs <caprover-repo> ../blueprints
node convert-casaos.mjs   <casaos-repo>   ../blueprints
node convert-runtipi.mjs  <runtipi-repo>  ../blueprints
node generate-meta.mjs ../blueprints ../meta.json   # aggregate the array
node validate.mjs ..                                # HARD gate — see below
```

### Validation (the hard floor)

`scripts/validate.mjs` is the gate that CI runs before building the image:

1. every `template.toml` parses with the **same `toml` package** the platform uses;
2. every `docker-compose.yml` parses as YAML with ≥1 service;
3. `meta.json` is a valid array with every required field per entry;
4. an **over-HTTP** probe serves the catalog and runs the platform's exact
   `fetchTemplatesList` + `fetchTemplateFiles` logic against every template
   (fetch + parse + logo resolves).

It exits non-zero on any hard failure, so a broken blueprint can never reach a
running pod. "Valid + parseable" is guaranteed; individual apps may still need
per-app tuning (PRs welcome).

## Deploy (native)

CI (`.github/workflows/cicd.yml`, arc pool `hanzo-build-linux-amd64`) regenerates
`meta.json`, validates, then builds + pushes
`ghcr.io/hanzoai/templates-blueprints:sha-<short>-amd64` to GHCR. The rollout
onto `do-sfo3-hanzo-k8s` is owned by the operator App CR
(`crs/templates-blueprints.yaml`, landed via `hanzoai/universe`), which serves it
at `templates.hanzo.ai` with TLS. `templates.hanzo.ai` A-records to the DOKS
ingress LB.

## Adding a template

Create `blueprints/<id>/` with `template.toml`, `docker-compose.yml`,
`meta.json` (`id` == `<id>`) and a `logo`, then run `generate-meta.mjs` +
`validate.mjs`. Keep the app's upstream license/attribution intact.
