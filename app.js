// oss.hanzo.ai — one file, no framework, no inline JS (CSP: script-src 'self').
// Loaded blocking in <head> so the theme is applied before first paint (no
// flash); the catalog work waits for DOMContentLoaded. Everything is built with
// the DOM API — never innerHTML — so a hostile description can't inject, a
// missing logo can't break the grid, and one bad row is skipped, never fatal.
// Reads the SAME /meta.json + /blueprints/<id>/ the PaaS loader consumes.
'use strict';

/* ---------------------------------------------------------------- theme ---- */
// Applied immediately (this script is blocking in <head>): with an explicit
// saved choice we stamp [data-theme] before the body paints; with none, the CSS
// follows the OS via prefers-color-scheme. The toggle is wired once the DOM is up.
(function () {
  var KEY = 'hz-theme';
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* private mode / storage blocked — fall back to OS */ }

  function effective() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function wireToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    });
  }
  onReady(wireToggle);
})();

/* --------------------------------------------------------------- catalog --- */
var DEPLOY = 'https://platform.hanzo.ai/templates?deploy='; // PROVEN live (200)
var CATALOG = '/meta.json';
var LOGO_BASE = '/blueprints/';
var PAGE = 48;

// Build-provenance tags are catalog plumbing, not user-facing categories.
var HIDE = { caprover: 1, dokploy: 1, coolify: 1, casaos: 1, runtipi: 1, docker: 1, free: 1, 'open-source': 1 };
// Recognizable categories shown first (only if present in the data), then the
// most common remaining tags fill the bar — so it always reflects the real set.
var PREFERRED = ['ai', 'llm', 'database', 'automation', 'monitoring', 'analytics',
  'media', 'cms', 'productivity', 'security', 'storage', 'development', 'devtools',
  'communication', 'networking', 'finance', 'self-hosted'];
var MAX_TAGS = 16;
var LABEL = { ai: 'AI', llm: 'LLM', cms: 'CMS', api: 'API', crm: 'CRM', erp: 'ERP',
  dns: 'DNS', vpn: 'VPN', iot: 'IoT', ci: 'CI', cd: 'CD', devtools: 'Dev tools',
  s3: 'S3', 'self-hosted': 'Self-hosted' };
// Too generic to be a useful per-card badge.
var GENERIC = { 'self-hosted': 1, 'open-source': 1, docker: 1, free: 1, app: 1, web: 1, hosting: 1, utilities: 1 };

var all = [], view = [], shown = 0, active = '';
var grid, q, tagsEl, moreBtn, emptyEl, resultEl;

function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function label(tag) { return LABEL[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1)); }
function githubUrl(t) { return (t.links && t.links.github) || ''; }

// The most specific, non-generic tag — the card's category badge.
function badgeTag(t) {
  var tags = t.tags || [];
  for (var i = 0; i < tags.length; i++) if (!GENERIC[tags[i]] && !HIDE[tags[i]]) return tags[i];
  for (var j = 0; j < tags.length; j++) if (!HIDE[tags[j]]) return tags[j];
  return '';
}
function monoNode(name) { return el('div', 'logo mono', (name || '?').charAt(0).toUpperCase()); }

// One card factory. Logo degrades to a monogram on error (bound in JS — no
// inline onerror, CSP-clean). Deploy is the one-click deep link; Source is the repo.
function card(t) {
  var c = el('article', 'card');

  if (t.logo) {
    var img = el('img', 'logo');
    img.loading = 'lazy'; img.alt = '';
    img.src = LOGO_BASE + encodeURIComponent(t.id) + '/' + encodeURIComponent(t.logo);
    img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(monoNode(t.name || t.id), img); });
    c.appendChild(img);
  } else {
    c.appendChild(monoNode(t.name || t.id));
  }

  var body = el('div', 'body');
  var nameRow = el('div', 'name-row');
  nameRow.appendChild(el('p', 'name', t.name || t.id));
  var bt = badgeTag(t);
  if (bt) nameRow.appendChild(el('span', 'cat', label(bt)));
  body.appendChild(nameRow);
  body.appendChild(el('p', 'desc', t.description || ''));

  var row = el('div', 'row');
  var deploy = el('a', 'deploy', 'Deploy');
  deploy.href = DEPLOY + encodeURIComponent(t.id);
  deploy.setAttribute('aria-label', 'Deploy ' + (t.name || t.id) + ' on Hanzo');
  row.appendChild(deploy);

  var gh = githubUrl(t);
  if (gh) {
    var link = el('a', 'link', 'Source');
    link.href = gh; link.target = '_blank'; link.rel = 'noopener noreferrer';
    row.appendChild(link);
  }
  body.appendChild(row);
  c.appendChild(body);
  return c;
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
  if (resultEl) {
    if (!all.length) resultEl.textContent = '';
    else if (view.length === all.length) resultEl.textContent = 'Showing all ' + all.length.toLocaleString() + ' apps';
    else resultEl.textContent = 'Showing ' + view.length.toLocaleString() + ' of ' + all.length.toLocaleString() + ' apps';
  }
}

function apply() {
  var term = q.value.trim().toLowerCase();
  view = all.filter(function (t) {
    if (active && !(t.tags || []).some(function (x) { return x === active; })) return false;
    if (!term) return true;
    return (t.name || '').toLowerCase().indexOf(term) >= 0 ||
           (t.description || '').toLowerCase().indexOf(term) >= 0 ||
           (t.id || '').toLowerCase().indexOf(term) >= 0 ||
           (t.tags || []).join(' ').toLowerCase().indexOf(term) >= 0;
  });
  render(true);
  syncHash();
}

// ---- category chips (data-driven: recognizable first, then most common) ----
function chipList() {
  var freq = {};
  all.forEach(function (t) { (t.tags || []).forEach(function (tag) { if (!HIDE[tag]) freq[tag] = (freq[tag] || 0) + 1; }); });
  var chosen = [], seen = {};
  PREFERRED.forEach(function (tag) { if (freq[tag] && !seen[tag]) { chosen.push(tag); seen[tag] = 1; } });
  Object.keys(freq)
    .filter(function (tag) { return !seen[tag]; })
    .sort(function (a, b) { return freq[b] - freq[a]; })
    .forEach(function (tag) { if (chosen.length < MAX_TAGS) { chosen.push(tag); seen[tag] = 1; } });
  return chosen.slice(0, MAX_TAGS);
}
function setActive(tag, btn) {
  if (active === tag) {
    active = ''; if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
  } else {
    active = tag;
    Array.prototype.forEach.call(tagsEl.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
    if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
  }
  apply();
}
function buildTags() {
  chipList().forEach(function (tag) {
    var b = el('button', 'tag', label(tag));
    b.type = 'button'; b.dataset.tag = tag; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setActive(tag, b); });
    tagsEl.appendChild(b);
  });
}

// ---- shareable/deep-linkable state in the URL hash ----
function syncHash() {
  var p = [];
  if (q.value.trim()) p.push('q=' + encodeURIComponent(q.value.trim()));
  if (active) p.push('tag=' + encodeURIComponent(active));
  var url = p.length ? '#' + p.join('&') : location.pathname + location.search;
  try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
}
function readHash() {
  var h = location.hash.replace(/^#/, '');
  if (!h) return;
  var params = {};
  h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
  if (params.q) q.value = params.q;
  if (params.tag) {
    active = params.tag;
    Array.prototype.forEach.call(tagsEl.children, function (c) {
      if (c.dataset.tag === active) { c.classList.add('on'); c.setAttribute('aria-pressed', 'true'); }
    });
  }
}

function fail(msg) { if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = msg; } if (resultEl) resultEl.textContent = ''; }

function start() {
  grid = document.getElementById('grid'); q = document.getElementById('q');
  tagsEl = document.getElementById('tags'); moreBtn = document.getElementById('more');
  emptyEl = document.getElementById('empty'); resultEl = document.getElementById('result-count');
  if (!grid || !q) return;

  moreBtn.addEventListener('click', function () { render(false); });
  var timer;
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 80); });
  document.addEventListener('keydown', function (e) {
    var elx = document.activeElement, typing = elx && (elx.tagName === 'INPUT' || elx.tagName === 'TEXTAREA');
    if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); }
    else if (e.key === 'Escape') {
      if (q.value || active) {
        q.value = ''; active = '';
        Array.prototype.forEach.call(tagsEl.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
        apply();
      }
      if (typing) elx.blur();
    }
  });

  fetch(CATALOG, { cache: 'default' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      all = (Array.isArray(data) ? data : []).filter(function (t) { return t && t.id; });
      if (!all.length) return fail('Catalog is empty.');
      var counts = document.querySelectorAll('#count, #count-2');
      Array.prototype.forEach.call(counts, function (n) { n.textContent = all.length.toLocaleString(); });
      buildTags();
      readHash();
      apply();
    })
    .catch(function () { fail('Catalog failed to load — open /meta.json directly.'); });
}

onReady(start);
