# Attribution

The blueprint catalog in this repository is **aggregated** from several
open-source one-click / self-hosting catalogs. Blueprints are converted into the
Dokploy blueprint shape (`template.toml` + `docker-compose.yml` + `meta.json` +
logo) that the Hanzo PaaS consumes. **Each source retains its own license, and
each individual application retains the license of its own upstream project.**
Where an upstream logo was unavailable, a Hanzo mark is used as a fallback; all
available upstream logos and app names are carried through unchanged.

De-duplication is by app identity (`id`); when the same app appears in more than
one source, the first source in this priority order wins:
**Dokploy → Coolify → CapRover → CasaOS → Runtipi**.

| Source | Repository | License | Notes |
|--------|------------|---------|-------|
| Dokploy Templates | `github.com/Dokploy/templates` | MIT | Blueprints copied verbatim (already in the target shape). |
| Coolify | `github.com/coollabsio/coolify` (`templates/compose`) | Apache-2.0 | `SERVICE_*` magic vars mapped to Hanzo `${...}` generators; magic comments → tags. |
| CapRover One-Click Apps | `github.com/caprover/one-click-apps` (`public/v4/apps`) | Apache-2.0 | `$$cap_*` variables mapped to `${...}`; `srv-captain--` service DNS normalized. Build-only apps dropped. |
| CasaOS App Store | `github.com/IceWhaleTech/CasaOS-AppStore` (`Apps`) | Apache-2.0 | `x-casaos` metadata → meta.json + domain port. |
| Runtipi App Store | `github.com/runtipi/runtipi-appstore` (`apps`) | GPL-3.0 | `config.json` → meta.json; `docker-compose.json` normalized to compose. Blueprints derived from this source are noted here as GPL-3.0-origin. |

## Per-app licenses

Every application deployed through this catalog is the property of its respective
authors and is distributed under that application's own license (linked from each
blueprint's `meta.json` `links.github` / `links.website`). This catalog is a
convenience index of publicly documented deploy configurations; it does not
relicense any application.

## Removal / correction

To correct an attribution, fix a blueprint, or request removal of an entry, open
an issue or PR against `github.com/hanzoai/templates-blueprints`.
