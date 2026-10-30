/* A share link: shows who shared what, lets anyone download it, and walks into shared folders. */
(function () {
  'use strict';
  var token = location.pathname.split('/')[2], view = document.getElementById('view');
  function h(tag, a) { var e = document.createElement(tag); for (var k in a || {}) { if (k === 'text') e.textContent = a[k]; else if (k === 'class') e.className = a[k]; else e.setAttribute(k, a[k]); } for (var i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(typeof arguments[i] === 'string' ? document.createTextNode(arguments[i]) : arguments[i]); return e; }
  function bytes(n) { if (n < 1000) return n + ' B'; var u = ['KB', 'MB', 'GB'], i = -1; do { n /= 1000; i++; } while (n >= 1000 && i < 2); return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i]; }
  function show(id) {
    fetch('/s/' + token + '/info' + (id ? '?id=' + id : '')).then(function (r) { return r.json(); }).then(function (r) {
      view.textContent = '';
      if (r.error) { view.appendChild(h('div', { class: 'empty' }, h('h2', { class: 'display', text: 'Not here' }), h('p', { text: r.error }))); return; }
      view.appendChild(h('p', { class: 'note', text: r.owner + ' shared this with you.' }));
      view.appendChild(h('h1', { class: 'display', text: r.item.name }));
      if (!r.item.dir) { view.appendChild(h('p', { class: 'note', text: bytes(r.item.size) })); view.appendChild(h('a', { class: 'btn primary', href: '/s/' + token + '/download/' + r.item.id, text: 'Download' })); return; }
      if (r.item.id !== r.top) { var back = h('a', { href: '#', class: 'btn small quiet', text: 'Back to the top' }); back.onclick = function (e) { e.preventDefault(); show(null); }; view.appendChild(back); }
      var box = h('div', { class: 'files', style: 'margin-top:14px' });
      r.items.forEach(function (it) {
        var a = h('a', { href: it.dir ? '#' : '/s/' + token + '/download/' + it.id, text: it.name });
        if (it.dir) a.onclick = function (e) { e.preventDefault(); show(it.id); };
        box.appendChild(h('div', { class: 'row', style: 'grid-template-columns:1fr auto' }, h('div', { class: 'name' }, a), h('span', { class: 'dim', text: it.dir ? 'Folder' : bytes(it.size) })));
      });
      if (!r.items.length) box.appendChild(h('div', { class: 'empty' }, h('p', { text: 'This folder is empty.' })));
      view.appendChild(box);
    });
  }
  show(null);
})();
