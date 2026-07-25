// oss.hanzo.ai — the open-source explorer. One file, no framework, no inline JS
// (CSP: script-src 'self'). Everything is built with the DOM API — never
// innerHTML — so a hostile description can't inject, a missing logo can't break
// the grid, and nothing runs afoul of the strict Content-Security-Policy.
// Resilient by construction: the story (hero, beliefs, makers) is static HTML
// that stands alone; only the catalog below needs data, and one bad row is
// skipped, never fatal.
'use strict';

var DEPLOY = 'https://platform.hanzo.ai/templates?deploy=';
var EARN = 'https://console.hanzo.ai/authors';
var PAGE = 60;

// The eight domains a human actually browses by. Each maps to a set of real
// tags (build-provenance tags — caprover/dokploy/coolify/casaos/runtipi — are
// never here). Filtering is one intersection test, parameterised by the set.
var DOMAINS = [
  { key: 'self-hosted', label: 'Self-hosted',
    blurb: 'Run it on your own hardware. Your data never leaves the building.',
    tags: ['self-hosted', 'selfhosted', 'homelab', 'privacy', 'local-first', 'home'] },
  { key: 'ai', label: 'AI',
    blurb: 'Local LLMs, vector search, agents — the whole AI stack, yours to run.',
    tags: ['ai', 'llm', 'machine-learning', 'chatbot', 'openai', 'anthropic', 'rag', 'agent', 'agents', 'ollama', 'langchain', 'llmops', 'nlp', 'inference', 'generative-ai', 'artificial-intelligence'] },
  { key: 'database', label: 'Databases',
    blurb: 'Where your data lives. Postgres, Redis, and everything that remembers.',
    tags: ['database', 'databases', 'postgres', 'postgresql', 'postgresdb', 'pgsql', 'mysql', 'mariadb', 'redis', 'mongodb', 'sqlite', 'sql', 'key-value', 'time-series', 'olap', 'vector-database', 'vector-db', 'clickhouse', 'surrealdb', 'nosql'] },
  { key: 'media', label: 'Media',
    blurb: 'Movies, music, photos — your own streaming service, no subscription.',
    tags: ['media', 'media-server', 'media-system', 'streaming', 'video', 'videos', 'music', 'movies', 'photos', 'photo', 'tv', 'audio', 'podcast', 'podcasts', 'plex', 'jellyfin', 'live-streaming'] },
  { key: 'productivity', label: 'Productivity',
    blurb: 'Notes, docs, tasks, calendars — the tools you live in, self-owned.',
    tags: ['productivity', 'notes', 'note-taking', 'notebook', 'documents', 'tasks', 'todo', 'calendar', 'kanban', 'project-management', 'projectmanagement', 'knowledge-base', 'knowledge-management', 'wiki', 'office', 'collaboration', 'crm', 'erp'] },
  { key: 'monitoring', label: 'Monitoring',
    blurb: 'Watch your systems breathe. Metrics, logs, and alerts before users notice.',
    tags: ['monitoring', 'observability', 'metrics', 'logging', 'logs', 'alerting', 'alerts', 'apm', 'uptime', 'status-page', 'status', 'tracing', 'dashboard', 'analytics'] },
  { key: 'automation', label: 'Automation',
    blurb: 'Wire anything to anything. Let the robots do the boring parts.',
    tags: ['automation', 'workflow', 'workflows', 'low-code', 'no-code', 'nocode', 'lowcode', 'integration', 'orchestration', 'scheduler', 'cron', 'background-jobs', 'background-tasks', 'queue', 'messaging'] },
  { key: 'developer', label: 'Developer',
    blurb: 'Git, CI, APIs, and backends — the machinery you ship software with.',
    tags: ['developer', 'development', 'developer-tools', 'devtools', 'git', 'ci-cd', 'ci', 'cd', 'version-control', 'versioncontrol', 'code', 'devops', 'api', 'backend', 'ide', 'serverless', 'docker'] }
];
var DOMAP = {};
DOMAINS.forEach(function (d) { d.set = {}; d.tags.forEach(function (t) { d.set[t] = 1; }); DOMAP[d.key] = d; });

// Start here — hand-picked, iconic, with a plain-English line for what it IS.
// Rendered through the same card factory as the grid (one renderer), just in
// spotlight dress. A pick missing from the catalog is silently skipped.
var FEATURED = [
  ['supabase',    'The open-source Firebase. Postgres, auth, and APIs in one.'],
  ['n8n',         'Wire anything to anything. Automation without the glue code.'],
  ['ollama',      'Run open LLMs on your own metal. No API keys, no limits.'],
  ['ghost',       'Publishing without the ads. A newsletter and blog you own.'],
  ['postgres',    'The database the internet is built on.'],
  ['grafana',     'See everything, all at once. Dashboards for any metric.'],
  ['nextcloud',   'Your files, your cloud. Drive, calendar, and contacts, self-hosted.'],
  ['immich',      'Google Photos, but yours. Every photo, backed up at home.'],
  ['gitea',       'Git hosting you control. Lightweight, fast, all yours.'],
  ['vaultwarden', 'Passwords you actually own. A Bitwarden server of your own.'],
  ['uptime-kuma', 'Know before your users do. Uptime monitoring, beautifully simple.'],
  ['redis',       'Memory at the speed of light. The cache behind everything fast.']
];

var $ = function (id) { return document.getElementById(id); };
var el = function (tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

var ALL = [], BYID = {}, view = [], shown = 0, active = '';
var armed = false, io = null;
var grid, q, moreBtn, emptyEl, countEl, featuredEl, domainsEl, chipEl, resultEl, catalogEl;

function ghRepo(t) {
  var u = (t.links && t.links.github) || '';
  var m = u.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  return m ? m[1] + '/' + m[2].replace(/\.git$/, '') : '';
}

// A logo that degrades gracefully: try the image; on error (or when absent),
// fall back to a monogram tile. No inline handler — bound here, CSP-clean.
function logo(t) {
  var initial = (t.name || t.id || '?').charAt(0).toUpperCase();
  var mono = el('div', 'logo mono', initial);
  if (!t.logo) return mono;
  var img = el('img', 'logo');
  img.loading = 'lazy';
  img.alt = '';
  img.src = '/blueprints/' + encodeURIComponent(t.id) + '/' + t.logo;
  img.addEventListener('error', function () {
    if (img.parentNode) img.parentNode.replaceChild(mono, img);
  });
  return img;
}

// One card factory. opts.spotlight -> the roomier "Start here" treatment;
// opts.note -> a curated one-liner shown in place of the raw description.
function card(t, opts) {
  opts = opts || {};
  var c = el('article', opts.spotlight ? 'card spot' : 'card');

  c.appendChild(logo(t));

  var body = el('div', 'body');
  body.appendChild(el('p', 'name', t.name || t.id));
  body.appendChild(el('p', 'desc', opts.note || t.description || ''));

  var row = el('div', 'row');
  var deploy = el('a', 'deploy', 'Deploy');
  deploy.href = DEPLOY + encodeURIComponent(t.id);
  row.appendChild(deploy);

  if (t.links && t.links.github) {
    var gh = el('a', 'link', 'GitHub');
    gh.href = t.links.github; gh.target = '_blank'; gh.rel = 'noopener noreferrer';
    row.appendChild(gh);
  }
  var repo = ghRepo(t);
  if (repo) {
    var earn = el('a', 'claim', 'Earn 20% →');
    earn.href = EARN + '?claim=' + encodeURIComponent(repo);
    earn.title = 'Are you the maintainer? Earn 20% of the compute revenue.';
    row.appendChild(earn);
  }
  body.appendChild(row);
  c.appendChild(body);
  return c;
}

function inDomain(t) {
  var d = DOMAP[active]; if (!d) return true;
  var tags = t.tags || [];
  for (var i = 0; i < tags.length; i++) if (d.set[tags[i]]) return true;
  return false;
}

function counts() {
  if (!resultEl) return;
  var d = DOMAP[active];
  var term = q && q.value.trim();
  var txt;
  if (term) txt = view.length + (view.length === 1 ? ' match' : ' matches');
  else if (d) txt = view.length.toLocaleString() + ' in ' + d.label;
  else txt = ALL.length.toLocaleString() + ' apps';
  resultEl.textContent = txt;
}

function render(reset) {
  if (reset) { grid.textContent = ''; shown = 0; }
  var frag = document.createDocumentFragment();
  var end = Math.min(shown + PAGE, view.length);
  for (var i = shown; i < end; i++) {
    try { frag.appendChild(card(view[i])); } catch (e) { /* skip one bad row, never break the grid */ }
  }
  grid.appendChild(frag);
  shown = end;
  moreBtn.hidden = shown >= view.length;
  emptyEl.hidden = view.length > 0;
}

// The 1,030-card grid is expensive, so it is deferred: nothing renders until the
// catalog scrolls near (IntersectionObserver) or the reader searches/filters.
function apply() {
  if (io) { io.disconnect(); io = null; }
  armed = true;
  var term = (q.value || '').trim().toLowerCase();
  view = ALL.filter(function (t) {
    if (active && !inDomain(t)) return false;
    if (!term) return true;
    return (t.name || '').toLowerCase().indexOf(term) >= 0 ||
           (t.description || '').toLowerCase().indexOf(term) >= 0 ||
           (t.id || '').toLowerCase().indexOf(term) >= 0 ||
           (t.tags || []).join(' ').toLowerCase().indexOf(term) >= 0;
  });
  counts();
  render(true);
}

function chip() {
  if (!chipEl) return;
  chipEl.textContent = '';
  var d = DOMAP[active]; if (!d) return;
  var b = el('button', 'chip', d.label + '  ✕');
  b.setAttribute('aria-label', 'Clear ' + d.label + ' filter');
  b.addEventListener('click', function () { setDomain(''); });
  chipEl.appendChild(b);
}

// The one path for browse-by-domain — domain cards and the clear-chip both call
// it. Sets the filter, reflects it, renders, and brings results into view.
function setDomain(key) {
  active = (active === key) ? '' : key;
  if (domainsEl) Array.prototype.forEach.call(domainsEl.children, function (c) {
    c.classList.toggle('on', c.getAttribute('data-key') === active);
  });
  chip();
  apply();
  if (catalogEl) catalogEl.scrollIntoView({ block: 'start' });
}

function renderFeatured() {
  if (!featuredEl) return;
  var frag = document.createDocumentFragment();
  FEATURED.forEach(function (pair) {
    try {
      var t = BYID[pair[0]]; if (!t) return;
      frag.appendChild(card(t, { spotlight: true, note: pair[1] }));
    } catch (e) { /* skip one pick, never break the row */ }
  });
  featuredEl.appendChild(frag);
}

function renderDomains() {
  if (!domainsEl) return;
  var frag = document.createDocumentFragment();
  DOMAINS.forEach(function (d) {
    try {
      var n = ALL.filter(function (t) {
        var tags = t.tags || [];
        for (var i = 0; i < tags.length; i++) if (d.set[tags[i]]) return true;
        return false;
      }).length;
      if (!n) return;
      var b = el('button', 'domain');
      b.setAttribute('data-key', d.key);
      b.appendChild(el('span', 'domain-count', n.toLocaleString()));
      b.appendChild(el('span', 'domain-label', d.label));
      b.appendChild(el('span', 'domain-blurb', d.blurb));
      b.addEventListener('click', function () { setDomain(d.key); });
      frag.appendChild(b);
    } catch (e) { /* skip one domain, never break the row */ }
  });
  domainsEl.appendChild(frag);
}

function fail(msg) {
  if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = msg; }
  if (resultEl) resultEl.textContent = '';
}

function start() {
  grid = $('grid'); q = $('q'); moreBtn = $('more'); emptyEl = $('empty');
  countEl = $('count'); featuredEl = $('featured'); domainsEl = $('domains');
  chipEl = $('active-filter'); resultEl = $('result-count');
  catalogEl = document.querySelector('.catalog');
  if (!grid) return;

  moreBtn.addEventListener('click', function () { render(false); });
  var timer;
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 80); });

  fetch('/meta.json', { cache: 'default' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      ALL = (Array.isArray(data) ? data : []).filter(function (t) { return t && t.id; });
      if (!ALL.length) return fail('Catalog is empty.');
      ALL.forEach(function (t) { BYID[t.id] = t; });
      if (countEl) countEl.textContent = ALL.length.toLocaleString();
      renderFeatured();
      renderDomains();
      view = ALL;
      counts();
      // Arm the deferred grid: render when it scrolls near, or on first search.
      if ('IntersectionObserver' in window && catalogEl) {
        io = new IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) apply();
        }, { rootMargin: '400px 0px' });
        io.observe(catalogEl);
      } else {
        apply();
      }
    })
    .catch(function () { fail('Catalog failed to load. Try /meta.json directly.'); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
