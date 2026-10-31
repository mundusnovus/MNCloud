// Asteria Cloud: one Node server (no packages) for cloud.asteria.technology. The web app and its JSON API, WebDAV
// for the desktop app and the other Asteria Technology apps, device sign-in, share links and Asteria Office.
//   PUBLIC_URL, DATA_DIR, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, SESSION_SECRET,
//   S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_REGION (or BLOB_DIR for a local folder),
//   OFFICE_URL, OFFICE_JWT_SECRET, SOCIAL_URL, SERVICE_SECRET, QUOTA_GB (3), CAPACITY_GB (256)
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, CloudError, GB } from './store.mjs';
import { s3Store, folderStore } from './blobs.mjs';
import { createAuth, createSocialLink } from './auth.mjs';
import { createDav } from './dav.mjs';
import { createOffice, officeType } from './office.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url)), PUBLIC = join(HERE, '..', 'public'), TEMPLATES = join(HERE, '..', 'templates');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const APPS = /^https:\/\/(sprite|box|office)\.asteria\.technology$/;
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
const VERSION = { major: 33, minor: 0, micro: 0, string: '33.0.0', edition: '', extendedSupport: false }; // what desktop clients look for

export function makeCloud(env = process.env, deps = {}) {
  const publicUrl = (env.PUBLIC_URL || 'http://localhost:8090').replace(/\/+$/, '');
  const dataDir = env.DATA_DIR || join(HERE, '..', '.data');
  const blobs = deps.blobs || (env.S3_BUCKET ? s3Store({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, key: env.S3_KEY, secret: env.S3_SECRET, region: env.S3_REGION || 'auto' }) : folderStore(env.BLOB_DIR || join(dataDir, 'blobs')));
  const store = createStore({ dataDir, blobs, quota: (+env.QUOTA_GB || 3) * GB, capacity: (+env.CAPACITY_GB || 256) * GB });
  const auth = createAuth({ store, issuer: env.OIDC_ISSUER || 'https://social.asteria.technology', clientId: env.OIDC_CLIENT_ID || 'asteria-cloud', clientSecret: env.OIDC_CLIENT_SECRET, publicUrl, secret: env.SESSION_SECRET || 'dev-only-secret', fetchImpl: deps.fetch });
  const dav = createDav({ store, dataDir, publicUrl });
  const office = createOffice({ store, officeUrl: (env.OFFICE_URL || '').replace(/\/+$/, ''), secret: env.OFFICE_JWT_SECRET, publicUrl });
  const social = deps.social === undefined ? createSocialLink({ url: env.SOCIAL_URL || 'https://social.asteria.technology', secret: env.SERVICE_SECRET, fetchImpl: deps.fetch }) : deps.social;
  const secure = publicUrl.startsWith('https:');
  const cookie = (name, value, age) => name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '') + '; Max-Age=' + age;
  setInterval(() => store.emptyOld().catch(() => {}), 6 * 3600 * 1000).unref();

  function json(res, status, body, headers = {}) { res.writeHead(status, { ...SECURITY, 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
  function page(res, file, status = 200) {
    res.writeHead(status, { ...SECURITY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' " + (office.officeUrl || '') + "; frame-src " + (office.officeUrl || "'none'") + "; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'" });
    createReadStream(join(PUBLIC, file)).pipe(res);
  }
  function asset(res, path) {
    const p = join(PUBLIC, path.replace(/\.\.+/g, ''));
    if (!p.startsWith(PUBLIC) || !existsSync(p) || statSync(p).isDirectory()) return false;
    res.writeHead(200, { ...SECURITY, 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': /\.(woff|ttf|png|svg|ico)$/.test(p) ? 'public, max-age=604800' : 'no-cache' });
    createReadStream(p).pipe(res); return true;
  }
  async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new CloudError(413, 'Too big.'); } try { return s ? JSON.parse(s) : {}; } catch { throw new CloudError(400, 'Unreadable request.'); } }

  // what the web app shows for a file or folder
  function view(n, me) {
    const s = me ? store.sharesOf(n) : [];
    return { id: n.id, name: n.name, dir: !!n.dir, size: n.size, mime: n.mime, mtime: n.mtime, etag: n.etag, owner: n.owner, office: !n.dir && !!officeType(n.name) && office.enabled,
      shared: s.length > 0, sharedWith: s.filter((x) => x.kind === 'user').map((x) => x.target), modifiedBy: n.modified_by };
  }
  function need(n, who, want) {
    const a = store.access(n, who);
    if (!a) throw new CloudError(404, 'That file is not here.');
    if (want === 'edit' && a === 'view') throw new CloudError(403, 'You can view this, but not change it.');
    if (want === 'owner' && a !== 'owner') throw new CloudError(403, 'Only its owner can do that.');
    return a;
  }
  const nodeOr404 = (id) => { const n = store.node(+id); if (!n) throw new CloudError(404, 'That file is not here.'); return n; };

  async function api(req, res, me, path, url) {
    const m = req.method, parts = path.slice(5).split('/'), id = +parts[1];
    if (m !== 'GET' && req.headers['x-cc-csrf'] !== me.csrf) throw new CloudError(403, 'Refresh the page and try again.');
    switch (m + ' ' + parts[0]) {
      case 'GET me': { const u = store.user(me.user); return json(res, 200, { user: { id: u.id, display: u.display }, usage: store.usage(u.id), csrf: me.csrf, office: office.enabled, social: !!social }); }
      case 'GET list': {
        const n = parts[1] ? nodeOr404(parts[1]) : store.root(me.user), a = need(n, me.user);
        if (!n.dir) throw new CloudError(400, 'That is a file.');
        const trail = store.crumbs(n).filter((c) => store.access(store.node(c.id), me.user));
        return json(res, 200, { folder: { ...view(n, me), access: a, home: n.parent === null }, trail, items: store.list(n).map((c) => view(c, me)) });
      }
      case 'POST folder': { const b = await body(req), p = nodeOr404(b.parent); need(p, me.user, 'edit'); return json(res, 201, { item: view(store.mkdir(p, b.name, me.user), me) }); }
      case 'PUT upload': {
        const p = nodeOr404(url.searchParams.get('parent')); need(p, me.user, 'edit');
        const got = await store.receive(req, p.owner, +req.headers['content-length'] || 0);
        const r = await store.write(p, url.searchParams.get('name'), got, { by: me.user, ifNoneMatch: url.searchParams.get('replace') === '1' ? undefined : '*' });
        return json(res, r.created ? 201 : 200, { item: view(r.node, me) });
      }
      case 'GET download': {
        const n = nodeOr404(id); need(n, me.user); if (n.dir) throw new CloudError(400, 'Folders download one file at a time.');
        const g = await store.blobs.get(n.blob, req.headers.range);
        res.writeHead(g.status, { ...SECURITY, 'content-type': n.mime || 'application/octet-stream', 'content-disposition': (url.searchParams.get('inline') ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(n.name), 'cache-control': 'private, no-store', ...(g.headers['content-length'] ? { 'content-length': g.headers['content-length'] } : {}), ...(g.headers['content-range'] ? { 'content-range': g.headers['content-range'] } : {}) });
        return g.stream.pipe(res);
      }
      case 'POST rename': { const b = await body(req), n = nodeOr404(b.id); need(n, me.user, 'edit'); if (n.owner !== me.user && store.sharesOf(n).some((s) => s.target === me.user)) throw new CloudError(403, 'Ask the owner to rename what they shared.'); return json(res, 200, { item: view(store.rename(n, b.name, me.user), me) }); }
      case 'POST move': case 'POST copy': {
        const b = await body(req), n = nodeOr404(b.id), dest = nodeOr404(b.parent);
        need(n, me.user, parts[0] === 'move' ? 'owner' : undefined); need(dest, me.user, 'edit');
        const r = parts[0] === 'move' ? await store.move(n, dest, b.name, { by: me.user }) : await store.copy(n, dest, b.name, { by: me.user });
        return json(res, 200, { item: view(r.node, me) });
      }
      case 'POST trash': { const b = await body(req), n = nodeOr404(b.id); need(n, me.user, 'owner'); await unshareAll(n); await store.trash(n, me.user); return json(res, 200, { ok: true }); }
      case 'GET trash': return json(res, 200, { items: store.trashed(me.user).map((n) => ({ ...view(n), trashedAt: n.trashed_at })) });
      case 'POST restore': { const b = await body(req), n = nodeOr404(b.id); need(n, me.user, 'owner'); return json(res, 200, { item: view(store.restore(n), me) }); }
      case 'POST purge': { const b = await body(req); for (const n of b.id === 'all' ? store.trashed(me.user) : [nodeOr404(b.id)]) { need(n, me.user, 'owner'); if (!n.trashed) throw new CloudError(400, 'Move it to the trash first.'); await store.purge(n); } return json(res, 200, { usage: store.usage(me.user) }); }
      case 'GET search': return json(res, 200, { items: store.search(me.user, url.searchParams.get('q')).map((n) => view(n, me)) });
      case 'GET recent': return json(res, 200, { items: store.recent(me.user).map((n) => view(n, me)) });
      case 'GET versions': { const n = nodeOr404(id); need(n, me.user); return json(res, 200, { item: view(n, me), versions: store.versions(n) }); }
      case 'POST versions': { const b = await body(req), n = nodeOr404(id); need(n, me.user, 'edit'); return json(res, 200, { item: view(store.restoreVersion(n, +b.version, me.user), me) }); }
      case 'GET shared': return json(res, 200, { items: store.sharedWith(me.user).map((s) => ({ ...view(store.node(s.node)), perm: s.perm, ownerDisplay: (store.user(s.owner) || {}).display || s.owner })) });
      case 'GET contacts': {
        let contacts = [];
        if (social) { try { contacts = await social.contacts(me.user); } catch { contacts = []; } }
        return json(res, 200, { contacts, social: !!social });
      }
      case 'GET shares': {
        const n = nodeOr404(id); need(n, me.user, 'owner');
        return json(res, 200, { item: view(n, me), shares: store.sharesOf(n).map((s) => ({ id: s.id, kind: s.kind, perm: s.perm, target: s.kind === 'user' ? s.target : undefined, display: s.kind === 'user' ? ((store.user(s.target) || {}).display || s.target) : undefined,
          url: s.kind === 'link' ? publicUrl + '/s/' + s.target : undefined, record: s.record })) });
      }
      case 'POST share': {
        const b = await body(req), n = nodeOr404(b.id); need(n, me.user, 'owner');
        if (b.kind === 'link') { const l = store.shareLink(n, b.perm); return json(res, 201, { share: { id: l.id, kind: 'link', perm: l.perm, url: publicUrl + '/s/' + l.target } }); }
        const name = String(b.with || '').trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9-]{2,40}$/.test(name) || name === me.user) throw new CloudError(400, 'Choose someone to share with.');
        // The person must be a Asteria account. Social knows everyone, even before they first open Cloud.
        let person = null;
        if (social) { try { person = await social.person(name); } catch (e) { if (e.status === 404) throw new CloudError(404, '@' + name + ' is not a Asteria account.'); throw new CloudError(502, 'Social is not answering. Try again in a moment.'); } }
        else if (!store.user(name)) throw new CloudError(404, '@' + name + ' has not opened Asteria Cloud yet.');
        store.ensureUser(name, person && person.display, person && person.did);
        const s = store.shareWith(n, name, b.perm);
        // The share is also a record in the sharer's own repository on the PDS, and Social tells the other person.
        if (social && !s.record) {
          try { const r = await social.recordShare({ from: me.user, to: name, perm: s.perm, file: { id: n.id, name: n.name, dir: !!n.dir }, url: publicUrl + '/shared/' + n.id }); if (r.uri) store.setShareRecord(s.id, r.uri); s.record = r.uri; }
          catch { /* the share works; the record and notice are a courtesy and can be retried */ }
        }
        return json(res, 201, { share: { id: s.id, kind: 'user', target: name, perm: s.perm, record: s.record } });
      }
      case 'DELETE share': {
        const s = store.share(id); if (!s) throw new CloudError(404, 'That share is gone.');
        if (s.owner !== me.user && s.target !== me.user) throw new CloudError(403, 'That is not your share.');
        await dropShare(s);
        return json(res, 200, { ok: true });
      }
      case 'POST new': {
        const b = await body(req), p = nodeOr404(b.parent); need(p, me.user, 'edit');
        const kind = { document: 'docx', spreadsheet: 'xlsx', presentation: 'pptx' }[b.type]; if (!kind) throw new CloudError(400, 'Choose a document, spreadsheet or presentation.');
        const name = String(b.name || '').trim() || { docx: 'Document', xlsx: 'Spreadsheet', pptx: 'Presentation' }[kind];
        const got = await store.receive(createReadStream(join(TEMPLATES, 'blank.' + kind)), p.owner, 0);
        const r = await store.write(p, name.endsWith('.' + kind) ? name : name + '.' + kind, got, { by: me.user, ifNoneMatch: '*' });
        return json(res, 201, { item: view(r.node, me) });
      }
      case 'GET devices': return json(res, 200, { devices: auth.devices(me.user) });
      case 'DELETE devices': auth.forgetDevice(me.user, id); return json(res, 200, { devices: auth.devices(me.user) });
      case 'GET editor': { const n = nodeOr404(id), a = need(n, me.user); const u = store.user(me.user); return json(res, 200, { config: office.editorConfig(n, u, a, url.searchParams.get('lang')), api: office.officeUrl + '/web-apps/apps/api/documents/api.js', item: view(n, me) }); }
      default: throw new CloudError(404, 'Not found.');
    }
  }
  async function dropShare(s) {
    store.unshare(s.id);
    if (social && s.record) { try { await social.removeShare({ from: s.owner, to: s.target, uri: s.record }); } catch { /* the record can be removed later */ } }
  }
  async function unshareAll(n) { for (const s of store.sharesOf(n)) await dropShare(s); }

  // the share link someone opens without an account
  async function publicLink(req, res, token, rest) {
    const s = store.linkShare(token), top = s && store.node(s.node);
    if (!top || top.trashed) return page(res, 'gone.html', 404);
    if (!rest) return page(res, 'link.html');
    if (rest === 'info') {
      const at = req.url.includes('?id=') ? store.node(+new URL(req.url, publicUrl).searchParams.get('id')) : top;
      if (!at || !store.linkAccess(at, token)) throw new CloudError(404, 'Not found.');
      return json(res, 200, { item: view(at), owner: (store.user(top.owner) || {}).display || top.owner, top: top.id, items: at.dir ? store.list(at).map((c) => view(c)) : [], perm: s.perm });
    }
    const m = /^download\/(\d+)$/.exec(rest);
    if (m) {
      const n = store.node(+m[1]); if (!n || n.dir || !store.linkAccess(n, token)) throw new CloudError(404, 'Not found.');
      const g = await store.blobs.get(n.blob);
      res.writeHead(200, { ...SECURITY, 'content-type': n.mime || 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(n.name), 'content-length': String(n.size) });
      return g.stream.pipe(res);
    }
    throw new CloudError(404, 'Not found.');
  }

  const movedFrom = (env.MOVED_FROM ?? 'cloud.christiansystems.org,cloud.mundusnovus.org').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, publicUrl), path = url.pathname, origin = req.headers.origin;
    try {
      // the other Asteria Technology apps reach Cloud with a device key; browsers check first
      if (origin && APPS.test(origin) && /^\/(remote\.php|index\.php\/login\/v2|login\/v2|ocs|status\.php)/.test(path)) {
        res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin');
        res.setHeader('access-control-allow-methods', 'GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, POST, OPTIONS');
        res.setHeader('access-control-allow-headers', 'Authorization, Content-Type, Depth, Destination, Overwrite, If-Match, If-None-Match, OCS-APIRequest, X-Requested-With');
        res.setHeader('access-control-expose-headers', 'ETag, OC-ETag, OC-FileId');
        if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) { res.writeHead(204); return res.end(); }
      }
      if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
      // the old address (Christian Systems became Asteria Technology) moves to the new one
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
      if (movedFrom.includes(host)) { res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, { location: publicUrl + req.url }); return res.end(); }
      if (path === '/status.php') return json(res, 200, { installed: true, maintenance: false, needsDbUpgrade: false, version: '33.0.0.0', versionstring: '33.0.0', edition: '', productname: 'Asteria Cloud', extendedSupport: false });
      if (path === '/index.php/login/v2' || path === '/login/v2') { if (req.method !== 'POST') throw new CloudError(405, 'Use POST.'); return json(res, 200, auth.flowStart(req.headers['user-agent'])); }
      if (path === '/login/v2/poll' || path === '/index.php/login/v2/poll') {
        const b = new URLSearchParams(await (async () => { let s = ''; for await (const c of req) s += c; return s; })());
        const r = auth.flowPoll(b.get('token'));
        return r ? json(res, 200, r) : json(res, 404, []);
      }
      if (path.startsWith('/api/office/file/')) return await office.file(req, res, +path.split('/').pop(), url.searchParams);
      if (path.startsWith('/api/office/callback/')) return await office.callback(req, res, +path.split('/').pop(), url.searchParams);
      if (path.startsWith('/s/')) { const [, , token, ...rest] = path.split('/'); return await publicLink(req, res, token, rest.join('/')); }
      if (path === '/login') { const s = await auth.startLogin(url.searchParams.get('back')); res.writeHead(302, { location: s.url, 'set-cookie': cookie('cc_login', s.cookie, 600), 'cache-control': 'no-store' }); return res.end(); }
      if (path === '/auth/callback') {
        const st = (/(?:^|;\s*)cc_login=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
        const r = await auth.finishLogin(url.searchParams, st);
        res.writeHead(302, { location: r.back, 'set-cookie': [cookie('cc_session', r.session.id, 30 * 86400), cookie('cc_login', '', 0)], 'cache-control': 'no-store' }); return res.end();
      }
      if (path === '/logout' && req.method === 'POST') { const s = auth.session(req); if (s) auth.endSession(s.sid); res.writeHead(302, { location: '/', 'set-cookie': cookie('cc_session', '', 0) }); return res.end(); }

      // WebDAV and the client APIs take a device key; a signed-in browser may use them too
      if (path.startsWith('/remote.php/') || path.startsWith('/ocs/')) {
        const who = auth.basic(req) || (req.method === 'GET' || req.method === 'PROPFIND' ? auth.session(req) : null);
        if (!who) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Asteria Cloud", charset="UTF-8"', 'content-type': 'text/plain' }); return res.end('Sign in with a device key.'); }
        if (path.startsWith('/ocs/')) return ocs(res, who.user, path, url);
        return await dav.serve(req, res, who.user, path);
      }
      if (path.startsWith('/api/')) {
        const me = auth.session(req);
        if (!me) throw new CloudError(401, 'Sign in first.');
        return await api(req, res, me, path, url);
      }
      if (path.startsWith('/login/v2/flow/')) {
        const token = path.split('/').pop(), f = auth.flow(token), me = auth.session(req);
        if (!f) return page(res, 'gone.html', 410);
        if (!me) { res.writeHead(302, { location: '/login?back=' + encodeURIComponent(path) }); return res.end(); }
        if (req.method === 'POST') {
          const b = new URLSearchParams(await (async () => { let s = ''; for await (const c of req) s += c; return s; })());
          if (b.get('csrf') !== me.csrf) throw new CloudError(403, 'Refresh the page and try again.');
          if (b.get('answer') === 'allow') auth.flowGrant(token, me.user);
          return page(res, b.get('answer') === 'allow' ? 'connected.html' : 'gone.html');
        }
        return page(res, 'allow.html');
      }
      if (req.method === 'GET' && asset(res, path)) return;
      if (req.method === 'GET') {
        const me = auth.session(req);
        if (!me) { res.writeHead(302, { location: '/login?back=' + encodeURIComponent(path + url.search) }); return res.end(); }
        return page(res, /^\/edit\/\d+$/.test(path) ? 'edit.html' : 'index.html');
      }
      throw new CloudError(404, 'Not found.');
    } catch (e) {
      const status = e instanceof CloudError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? 'Something went wrong on our side.' : e.message });
    }
  });

  // what the desktop app asks before syncing
  function ocs(res, user, path, url) {
    const wrap = (data) => json(res, 200, { ocs: { meta: { status: 'ok', statuscode: path.startsWith('/ocs/v2') ? 200 : 100, message: 'OK' }, data } });
    if (/\/cloud\/capabilities$/.test(path)) return wrap({ version: VERSION, capabilities: { core: { pollinterval: 60, 'webdav-root': 'remote.php/webdav' }, dav: { chunking: '1.0', bulkupload: '' },
      files: { bigfilechunking: true, undelete: true, versioning: true }, theming: { name: 'Asteria Cloud', url: publicUrl, slogan: 'Your files, together.', color: '#116674', 'color-text': '#ffffff' } } });
    if (/\/cloud\/user$/.test(path)) { const u = store.user(user), q = store.usage(user); return wrap({ id: u.id, 'display-name': u.display, displayname: u.display, email: null, quota: { free: Math.max(0, q.quota - q.used), used: q.used, total: q.quota, relative: Math.round(1000 * q.used / q.quota) / 10, quota: q.quota } }); }
    if (/\/apps\/notifications\//.test(path)) return wrap([]);
    return json(res, 404, { ocs: { meta: { status: 'failure', statuscode: 998, message: 'Not here.' }, data: [] } });
  }

  return { server, store, auth, office };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (/^https:/.test(process.env.PUBLIC_URL || '') && (process.env.SESSION_SECRET || '').length < 32) {
    console.error('SESSION_SECRET must be set (32 characters or more) when Cloud is public.'); process.exit(1);
  }
  const port = Number(process.env.PORT) || 8090, { server } = makeCloud();
  server.listen(port, () => console.log('Asteria Cloud on :' + port));
}
