// Christian Cloud end to end: the real server with a folder for file contents, a stand-in Christian Systems sign-in
// (it signs real RS256 tokens) and a stand-in document server, driven over HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCloud } from '../src/server.mjs';
import { verifyJwt, signJwt } from '../src/office.mjs';

const ISSUER = 'https://accounts.test', OFFICE_SECRET = 'o'.repeat(40);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const codes = new Map();
function idToken(claims) { const body = b64u({ alg: 'RS256', kid: 'k1' }) + '.' + b64u(claims); return body + '.' + sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url'); }
async function fakeFetch(url, o = {}) {
  const u = new URL(url);
  if (u.origin !== ISSUER) return fetch(url, o);
  const res = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/.well-known/openid-configuration') return res({ issuer: ISSUER, authorization_endpoint: ISSUER + '/oauth/authorize', token_endpoint: ISSUER + '/oauth/token', jwks_uri: ISSUER + '/oauth/jwks' });
  if (u.pathname === '/oauth/jwks') return res({ keys: [jwk] });
  if (u.pathname === '/oauth/token') { const p = new URLSearchParams(o.body), c = codes.get(p.get('code')); return res({ access_token: 'a', id_token: idToken({ iss: ISSUER, aud: 'christian-cloud', sub: c.name, name: c.display, nonce: c.nonce, exp: Math.floor(Date.now() / 1000) + 300 }) }); }
  return new Response('{}', { status: 404 });
}

async function start(env = {}, social) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  // a stand-in document server: serves the "edited" file for callbacks
  const officeSrv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('edited by office'); });
  await new Promise((r) => officeSrv.listen(0, '127.0.0.1', r));
  const officeUrl = 'http://127.0.0.1:' + officeSrv.address().port;
  const cloud = makeCloud({ PUBLIC_URL: 'http://cloud.test', DATA_DIR: dir, BLOB_DIR: join(dir, 'blobs'), OIDC_ISSUER: ISSUER, OIDC_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(32),
    OFFICE_URL: officeUrl, OFFICE_JWT_SECRET: OFFICE_SECRET, ...env }, { fetch: fakeFetch, social: social === undefined ? null : social });
  await new Promise((r) => cloud.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + cloud.server.address().port;
  const raw = (method, path, { headers = {}, body } = {}) => fetch(base + path, { method, headers, body, redirect: 'manual', duplex: body ? 'half' : undefined });
  async function signIn(name, display) {
    const r = await raw('GET', '/login?back=/files/');
    const loc = new URL(r.headers.get('location')), cookie = r.headers.get('set-cookie').split(';')[0];
    const code = 'c-' + name; codes.set(code, { name, display, nonce: loc.searchParams.get('nonce') });
    const cb = await raw('GET', '/auth/callback?code=' + code + '&state=' + loc.searchParams.get('state'), { headers: { cookie } });
    assert.equal(cb.status, 302); assert.equal(cb.headers.get('location'), '/files/');
    const session = cb.headers.getSetCookie().find((c) => c.startsWith('cc_session=')).split(';')[0];
    const me = await (await raw('GET', '/api/me', { headers: { cookie: session } })).json();
    const call = async (method, path, body, extra = {}) => {
      const r2 = await raw(method, '/api/' + path, { headers: { cookie: session, 'x-cc-csrf': me.csrf, ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...extra }, body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined });
      const t = await r2.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { text: t }; }
      return { status: r2.status, ...j };
    };
    return { session, csrf: me.csrf, me, call };
  }
  return { cloud, base, raw, signIn, officeUrl, stop: () => { cloud.server.close(); officeSrv.close(); } };
}

test('signing in, folders, uploads, versions, trash and search', async () => {
  const t = await start();
  try {
    const ann = await t.signIn('ann', 'Ann');
    assert.equal(ann.me.user.display, 'Ann'); assert.equal(ann.me.usage.quota, 3e9);
    const root = await ann.call('GET', 'list');
    assert.equal(root.folder.home, true); assert.equal(root.items.length, 0);
    const docs = await ann.call('POST', 'folder', { parent: root.folder.id, name: 'Documents' });
    assert.equal(docs.status, 201);
    assert.equal((await ann.call('POST', 'folder', { parent: root.folder.id, name: 'Documents' })).status, 405);
    assert.equal((await ann.call('POST', 'folder', { parent: root.folder.id, name: '../x' })).status, 400);
    const up = await ann.call('PUT', 'upload?parent=' + docs.item.id + '&name=' + encodeURIComponent('Hymn list.txt'), Buffer.from('Amazing Grace'));
    assert.equal(up.status, 201); assert.equal(up.item.size, 13);
    const again = await ann.call('PUT', 'upload?parent=' + docs.item.id + '&name=' + encodeURIComponent('Hymn list.txt') + '&replace=1', Buffer.from('Amazing Grace\nBe Thou My Vision'));
    assert.equal(again.status, 200);
    const dl = await t.raw('GET', '/api/download/' + up.item.id, { headers: { cookie: ann.session } });
    assert.equal(await dl.text(), 'Amazing Grace\nBe Thou My Vision');
    assert.match(dl.headers.get('content-disposition'), /Hymn%20list\.txt/);
    const v = await ann.call('GET', 'versions/' + up.item.id); assert.equal(v.versions.length, 1); assert.equal(v.versions[0].size, 13);
    await ann.call('POST', 'versions/' + up.item.id, { version: v.versions[0].id });
    assert.equal(await (await t.raw('GET', '/api/download/' + up.item.id, { headers: { cookie: ann.session } })).text(), 'Amazing Grace');
    assert.equal((await ann.call('POST', 'rename', { id: up.item.id, name: 'Hymns.txt' })).item.name, 'Hymns.txt');
    const music = await ann.call('POST', 'folder', { parent: root.folder.id, name: 'Music' });
    await ann.call('POST', 'copy', { id: up.item.id, parent: music.item.id });
    await ann.call('POST', 'move', { id: music.item.id, parent: docs.item.id });
    assert.equal((await ann.call('POST', 'move', { id: docs.item.id, parent: music.item.id })).status, 409); // not into itself
    assert.equal((await ann.call('GET', 'search?q=hymn')).items.length, 2);
    assert.ok((await ann.call('GET', 'recent')).items.length >= 2);
    assert.equal((await ann.call('POST', 'trash', { id: up.item.id })).ok, true);
    assert.equal((await ann.call('GET', 'trash')).items.length, 1);
    await ann.call('POST', 'restore', { id: up.item.id });
    assert.equal((await ann.call('GET', 'list/' + docs.item.id)).items.some((i) => i.name === 'Hymns.txt'), true);
    await ann.call('POST', 'trash', { id: up.item.id });
    const before = (await ann.call('GET', 'me')).usage.used;
    await ann.call('POST', 'purge', { id: 'all' });
    assert.ok((await ann.call('GET', 'me')).usage.used < before);
    // the CSRF check and other people's files
    assert.equal((await t.raw('POST', '/api/folder', { headers: { cookie: ann.session, 'content-type': 'application/json' }, body: JSON.stringify({ parent: root.folder.id, name: 'x' }) })).status, 403);
    const ben = await t.signIn('ben', 'Ben');
    assert.equal((await ben.call('GET', 'list/' + docs.item.id)).status, 404);
    assert.equal((await t.raw('GET', '/api/download/' + up.item.id, { headers: { cookie: ben.session } })).status, 404);
  } finally { t.stop(); }
});

test('3 GB each and the service cap', async () => {
  const t = await start({ QUOTA_GB: String(100 / 1e9), CAPACITY_GB: String(150 / 1e9) }); // 100 bytes each, 150 bytes for everyone
  try {
    const a = await t.signIn('amy', 'Amy'), b = await t.signIn('bo', 'Bo');
    const ra = (await a.call('GET', 'list')).folder.id, rb = (await b.call('GET', 'list')).folder.id;
    assert.equal((await a.call('PUT', 'upload?parent=' + ra + '&name=a.bin', Buffer.alloc(80))).status, 201);
    assert.equal((await a.call('PUT', 'upload?parent=' + ra + '&name=b.bin', Buffer.alloc(30))).status, 507); // over Amy's 100
    assert.equal((await b.call('PUT', 'upload?parent=' + rb + '&name=c.bin', Buffer.alloc(75))).status, 507); // fits Bo (75 of 100), not the service (80 + 75 > 150)
    assert.equal((await b.call('PUT', 'upload?parent=' + rb + '&name=c.bin', Buffer.alloc(75))).error, 'Christian Cloud is full for now. Your file was not saved.');
    assert.equal((await b.call('PUT', 'upload?parent=' + rb + '&name=d.bin', Buffer.alloc(50))).status, 201);
  } finally { t.stop(); }
});

test('device sign-in (Login Flow v2), WebDAV and chunked uploads', async () => {
  const t = await start();
  try {
    const ann = await t.signIn('ann', 'Ann');
    const flow = await (await t.raw('POST', '/index.php/login/v2', { headers: { 'user-agent': 'ChristianSprite' } })).json();
    const path = new URL(flow.login).pathname;
    assert.equal((await t.raw('POST', '/login/v2/poll', { body: 'token=' + flow.poll.token, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 404);
    assert.equal((await t.raw('GET', path)).status, 302); // not signed in: off to sign in first
    assert.equal((await t.raw('GET', path, { headers: { cookie: ann.session } })).status, 200);
    assert.equal((await t.raw('POST', path, { headers: { cookie: ann.session, 'content-type': 'application/x-www-form-urlencoded' }, body: 'answer=allow&csrf=wrong' })).status, 403);
    await t.raw('POST', path, { headers: { cookie: ann.session, 'content-type': 'application/x-www-form-urlencoded' }, body: 'answer=allow&csrf=' + ann.csrf });
    const got = await (await t.raw('POST', '/login/v2/poll', { body: 'token=' + flow.poll.token, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).json();
    assert.equal(got.loginName, 'ann'); assert.ok(got.appPassword.length > 20);
    assert.equal((await t.raw('POST', '/login/v2/poll', { body: 'token=' + flow.poll.token, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 404); // only once
    const auth = { authorization: 'Basic ' + Buffer.from('ann:' + got.appPassword).toString('base64') }, dav = '/remote.php/dav/files/ann';
    assert.equal((await t.raw('PROPFIND', dav + '/')).status, 401);
    assert.equal((await t.raw('MKCOL', dav + '/ChristianSprite', { headers: auth })).status, 201);
    const put = await t.raw('PUT', dav + '/ChristianSprite/lantern.asprite.json', { headers: { ...auth, 'if-none-match': '*' }, body: '{"format":"christian-sprite"}' });
    assert.equal(put.status, 201); const etag = put.headers.get('etag');
    assert.equal((await t.raw('PUT', dav + '/ChristianSprite/lantern.asprite.json', { headers: { ...auth, 'if-match': '"stale"' }, body: 'x' })).status, 412);
    assert.equal((await t.raw('PUT', dav + '/ChristianSprite/lantern.asprite.json', { headers: { ...auth, 'if-match': etag }, body: '{"v":2}' })).status, 204);
    const pf = await (await t.raw('PROPFIND', dav + '/ChristianSprite', { headers: { ...auth, depth: '1' } })).text();
    assert.match(pf, /lantern\.asprite\.json/); assert.match(pf, /<oc:fileid>\d+<\/oc:fileid>/); assert.match(pf, /<oc:permissions>RGDNVW<\/oc:permissions>/);
    assert.equal(await (await t.raw('GET', dav + '/ChristianSprite/lantern.asprite.json', { headers: auth })).text(), '{"v":2}');
    assert.equal((await (await t.raw('GET', dav + '/ChristianSprite/lantern.asprite.json', { headers: { ...auth, range: 'bytes=0-1' } }))).status, 206);
    assert.equal((await t.raw('MOVE', dav + '/ChristianSprite/lantern.asprite.json', { headers: { ...auth, destination: 'http://cloud.test' + dav + '/lantern.asprite.json' } })).status, 201);
    assert.equal((await t.raw('COPY', dav + '/lantern.asprite.json', { headers: { ...auth, destination: 'http://cloud.test' + dav + '/ChristianSprite/copy.json' } })).status, 201);
    assert.equal((await t.raw('DELETE', dav + '/lantern.asprite.json', { headers: auth })).status, 204);
    assert.equal((await t.raw('PROPFIND', '/remote.php/dav/files/ben/', { headers: auth })).status, 403);
    // chunked upload, the way the desktop app sends big files
    const up = '/remote.php/dav/uploads/ann/web-file-1';
    assert.equal((await t.raw('MKCOL', up, { headers: auth })).status, 201);
    await t.raw('PUT', up + '/00002', { headers: auth, body: 'world' });
    await t.raw('PUT', up + '/00001', { headers: auth, body: 'hello ' });
    assert.equal((await t.raw('MOVE', up + '/.file', { headers: { ...auth, destination: 'http://cloud.test' + dav + '/big.txt' } })).status, 201);
    assert.equal(await (await t.raw('GET', dav + '/big.txt', { headers: auth })).text(), 'hello world');
    // what the desktop app checks first
    assert.equal((await (await t.raw('GET', '/status.php')).json()).productname, 'Christian Cloud');
    assert.equal((await (await t.raw('GET', '/ocs/v2.php/cloud/user?format=json', { headers: auth })).json()).ocs.data.id, 'ann');
    assert.equal((await ann.call('GET', 'devices')).devices.length, 1);
    // the other Christian Systems apps reach Cloud across sites; other sites do not
    const pre = await t.raw('OPTIONS', dav + '/', { headers: { origin: 'https://sprite.christiansystems.org', 'access-control-request-method': 'PROPFIND' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://sprite.christiansystems.org');
    assert.equal((await t.raw('POST', '/login/v2/poll', { headers: { origin: 'https://office.christiansystems.org' }, body: 'token=x' })).headers.get('access-control-allow-origin'), 'https://office.christiansystems.org');
    assert.equal((await t.raw('POST', '/login/v2/poll', { headers: { origin: 'https://elsewhere.example' }, body: 'token=x' })).headers.get('access-control-allow-origin'), null);
  } finally { t.stop(); }
});

test('sharing with Social contacts, recorded on the PDS, and share links', async () => {
  const calls = [];
  const social = {
    contacts: async (name) => (name === 'ann' ? [{ name: 'ben', display: 'Ben', mutual: true, youFollow: true, followsYou: true }] : []),
    person: async (name) => { if (name === 'nobody') { const e = new Error('no'); e.status = 404; throw e; } return { name, display: name === 'ben' ? 'Ben' : name, did: 'did:plc:' + name }; },
    recordShare: async (b) => { calls.push(['record', b]); return { uri: 'at://did:plc:' + b.from + '/org.christiansystems.cloud.share/3k' + calls.length }; },
    removeShare: async (b) => { calls.push(['remove', b]); return { ok: true }; },
  };
  const t = await start({}, social);
  try {
    const ann = await t.signIn('ann', 'Ann');
    const root = (await ann.call('GET', 'list')).folder.id;
    const choir = await ann.call('POST', 'folder', { parent: root, name: 'Choir' });
    const doc = await ann.call('PUT', 'upload?parent=' + choir.item.id + '&name=Order.txt', Buffer.from('Opening hymn'));
    assert.equal((await ann.call('GET', 'contacts')).contacts[0].name, 'ben');
    assert.equal((await ann.call('POST', 'share', { id: choir.item.id, with: 'nobody', perm: 'edit' })).status, 404);
    // Ben has never opened Cloud; sharing still works, because Social knows him
    const s = await ann.call('POST', 'share', { id: choir.item.id, with: '@ben', perm: 'edit' });
    assert.equal(s.status, 201); assert.match(s.share.record, /^at:\/\/did:plc:ann\/org\.christiansystems\.cloud\.share\//);
    assert.equal(calls[0][1].to, 'ben'); assert.equal(calls[0][1].file.name, 'Choir'); assert.match(calls[0][1].url, /\/shared\/\d+$/);
    const ben = await t.signIn('ben', 'Ben');
    const shared = await ben.call('GET', 'shared');
    assert.equal(shared.items[0].name, 'Choir'); assert.equal(shared.items[0].perm, 'edit'); assert.equal(shared.items[0].ownerDisplay, 'Ann');
    assert.equal((await ben.call('GET', 'list/' + choir.item.id)).items[0].name, 'Order.txt');
    assert.equal((await ben.call('PUT', 'upload?parent=' + choir.item.id + '&name=Readings.txt', Buffer.from('Psalm 23'))).status, 201); // edit: counts toward Ann
    assert.equal((await ben.call('POST', 'trash', { id: doc.item.id })).status, 403); // only the owner deletes
    // view only
    await ann.call('POST', 'share', { id: choir.item.id, with: 'ben', perm: 'view' });
    assert.equal((await ben.call('PUT', 'upload?parent=' + choir.item.id + '&name=More.txt', Buffer.from('x'))).status, 403);
    // links
    const link = await ann.call('POST', 'share', { id: doc.item.id, kind: 'link', perm: 'view' });
    const token = link.share.url.split('/s/')[1];
    assert.equal((await t.raw('GET', '/s/' + token)).status, 200);
    const info = await (await t.raw('GET', '/s/' + token + '/info')).json();
    assert.equal(info.item.name, 'Order.txt'); assert.equal(info.owner, 'Ann');
    assert.equal(await (await t.raw('GET', '/s/' + token + '/download/' + doc.item.id)).text(), 'Opening hymn');
    assert.equal((await t.raw('GET', '/s/' + token + '/download/' + choir.item.id)).status, 404);
    // stop sharing: the PDS record goes too
    const list = await ann.call('GET', 'shares/' + choir.item.id);
    await ann.call('DELETE', 'share/' + list.shares.find((x) => x.kind === 'user').id);
    assert.equal(calls.at(-1)[0], 'remove');
    assert.equal((await ben.call('GET', 'shared')).items.length, 0);
    assert.equal((await ben.call('GET', 'list/' + choir.item.id)).status, 404);
  } finally { t.stop(); }
});

test('Christian Office: open, co-edit and save back', async () => {
  const t = await start({}, { contacts: async () => [], person: async (n) => ({ name: n, display: n }), recordShare: async () => ({}), removeShare: async () => ({}) });
  try {
    const ann = await t.signIn('ann', 'Ann'), ben = await t.signIn('ben', 'Ben');
    const root = (await ann.call('GET', 'list')).folder.id;
    const made = await ann.call('POST', 'new', { parent: root, type: 'document', name: 'Newsletter' });
    assert.equal(made.item.name, 'Newsletter.docx'); assert.equal(made.item.office, true);
    await ann.call('POST', 'share', { id: made.item.id, with: 'ben', perm: 'edit' });
    const a = await ann.call('GET', 'editor/' + made.item.id), b = await ben.call('GET', 'editor/' + made.item.id);
    assert.equal(a.config.document.key, b.config.document.key); // one key: they edit together, live
    assert.equal(a.config.editorConfig.mode, 'edit'); assert.equal(b.config.editorConfig.mode, 'edit');
    assert.equal(b.config.editorConfig.user.id, 'ben'); assert.equal(a.config.editorConfig.coEditing.mode, 'fast');
    const signed = verifyJwt(a.config.token, OFFICE_SECRET); assert.equal(signed.document.key, a.config.document.key);
    // the document server fetches the file with the signed link, and nobody else can
    const fileUrl = new URL(a.config.document.url);
    assert.equal((await t.raw('GET', fileUrl.pathname + fileUrl.search)).status, 200);
    assert.equal((await t.raw('GET', fileUrl.pathname + '?t=forged')).status, 403);
    // Ben saves: the document server calls back with the result
    const cb = new URL(a.config.editorConfig.callbackUrl);
    const body = { key: a.config.document.key, status: 2, url: t.officeUrl + '/cache/files/out.docx', users: ['ben'] };
    assert.equal((await (await t.raw('POST', cb.pathname + cb.search, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: signJwt(body, 'wrong'.repeat(8)) }) })).json()).error, 1);
    assert.equal((await (await t.raw('POST', cb.pathname + cb.search, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: signJwt(body, OFFICE_SECRET) }) })).json()).error, 0);
    assert.equal(await (await t.raw('GET', '/api/download/' + made.item.id, { headers: { cookie: ann.session } })).text(), 'edited by office');
    const after = await ann.call('GET', 'versions/' + made.item.id);
    assert.equal(after.versions.length, 1); assert.equal(after.item.modifiedBy, 'ben');
    assert.notEqual((await ann.call('GET', 'editor/' + made.item.id)).config.document.key, a.config.document.key); // a new version, a new session
    // only our document server is trusted for results
    const evil = { key: 'k', status: 2, url: 'http://evil.example/x', users: ['ben'] };
    assert.equal((await (await t.raw('POST', cb.pathname + cb.search, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...evil, token: signJwt(evil, OFFICE_SECRET) }) })).json()).error, 1);
    // view-only people open read-only
    const c = await t.signIn('cy', 'Cy'); await ann.call('POST', 'share', { id: made.item.id, with: 'cy', perm: 'view' });
    assert.equal((await c.call('GET', 'editor/' + made.item.id)).config.editorConfig.mode, 'view');
  } finally { t.stop(); }
});
