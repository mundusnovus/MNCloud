/* The approval page for a device sign-in: fills in the form's check value from the person's session. */
fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (r) {
  document.getElementById('csrf').value = r.csrf || '';
  if (r.user) document.getElementById('who').textContent = 'An app is asking to reach the files of ' + r.user.display + ' (@' + r.user.id + ').';
});
