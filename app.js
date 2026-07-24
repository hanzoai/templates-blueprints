// Hanzo OSS explorer — fetches the catalog and renders a fast, searchable gallery.
// Static-served (hanzoai/static): same-origin fetch of /meta.json, no framework.
'use strict';

var PLATFORM = 'https://platform.hanzo.ai/templates?deploy=';
var AUTHORS = 'https://console.hanzo.ai/authors';
var PAGE = 48;
// Build-provenance tags are catalog plumbing, not user categories.
var HIDE = { caprover: 1, dokploy: 1, coolify: 1, casaos: 1, runtipi: 1 };
var FEATURED = ['self-hosted', 'ai', 'database', 'media', 'productivity', 'monitoring', 'automation', 'developer'];

var all = [], view = [], shown = 0, active = '';

var grid = document.getElementById('grid');
var q = document.getElementById('q');
var tagsEl = document.getElementById('tags');
var moreBtn = document.getElementById('more');
var emptyEl = document.getElementById('empty');
var countEl = document.getElementById('count');

function ghRepo(t) {
  var u = (t.links && t.links.github) || '';
  var m = u.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  return m ? (m[1] + '/' + m[2].replace(/\.git$/, '')) : '';
}

function card(t) {
  var el = document.createElement('article');
  el.className = 'card';
  var repo = ghRepo(t);
  var logo = t.logo
    ? '<img class="logo" loading="lazy" alt="" src="/blueprints/' + t.id + '/' + t.logo + '" onerror="this.replaceWith(mono(\'' + (t.name || t.id).replace(/[^a-z0-9]/gi, '') + '\'))">'
    : monoHTML(t.name || t.id);
  el.innerHTML =
    logo +
    '<div class="body">' +
      '<p class="name">' + esc(t.name || t.id) + '</p>' +
      '<p class="desc">' + esc(t.description || '') + '</p>' +
      '<div class="row">' +
        '<a class="deploy" href="' + PLATFORM + encodeURIComponent(t.id) + '">Deploy</a>' +
        (t.links && t.links.github ? '<a class="link" target="_blank" rel="noopener" href="' + esc(t.links.github) + '">GitHub</a>' : '') +
        (repo ? '<a class="claim" title="Are you the maintainer?" href="' + AUTHORS + '?claim=' + encodeURIComponent(repo) + '">Earn 20% →</a>' : '') +
      '</div>' +
    '</div>';
  return el;
}

// exposed for the onerror fallback
window.mono = function (letter) {
  var d = document.createElement('div');
  d.className = 'logo mono';
  d.textContent = (letter || '?').charAt(0).toUpperCase();
  return d;
};
function monoHTML(name) {
  return '<div class="logo mono">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function render(reset) {
  if (reset) { grid.innerHTML = ''; shown = 0; }
  var frag = document.createDocumentFragment();
  var end = Math.min(shown + PAGE, view.length);
  for (var i = shown; i < end; i++) frag.appendChild(card(view[i]));
  grid.appendChild(frag);
  shown = end;
  moreBtn.hidden = shown >= view.length;
  emptyEl.hidden = view.length > 0;
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
}

var timer;
q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 90); });
moreBtn.addEventListener('click', function () { render(false); });

function buildTags() {
  FEATURED.forEach(function (name) {
    if (HIDE[name]) return;
    var b = document.createElement('button');
    b.className = 'tag'; b.textContent = name; b.dataset.tag = name;
    b.addEventListener('click', function () {
      if (active === name) { active = ''; b.classList.remove('on'); }
      else {
        active = name;
        Array.prototype.forEach.call(tagsEl.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
      }
      apply();
    });
    tagsEl.appendChild(b);
  });
}

fetch('/meta.json')
  .then(function (r) { return r.json(); })
  .then(function (data) {
    all = Array.isArray(data) ? data : [];
    if (countEl) countEl.textContent = all.length.toLocaleString();
    buildTags();
    view = all;
    render(true);
  })
  .catch(function () { emptyEl.hidden = false; emptyEl.textContent = 'Catalog failed to load — try /meta.json directly.'; });
