/* Opens a Cloud file in MNOffice. Cloud signs the editor settings; everyone on the same version shares one
   document key, so co-editors see each other's changes as they type. */
(function () {
  'use strict';
  var id = location.pathname.split('/').pop();
  // the document server's messages can carry HTML line breaks; show them as plain text
  function say(t, n) { document.getElementById('title').textContent = t; document.getElementById('note').textContent = String(n || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''); }
  var slow = setTimeout(function () { say('Still opening', 'This is taking longer than usual. Large documents take a moment the first time; if nothing changes, reload the page.'); }, 45000);
  fetch('/api/editor/' + id + '?lang=' + encodeURIComponent((navigator.language || 'en').slice(0, 2)), { credentials: 'same-origin' })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'This document cannot be opened.'); return j; }); })
    .then(function (r) {
      document.title = r.item.name + ' · MNOffice';
      var s = document.createElement('script');
      s.src = r.api;
      s.onload = function () {
        r.config.events = {
          onAppReady: function () { clearTimeout(slow); document.getElementById('wait').hidden = true; },
          onRequestClose: function () { location.href = '/files/'; },
          onError: function (e) { clearTimeout(slow); say('MNOffice ran into a problem', (e && e.data && e.data.errorDescription) || ''); document.getElementById('wait').hidden = false; }
        };
        r.config.width = '100%'; r.config.height = '100%';
        new window.DocsAPI.DocEditor('editor', r.config);
      };
      s.onerror = function () { clearTimeout(slow); say('MNOffice is not answering', 'Try again in a moment.'); };
      document.head.appendChild(s);
    })
    .catch(function (e) { clearTimeout(slow); say('Not here', e.message); });
})();
