/* MNCloud in the browser. Routes: /files/<folder>, /recent, /shared, /trash, /devices, /search?q=.
   Views are built from DOM nodes, never from HTML strings, so no file name can run as code. */
(function () {
  'use strict';
  var main = document.getElementById('main'), me = null, csrf = '', here = null, office = false;
  var ICON = { folder: 'M3 7h7l2 2h9v10H3z', file: 'M6 3h8l4 4v14H6zM14 3v4h4', word: 'M6 3h8l4 4v14H6zM9 12h6M9 15h6M9 18h4', cell: 'M5 4h14v16H5zM5 9h14M5 14h14M10 4v16',
    slide: 'M4 5h16v11H4zM12 16v4M8 20h8', pdf: 'M6 3h8l4 4v14H6zM9 13h6M9 16h4', image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01', more: 'M5 12h.01M12 12h.01M19 12h.01',
    up: 'M12 16V4M7 9l5-5 5 5M4 20h16', plus: 'M12 5v14M5 12h14', share: 'M8 12h8M14 7l5 5-5 5M5 5v14', back: 'M15 18l-6-6 6-6' };

  // ---------------------------------------------------------------- helpers
  function h(tag, a) {
    var e = document.createElement(tag);
    for (var k in a || {}) { var v = a[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(e, x); }); else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  function svg(d) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); return s; }
  function api(method, path, body, raw) {
    var o = { method: method, headers: { 'x-cc-csrf': csrf }, credentials: 'same-origin' };
    if (raw) o.body = raw; else if (body) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; }
    return fetch('/api/' + path, o).then(function (r) {
      if (r.status === 401) { location.href = '/login?back=' + encodeURIComponent(location.pathname); return new Promise(function () {}); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; });
    });
  }
  var toastT; function toast(t) { var e = document.getElementById('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('on'); }, 3000); }
  function bytes(n) { if (n < 1000) return n + ' B'; var u = ['KB', 'MB', 'GB', 'TB'], i = -1; do { n /= 1000; i++; } while (n >= 1000 && i < 3); return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i]; }
  function when(t) { var d = new Date(t), s = (Date.now() - t) / 1000; if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 31536000 ? 'numeric' : undefined }); }
  function kind(it) { if (it.dir) return 'folder'; var e = it.name.split('.').pop().toLowerCase();
    return /^(docx?|odt|rtf|txt|md)$/.test(e) ? 'word' : /^(xlsx?|ods|csv)$/.test(e) ? 'cell' : /^(pptx?|odp)$/.test(e) ? 'slide' : e === 'pdf' ? 'pdf' : /^(png|jpe?g|gif|webp|svg)$/.test(e) ? 'image' : 'file'; }
  function head(title, trail, tools) { return h('div', {}, trail || null, h('div', { class: 'headrow' }, h('h1', { class: 'display', text: title }), tools ? h('div', { class: 'tools' }, tools) : null)); }
  function empty(title, text, extra) { return h('div', { class: 'empty' }, h('img', { src: '/brand/cloud-mark.svg', alt: '' }), h('h2', { class: 'display', text: title }), h('p', { text: text }), extra); }

  // ---------------------------------------------------------------- rows and menus
  function row(it, ctx) {
    var open = it.dir ? h('a', { href: '/files/' + it.id, onclick: link, text: it.name }) : h('button', { type: 'button', text: it.name, onclick: function () { openItem(it); } });
    var sub = it.ownerDisplay ? 'From ' + it.ownerDisplay + (it.perm === 'edit' ? ' · can edit' : ' · can view') : it.trashedAt ? 'Deleted ' + when(it.trashedAt) : it.modifiedBy && it.modifiedBy !== (me && me.id) ? 'Changed by @' + it.modifiedBy : '';
    var r = h('div', { class: 'row', role: 'row' },
      h('div', { class: 'icon ' + kind(it) }, svg(ICON[kind(it)] || ICON.file)),
      h('div', { class: 'name' }, h('div', {}, open, it.shared ? h('span', { class: 'badge', text: 'Shared' }) : null), sub ? h('small', { text: sub }) : null),
      h('div', { class: 'dim size', text: it.dir ? '—' : bytes(it.size) }),
      h('div', { class: 'dim when', text: when(it.trashedAt || it.mtime) }),
      h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'More for ' + it.name, onclick: function (e) { menu(e.currentTarget, it, ctx); } }, svg(ICON.more)));
    if (it.dir && ctx === 'files') { // drop files onto a folder row to upload into it
      r.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); r.classList.add('over'); } });
      r.addEventListener('dragleave', function () { r.classList.remove('over'); });
      r.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); r.classList.remove('over'); document.getElementById('drop').classList.remove('on'); upload(e.dataTransfer.files, it); });
    }
    return r;
  }
  function table(items, ctx) { return h('div', { class: 'files', role: 'table' }, h('div', { class: 'row head', role: 'row' }, h('span'), h('span', { text: 'Name' }), h('span', { class: 'size', text: 'Size' }), h('span', { class: 'when', text: ctx === 'trash' ? 'Deleted' : 'Changed' }), h('span')), items.map(function (it) { return row(it, ctx); })); }
  function closePopup() { var p = document.querySelector('.popup'); if (p) p.remove(); }
  function menu(at, it, ctx) {
    closePopup();
    var item = function (label, fn, cls) { return h('button', { type: 'button', class: cls || null, text: label, onclick: function () { closePopup(); fn(); } }); };
    var mine = it.owner === me.id, items = [];
    if (ctx === 'trash') items = [item('Put back', function () { act(api('POST', 'restore', { id: it.id }), 'Put back'); }), h('hr'), item('Delete forever', function () { purge(it); }, 'danger')];
    else {
      if (!it.dir && it.office) items.push(item('Open in MNOffice', function () { location.href = '/edit/' + it.id; }));
      if (it.dir) items.push(item('Open', function () { go('/files/' + it.id); }));
      if (!it.dir) items.push(item('Download', function () { location.href = '/api/download/' + it.id; }));
      if (mine) items.push(item('Share', function () { shareSheet(it); }));
      if (mine || it.perm === 'edit') items.push(item('Rename', function () { rename(it); }));
      if (mine) items.push(item('Move or copy', function () { moveSheet(it); }));
      if (!it.dir) items.push(item('Earlier versions', function () { versionsSheet(it); }));
      if (mine) items.push(h('hr'), item('Move to trash', function () { act(api('POST', 'trash', { id: it.id }), 'Moved to the trash'); }, 'danger'));
    }
    var p = h('div', { class: 'popup', role: 'menu' }, items), r = at.getBoundingClientRect();
    document.body.appendChild(p);
    p.style.top = Math.min(r.bottom + 6, innerHeight - p.offsetHeight - 12) + 'px'; p.style.left = Math.max(12, Math.min(r.right - p.offsetWidth, innerWidth - p.offsetWidth - 12)) + 'px';
    var first = p.querySelector('button'); if (first) first.focus();
  }
  addEventListener('keydown', function (e) { if (e.key === 'Escape') closePopup(); });
  // a click outside the open menu closes it; the click that opened it is not outside
  document.addEventListener('click', function (e) { var p = document.querySelector('.popup'); if (p && !p.contains(e.target) && !(e.target.closest && e.target.closest('.menu-btn, [data-popup]'))) closePopup(); });
  function act(p, done) { return p.then(function () { if (done) toast(done); route(); refreshSpace(); }).catch(function (e) { toast(e.message); }); }
  function openItem(it) { if (it.office) location.href = '/edit/' + it.id; else if (kind(it) === 'image' || kind(it) === 'pdf') open('/api/download/' + it.id + '?inline=1', '_blank', 'noopener'); else location.href = '/api/download/' + it.id; }

  // ---------------------------------------------------------------- sheets
  var dlg = document.getElementById('dialog');
  function sheet(content) { dlg.textContent = ''; add(dlg, content); if (!dlg.open) dlg.showModal(); var f = dlg.querySelector('input, button'); if (f) f.focus(); }
  function ask(title, label, value, ok) {
    return new Promise(function (res) {
      var input = h('input', { value: value || '', required: true, maxlength: 240, spellcheck: 'false' });
      var form = h('form', { method: 'dialog', onsubmit: function (e) { e.preventDefault(); dlg.close(); res(input.value.trim()); } },
        h('h2', { class: 'display', text: title }), h('label', { class: 'field' }, label, input),
        h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); res(null); } }), h('button', { class: 'btn primary', type: 'submit', text: ok || 'Save' })));
      sheet(form);
      var dot = input.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    });
  }
  function rename(it) { ask('Rename', 'New name', it.name, 'Rename').then(function (n) { if (n && n !== it.name) act(api('POST', 'rename', { id: it.id, name: n }), 'Renamed'); }); }
  function purge(it) { sheet(h('div', {}, h('h2', { class: 'display', text: 'Delete forever?' }), h('p', { text: it.name + ' will be gone for good, with its earlier versions.' }),
    h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); } }), h('button', { class: 'btn primary', type: 'button', text: 'Delete forever', onclick: function () { dlg.close(); act(api('POST', 'purge', { id: it.id }), 'Deleted'); } })))); }

  function shareSheet(it) {
    var list = h('div', { class: 'list' }), contacts = h('div', { class: 'list' }), perm = 'edit', q = h('input', { placeholder: 'A name, or someone from your contacts', autocomplete: 'off', spellcheck: 'false' });
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'They can' }, ['edit', 'view'].map(function (p) { return h('button', { type: 'button', 'aria-pressed': String(p === perm), text: p === 'edit' ? 'Can edit' : 'Can view', onclick: function () { perm = p; seg.querySelectorAll('button').forEach(function (b, i) { b.setAttribute('aria-pressed', String(['edit', 'view'][i] === p)); }); } }); }));
    var linkArea = h('div');
    function shareWith(name) {
      return api('POST', 'share', { id: it.id, with: name, perm: perm }).then(function () { toast('Shared with @' + name.replace(/^@/, '')); q.value = ''; draw(); }).catch(function (e) { toast(e.message); });
    }
    function draw() {
      api('GET', 'shares/' + it.id).then(function (r) {
        list.textContent = ''; linkArea.textContent = '';
        sharedTo = r.shares.filter(function (s) { return s.kind === 'user'; }).map(function (s) { return s.target; }); drawContacts(allContacts);
        r.shares.filter(function (s) { return s.kind === 'user'; }).forEach(function (s) {
          list.appendChild(h('div', { class: 'person' }, h('span', { class: 'avatar', text: (s.display || s.target)[0] }), h('div', {}, h('b', { text: s.display }), h('small', { text: '@' + s.target + ' · ' + (s.perm === 'edit' ? 'can edit' : 'can view') + (s.record ? ' · on your Social account' : '') })),
            h('button', { class: 'btn small quiet', type: 'button', text: 'Remove', onclick: function () { api('DELETE', 'share/' + s.id).then(draw).catch(function (e) { toast(e.message); }); } })));
        });
        var links = r.shares.filter(function (s) { return s.kind === 'link'; });
        if (links.length) links.forEach(function (s) {
          var inp = h('input', { readonly: true, value: s.url, 'aria-label': 'Share link' });
          linkArea.appendChild(h('div', { class: 'linkbox' }, inp, h('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: function () { navigator.clipboard.writeText(s.url).then(function () { toast('Link copied'); }); } }),
            h('button', { class: 'btn small quiet', type: 'button', text: 'Stop', onclick: function () { api('DELETE', 'share/' + s.id).then(draw); } })));
        });
        else linkArea.appendChild(h('button', { class: 'btn small', type: 'button', text: 'Make a link anyone can view', onclick: function () { api('POST', 'share', { id: it.id, kind: 'link', perm: 'view' }).then(draw).catch(function (e) { toast(e.message); }); } }));
      }).catch(function (e) { toast(e.message); });
    }
    function drawContacts(all) {
      var t = q.value.trim().replace(/^@/, '').toLowerCase();
      contacts.textContent = '';
      all.filter(function (c) { return sharedTo.indexOf(c.name) < 0; }).filter(function (c) { return !t || c.name.indexOf(t) >= 0 || c.display.toLowerCase().indexOf(t) >= 0; }).slice(0, 30).forEach(function (c) {
        contacts.appendChild(h('div', { class: 'person' }, c.avatar ? h('img', { class: 'avatar', src: c.avatar, alt: '' }) : h('span', { class: 'avatar', text: c.display[0] }),
          h('div', {}, h('b', { text: c.display }), h('small', { text: '@' + c.name + (c.mutual ? ' · friends' : c.youFollow ? ' · you follow' : ' · follows you') })),
          h('button', { class: 'btn small', type: 'button', text: 'Share', onclick: function () { shareWith(c.name); } })));
      });
      if (!contacts.childNodes.length && t) contacts.appendChild(h('div', { class: 'person' }, h('span', { class: 'avatar', text: t[0] || '?' }), h('div', {}, h('b', { text: '@' + t }), h('small', { text: 'Share with this Mundus Novus account' })), h('button', { class: 'btn small', type: 'button', text: 'Share', onclick: function () { shareWith(t); } })));
      if (!contacts.childNodes.length && !t) contacts.appendChild(h('p', { class: 'note', text: 'Your friends on Social show up here. You can also type anyone’s Mundus Novus name.' }));
    }
    var allContacts = [], sharedTo = [];
    q.addEventListener('input', function () { drawContacts(allContacts); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); shareWith(q.value.trim()); } });
    api('GET', 'contacts').then(function (r) { allContacts = r.contacts || []; drawContacts(allContacts); });
    sheet(h('div', {}, h('h2', { class: 'display', text: 'Share ' + (it.dir ? 'folder' : 'file') }), h('p', { text: it.name }),
      h('label', { class: 'field' }, 'Share with', q), h('div', {}, seg), contacts,
      h('p', { class: 'note', text: 'People you share with find it in Shared with you, get a notice on Social, and can work on documents with you at the same time. The share is also kept on your Social account.' }),
      h('h3', { text: 'Shared with' }), list, h('h3', { text: 'Link' }), linkArea,
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', text: 'Done', onclick: function () { dlg.close(); route(); } }))));
    draw();
  }

  function moveSheet(it) {
    var target = null, box = h('div', { class: 'folders' }), crumbs = h('div', { class: 'trail' });
    function show(id) {
      api('GET', 'list' + (id ? '/' + id : '')).then(function (r) {
        target = r.folder; box.textContent = ''; crumbs.textContent = '';
        r.trail.forEach(function (c, i) { crumbs.appendChild(h('a', { href: '#', text: c.name || 'Your files', onclick: function (e) { e.preventDefault(); show(c.id); } })); if (i < r.trail.length - 1) crumbs.appendChild(document.createTextNode(' / ')); });
        r.items.filter(function (x) { return x.dir && x.id !== it.id; }).forEach(function (f) { box.appendChild(h('button', { type: 'button', onclick: function () { show(f.id); } }, svg(ICON.folder), f.name)); });
        if (!box.childNodes.length) box.appendChild(h('p', { class: 'note', text: 'No folders inside. You can put it here.' }));
      });
    }
    function go2(how) { if (!target) return; dlg.close(); act(api('POST', how, { id: it.id, parent: target.id }), how === 'move' ? 'Moved' : 'Copied'); }
    sheet(h('div', {}, h('h2', { class: 'display', text: 'Move or copy' }), h('p', { text: it.name }), crumbs, box,
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); } }), h('button', { class: 'btn', type: 'button', text: 'Copy here', onclick: function () { go2('copy'); } }), h('button', { class: 'btn primary', type: 'button', text: 'Move here', onclick: function () { go2('move'); } }))));
    show(null);
  }
  function versionsSheet(it) {
    var list = h('div', { class: 'list' });
    sheet(h('div', {}, h('h2', { class: 'display', text: 'Earlier versions' }), h('p', { text: it.name + ' keeps its last ten versions. They count toward your space.' }), list,
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', text: 'Done', onclick: function () { dlg.close(); } }))));
    api('GET', 'versions/' + it.id).then(function (r) {
      if (!r.versions.length) list.appendChild(h('p', { class: 'note', text: 'There are no earlier versions yet.' }));
      r.versions.forEach(function (v) { list.appendChild(h('div', { class: 'person' }, h('span', { class: 'avatar', text: 'v' }), h('div', {}, h('b', { text: new Date(v.mtime).toLocaleString() }), h('small', { text: bytes(v.size) + (v.by ? ' · @' + v.by : '') })),
        h('button', { class: 'btn small', type: 'button', text: 'Bring back', onclick: function () { dlg.close(); act(api('POST', 'versions/' + it.id, { version: v.id }), 'Brought back. The newer version is kept too.'); } }))); });
    });
  }

  // ---------------------------------------------------------------- uploads
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  function upload(files, folder) {
    folder = folder || here; if (!folder || !files || !files.length) return;
    var box = document.querySelector('.uploads') || document.body.appendChild(h('div', { class: 'uploads', role: 'status', 'aria-live': 'polite' }));
    var jobs = Array.prototype.map.call(files, function (f) {
      var bar = h('progress', { max: 100, value: 0 }), line = h('div', { class: 'up' }, h('span', { text: f.name }), bar); box.appendChild(line);
      return function () { return new Promise(function (res) {
        var x = new XMLHttpRequest();
        x.open('PUT', '/api/upload?parent=' + folder.id + '&name=' + encodeURIComponent(f.name) + '&replace=1');
        x.setRequestHeader('x-cc-csrf', csrf);
        x.upload.onprogress = function (e) { if (e.lengthComputable) bar.value = 100 * e.loaded / e.total; };
        x.onload = function () { if (x.status >= 300) { var m = 'Could not upload ' + f.name; try { m = JSON.parse(x.responseText).error || m; } catch (e) {} toast(m); } line.remove(); res(); };
        x.onerror = function () { toast('Could not upload ' + f.name); line.remove(); res(); };
        x.send(f);
      }); };
    });
    (async function () { for (var j of jobs) await j(); if (!box.childNodes.length) box.remove(); route(); refreshSpace(); })();
  }
  var picker = document.getElementById('picker'), drop = document.getElementById('drop'), depth = 0;
  picker.addEventListener('change', function () { upload(picker.files); picker.value = ''; });
  addEventListener('dragenter', function (e) { if (hasFiles(e) && here) { depth++; drop.classList.add('on'); } });
  addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; drop.classList.remove('on'); } });
  addEventListener('dragover', function (e) { if (hasFiles(e) && here) e.preventDefault(); });
  addEventListener('drop', function (e) { if (!hasFiles(e) || !here) return; e.preventDefault(); depth = 0; drop.classList.remove('on'); upload(e.dataTransfer.files); });

  // ---------------------------------------------------------------- views
  function newMenu(at) {
    closePopup();
    var item = function (label, fn) { return h('button', { type: 'button', text: label, onclick: function () { closePopup(); fn(); } }); };
    var made = function (type, label) { return function () { ask('New ' + label, 'Name', label, 'Make it').then(function (n) { if (n) api('POST', 'new', { parent: here.id, type: type, name: n }).then(function (r) { location.href = '/edit/' + r.item.id; }).catch(function (e) { toast(e.message); }); }); }; };
    var items = [item('Folder', function () { ask('New folder', 'Name', '', 'Make it').then(function (n) { if (n) act(api('POST', 'folder', { parent: here.id, name: n }), 'Folder made'); }); })];
    if (office) items.push(h('hr'), item('Document', made('document', 'Document')), item('Spreadsheet', made('spreadsheet', 'Spreadsheet')), item('Presentation', made('presentation', 'Presentation')));
    var p = h('div', { class: 'popup', role: 'menu' }, items), r = at.getBoundingClientRect(); document.body.appendChild(p);
    p.style.top = (r.bottom + 6) + 'px'; p.style.left = Math.max(12, Math.min(r.left, innerWidth - p.offsetWidth - 12)) + 'px';
    p.querySelector('button').focus();
  }
  function files(id) {
    return api('GET', 'list' + (id ? '/' + id : '')).then(function (r) {
      here = r.folder.access === 'view' ? null : r.folder;
      var trail = h('nav', { class: 'trail', 'aria-label': 'Folder path' }, r.trail.slice(0, -1).map(function (c) { return [h('a', { href: '/files/' + (c.name ? c.id : ''), onclick: link, text: c.name || 'Your files' }), ' / ']; }));
      var tools = here ? [h('button', { class: 'btn', type: 'button', 'data-popup': true, onclick: function (e) { newMenu(e.currentTarget); } }, svg(ICON.plus), 'New'), h('button', { class: 'btn primary', type: 'button', onclick: function () { picker.click(); } }, svg(ICON.up), 'Upload')] : null;
      return [head(r.folder.home ? 'Your files' : r.folder.name, r.trail.length > 1 ? trail : null, tools),
        r.items.length ? table(r.items, 'files') : empty(r.folder.home ? 'Room for your work' : 'An empty folder', here ? 'Drop files here, or use Upload.' : 'Nothing here yet.', here ? h('button', { class: 'btn primary', type: 'button', onclick: function () { picker.click(); } }, svg(ICON.up), 'Upload') : null)];
    });
  }
  function flat(title, path, ctx, none) { here = null; return api('GET', path).then(function (r) { return [head(title, null, ctx === 'trash' && r.items.length ? [h('button', { class: 'btn', type: 'button', text: 'Empty the trash', onclick: function () { purge({ id: 'all', name: 'Everything in the trash' }); } })] : null), r.items.length ? table(r.items, ctx) : empty(none[0], none[1])]; }); }
  function devices() {
    here = null;
    return api('GET', 'devices').then(function (r) {
      var list = h('div', { class: 'files' }, r.devices.map(function (d) { return h('div', { class: 'row', style: 'grid-template-columns: 1fr auto' }, h('div', { class: 'name' }, h('b', { text: d.name }), h('small', { text: 'Connected ' + when(d.created) + (d.used ? ' · last used ' + when(d.used) : '') })),
        h('button', { class: 'btn small', type: 'button', text: 'Disconnect', onclick: function () { api('DELETE', 'devices/' + d.id).then(route); } })); }));
      return [head('Devices and apps'), h('p', { class: 'note', text: 'The computers and apps that can reach your Cloud. Each has its own key; disconnecting one does not affect the others.' }),
        r.devices.length ? list : empty('Nothing connected', 'Connect the desktop app, Sprite, Box or Office, and it will show here.')];
    });
  }

  // ---------------------------------------------------------------- routing
  function go(path, replace) { history[replace ? 'replaceState' : 'pushState'](null, '', path); route(); }
  function link(e) { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go(e.currentTarget.getAttribute('href')); }
  function route() {
    closePopup();
    var p = location.pathname, m, out, place = 'files';
    if ((m = /^\/files\/?(\d*)$/.exec(p))) out = files(m[1]);
    else if (p === '/recent') { place = 'recent'; out = flat('Recent', 'recent', 'recent', ['Nothing recent', 'Files you change show up here.']); }
    else if (p === '/shared') { place = 'shared'; out = flat('Shared with you', 'shared', 'shared', ['Nothing shared yet', 'When a friend shares with you, it shows up here.']); }
    else if ((m = /^\/shared\/(\d+)$/.exec(p))) { out = api('GET', 'list/' + m[1]).then(function () { go('/files/' + m[1], true); return []; }, function () { go('/shared', true); return []; }); }
    else if (p === '/trash') { place = 'trash'; out = flat('Trash', 'trash', 'trash', ['The trash is empty', 'Deleted files wait here for 30 days.']); }
    else if (p === '/devices') { place = 'devices'; out = devices(); }
    else if (p === '/search') { var q = new URLSearchParams(location.search).get('q') || ''; document.getElementById('q').value = q; out = flat('Results for “' + q + '”', 'search?q=' + encodeURIComponent(q), 'search', ['Nothing found', 'Try another name.']); }
    else { go('/files/', true); return; }
    document.querySelectorAll('[data-place]').forEach(function (a) { a.setAttribute('aria-current', a.dataset.place === place ? 'page' : 'false'); });
    Promise.resolve(out).then(function (nodes) { main.textContent = ''; add(main, nodes); document.title = (main.querySelector('h1') ? main.querySelector('h1').textContent + ' · ' : '') + 'MNCloud'; })
      .catch(function (e) { main.textContent = ''; add(main, empty('Not here', e.message)); });
  }
  function refreshSpace() {
    return api('GET', 'me').then(function (r) {
      me = r.user; csrf = r.csrf; office = r.office;
      var u = r.usage, pct = Math.min(100, 100 * u.used / u.quota), s = document.getElementById('space');
      s.textContent = ''; add(s, [h('b', { text: bytes(u.used) }), ' of ' + bytes(u.quota) + ' used', h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': u.quota, 'aria-valuenow': u.used, 'aria-label': 'Storage used' }, h('i', { style: 'width:' + pct.toFixed(1) + '%' })), u.used > u.quota * 0.9 ? 'Nearly full. Emptying the trash frees space.' : 'Free with your Mundus Novus account.']);
      var who = document.getElementById('who'); who.textContent = '';
      add(who, [h('span', { text: me.display }), h('span', { class: 'avatar', text: (me.display || me.id)[0] }), h('form', { method: 'post', action: '/logout' }, h('button', { class: 'btn small quiet', type: 'submit', text: 'Sign out' }))]);
    });
  }
  document.querySelectorAll('[data-go]').forEach(function (a) { a.addEventListener('click', link); });
  document.getElementById('find').addEventListener('submit', function (e) { e.preventDefault(); var q = document.getElementById('q').value.trim(); if (q) go('/search?q=' + encodeURIComponent(q)); });
  addEventListener('popstate', route);
  refreshSpace().then(route);
})();
