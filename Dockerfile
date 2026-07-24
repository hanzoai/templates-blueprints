# templates.hanzo.ai — the Hanzo PaaS one-click deploy-template catalog, served
# by the house static server (ghcr.io/hanzoai/static, a Go binary on scratch),
# NOT nginx. hanzoai/platform (a Dokploy fork) reads this catalog over HTTP:
#
#   GET /meta.json                            -> JSON ARRAY of template metadata
#   GET /blueprints/<id>/template.toml        -> TOML config (parsed with `toml`)
#   GET /blueprints/<id>/docker-compose.yml   -> the compose stack
#   GET /blueprints/<id>/<logo>               -> the app logo asset
#
# static stamps `Access-Control-Allow-Origin: *` on every response, so the
# platform (platform.hanzo.ai) can fetch the catalog from any origin. We do NOT
# pass `-spa`: a request for a missing blueprint MUST return 404, never fall
# through to an index page (that would corrupt the platform's parse path).
#
# Built on Hanzo's own arc pool (hanzo-build-linux-amd64), never on a laptop,
# and only from ghcr.io (no Docker Hub pull, so no registry-1.docker.io flake).
FROM ghcr.io/hanzoai/static:0.4.1

# The catalog: the aggregated array + every blueprint's files + logos. Only
# these are served — the build scripts, Dockerfile and docs stay out of /public.
COPY meta.json /public/meta.json
COPY blueprints /public/blueprints
COPY index.html /public/index.html
COPY catalog.css /public/catalog.css

EXPOSE 3000
ENTRYPOINT ["/static", "-port", "3000", "-root", "/public"]
