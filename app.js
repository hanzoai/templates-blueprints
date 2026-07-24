// oss.hanzo.ai — the open-source explorer. One file, no framework, no inline JS
// (CSP: script-src 'self'). Cards are built with the DOM API — never innerHTML —
// so a hostile description can't inject, a missing logo can't break the grid, and
// nothing here runs afoul of the strict Content-Security-Policy. Resilient by
// construction: one bad template is skipped, never fatal.
'use strict';

var DEPLOY = 'https://platform.hanzo.ai/templates?deploy=';
var EARN = 'https://console.hanzo.ai/authors';
var PAGE = 60;

// Build-provenance tags are catalog plumbing, not categories a human browses by.
var HIDE = { caprover: 1, dokploy: 1, coolify: 1, casaos: 1, runtipi: 1 };
var FEATURED = ['self-hosted', 'ai', 'database', 'media', 'productivity', 'monitoring', 'automation', 'developer'];

var $ = function (id) { return document.getElementById(id); };
var el = function (tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

var ALL = [], view = [], shown = 0, active = '';
var grid, q, tagsEl, moreBtn, emptyEl, countEl;

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

function card(t) {
  var c = el('article', 'card');

  c.appendChild(logo(t));

  var body = el('div', 'body');
  body.appendChild(el('p', 'name', t.name || t.id));
  body.appendChild(el('p', 'desc', t.description || ''));

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
  if (countEl) countEl.textContent = ALL.length.toLocaleString();
}

function apply() {
  var term = q.value.trim().toLowerCase();
  view = ALL.filter(function (t) {
    if (active && (t.tags || []).indexOf(active) < 0) return false;
    if (!term) return true;
    return (t.name || '').toLowerCase().indexOf(term) >= 0 ||
           (t.description || '').toLowerCase().indexOf(term) >= 0 ||
           (t.id || '').toLowerCase().indexOf(term) >= 0 ||
           (t.tags || []).join(' ').toLowerCase().indexOf(term) >= 0;
  });
  render(true);
}

function buildTags() {
  FEATURED.forEach(function (name) {
    if (HIDE[name]) return;
    var b = el('button', 'tag', name);
    b.addEventListener('click', function () {
      var on = active === name;
      Array.prototype.forEach.call(tagsEl.children, function (c) { c.classList.remove('on'); });
      active = on ? '' : name;
      if (!on) b.classList.add('on');
      apply();
    });
    tagsEl.appendChild(b);
  });
}

function fail(msg) {
  if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = msg; }
}

function start() {
  grid = $('grid'); q = $('q'); tagsEl = $('tags'); moreBtn = $('more');
  emptyEl = $('empty'); countEl = $('count');
  if (!grid) return;

  moreBtn.addEventListener('click', function () { render(false); });
  var timer;
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 80); });

  fetch('/meta.json', { cache: 'default' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      ALL = (Array.isArray(data) ? data : []).filter(function (t) { return t && t.id; });
      if (!ALL.length) return fail('Catalog is empty.');
      buildTags();
      view = ALL;
      render(true);
    })
    .catch(function () { fail('Catalog failed to load. Try /meta.json directly.'); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
