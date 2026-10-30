// WebDAV for the desktop sync app and the other Mundus Novus apps, at /remote.php/dav/files/<name>/<path> with
// the same properties and chunked uploads Nextcloud clients expect. Requests carry a device key (Basic auth).
import { mkdirSync, readdirSync, rmSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CloudError } from './store.mjs';

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export function createDav({ store, dataDir, publicUrl }) {
  const uploadsDir = join(dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const filesBase = (u) => '/remote.php/dav/files/' + encodeURIComponent(u);

  function props(n, href, user) {
    const u = store.usage(n.owner), q = Math.max(0, Math.min(u.quota - u.used, u.serviceCapacity - u.serviceUsed));
    const perms = n.parent === null ? 'RGDNVCK' : n.dir ? 'RGDNVCK' : 'RGDNVW';
    const fileid = String(n.id).padStart(8, '0') + 'mncloud';
    return '<d:response><d:href>' + x(href) + '</d:href><d:propstat><d:prop>' +
      '<d:displayname>' + x(n.parent === null ? '' : n.name) + '</d:displayname>' +
      '<d:getlastmodified>' + new Date(n.mtime).toUTCString() + '</d:getlastmodified>' +
      '<d:getetag>"' + n.etag + '"</d:getetag>' +
      (n.dir ? '<d:resourcetype><d:collection/></d:resourcetype><d:quota-used-bytes>' + u.used + '</d:quota-used-bytes><d:quota-available-bytes>' + q + '</d:quota-available-bytes>'
        : '<d:resourcetype/><d:getcontentlength>' + n.size + '</d:getcontentlength><d:getcontenttype>' + x(n.mime || 'application/octet-stream') + '</d:getcontenttype>') +
      '<oc:id>' + fileid + '</oc:id><oc:fileid>' + n.id + '</oc:fileid><oc:permissions>' + perms + '</oc:permissions>' +
      '<oc:size>' + (n.dir ? subtree(n) : n.size) + '</oc:size><oc:owner-id>' + x(n.owner) + '</oc:owner-id><oc:owner-display-name>' + x((store.user(n.owner) || {}).display || n.owner) + '</oc:owner-display-name>' +
      '<nc:has-preview>false</nc:has-preview><nc:mount-type></nc:mount-type>' +
      '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
  }
  function subtree(n) { return store.all('with recursive t(id, size) as (select id, size from nodes where id = ? union all select c.id, c.size from nodes c join t on c.parent = t.id where c.trashed = 0) select coalesce(sum(size),0) n from t', n.id)[0].n; }
  const multistatus = (body) => '<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">' + body + '</d:multistatus>';

  function destPath(req, user) {
    const d = req.headers.destination; if (!d) throw new CloudError(400, 'Missing destination.');
    const p = decodeURIComponent(new URL(d, publicUrl).pathname), base = '/remote.php/dav/files/' + user;
    if (!p.toLowerCase().startsWith(base.toLowerCase() + '/') && p.toLowerCase() !== base.toLowerCase()) throw new CloudError(502, 'Files can only be moved within your Cloud.');
    return p.slice(base.length);
  }
  const split = (path) => { const parts = path.split('/').filter(Boolean); return { dir: '/' + parts.slice(0, -1).join('/'), name: parts[parts.length - 1] }; };

  async function serve(req, res, who, path) {
    const m = /^\/remote\.php\/(?:dav\/files\/([^/]+)|webdav)(\/.*)?$/.exec(path), up = /^\/remote\.php\/dav\/uploads\/([^/]+)\/([A-Za-z0-9._-]+)(?:\/(.+))?$/.exec(path);
    if (up) return uploads(req, res, who, decodeURIComponent(up[1]), up[2], up[3] && decodeURIComponent(up[3]));
    if (!m) throw new CloudError(404, 'Not found.');
    const user = m[1] ? decodeURIComponent(m[1]).toLowerCase() : who;
    if (user !== who) throw new CloudError(403, 'That is not your Cloud.');
    const rel = decodeURIComponent(m[2] || '/'), n = store.resolve(user, rel), method = req.method;
    const send = (status, headers = {}, body) => { res.writeHead(status, { 'cache-control': 'no-store', ...headers }); res.end(body); };

    if (method === 'OPTIONS') return send(200, { dav: '1, 3', allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, PROPPATCH' });
    if (method === 'PROPFIND') {
      if (!n) throw new CloudError(404, 'Not found.');
      const depth = req.headers.depth === '0' ? 0 : 1, href = filesBase(user) + enc(store.pathOf(n)) + (n.dir && store.pathOf(n) !== '/' ? '/' : n.dir ? '' : '');
      let body = props(n, n.parent === null ? filesBase(user) + '/' : href, who);
      if (n.dir && depth) for (const c of store.list(n)) body += props(c, filesBase(user) + enc(store.pathOf(c)) + (c.dir ? '/' : ''), who);
      for await (const _ of req) { /* drain the request body */ }
      return send(207, { 'content-type': 'application/xml; charset=utf-8' }, multistatus(body));
    }
    if (method === 'PROPPATCH') { for await (const _ of req) {} if (!n) throw new CloudError(404, 'Not found.'); return send(207, { 'content-type': 'application/xml; charset=utf-8' }, multistatus('<d:response><d:href>' + x(path) + '</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')); }
    if (method === 'GET' || method === 'HEAD') {
      if (!n) throw new CloudError(404, 'Not found.');
      if (n.dir) return send(200, { 'content-type': 'text/plain' }, 'This is a folder.');
      const headers = { 'content-type': n.mime || 'application/octet-stream', etag: '"' + n.etag + '"', 'oc-etag': '"' + n.etag + '"', 'oc-fileid': String(n.id), 'last-modified': new Date(n.mtime).toUTCString(), 'accept-ranges': 'bytes' };
      if (req.headers['if-none-match'] === '"' + n.etag + '"') return send(304, headers);
      if (method === 'HEAD') return send(200, { ...headers, 'content-length': String(n.size) });
      const g = await store.blobs.get(n.blob, req.headers.range);
      res.writeHead(g.status, { ...headers, 'cache-control': 'no-store', ...(g.headers['content-length'] ? { 'content-length': g.headers['content-length'] } : {}), ...(g.headers['content-range'] ? { 'content-range': g.headers['content-range'] } : {}) });
      return g.stream.pipe(res);
    }
    if (method === 'PUT') {
      const { dir, name } = split(rel), parent = store.resolve(user, dir);
      if (!parent) throw new CloudError(409, 'That folder does not exist.');
      const got = await store.receive(req, user, +req.headers['content-length'] || +req.headers['oc-total-length'] || 0);
      const r = await store.write(parent, name, got, { by: who, ifMatch: req.headers['if-match'], ifNoneMatch: req.headers['if-none-match'] });
      return send(r.created ? 201 : 204, { etag: '"' + r.node.etag + '"', 'oc-etag': '"' + r.node.etag + '"', 'oc-fileid': String(r.node.id).padStart(8, '0') + 'mncloud', 'x-oc-mtime': 'accepted' });
    }
    if (method === 'MKCOL') {
      if (n) throw new CloudError(405, 'Something with that name is already here.');
      const { dir, name } = split(rel), parent = store.resolve(user, dir);
      if (!parent) throw new CloudError(409, 'That folder does not exist.');
      const d = store.mkdir(parent, name, who);
      return send(201, { 'oc-fileid': String(d.id).padStart(8, '0') + 'mncloud', 'oc-etag': '"' + d.etag + '"' });
    }
    if (method === 'DELETE') {
      if (!n) throw new CloudError(404, 'Not found.');
      if (req.headers['if-match'] && req.headers['if-match'].replace(/"/g, '') !== n.etag) throw new CloudError(412, 'This file changed since you opened it.');
      await store.trash(n, who);
      return send(204);
    }
    if (method === 'MOVE' || method === 'COPY') {
      if (!n) throw new CloudError(404, 'Not found.');
      const to = destPath(req, user), { dir, name } = split(to), dest = store.resolve(user, dir), overwrite = req.headers.overwrite !== 'F';
      const r = method === 'MOVE' ? await store.move(n, dest, name, { overwrite, by: who }) : await store.copy(n, dest, name, { overwrite, by: who });
      return send(r.replaced ? 204 : 201, { 'oc-etag': '"' + r.node.etag + '"', 'oc-fileid': String(r.node.id).padStart(8, '0') + 'mncloud' });
    }
    throw new CloudError(405, 'That is not something Cloud can do.');
  }

  // Nextcloud chunked uploads (v2): MKCOL a folder, PUT numbered chunks, then MOVE .file to the destination.
  async function uploads(req, res, who, user, id, part) {
    if (user.toLowerCase() !== who) throw new CloudError(403, 'That is not your upload.');
    const dir = join(uploadsDir, who + '-' + id), send = (s, h = {}) => { res.writeHead(s, h); res.end(); };
    if (req.method === 'MKCOL') { mkdirSync(dir, { recursive: true }); store.run('insert or replace into uploads values (?, ?, ?)', who + '-' + id, who, Date.now()); return send(201); }
    if (req.method === 'DELETE') { rmSync(dir, { recursive: true, force: true }); return send(204); }
    if (req.method === 'PUT' && part && /^\d{1,5}$/.test(part)) {
      const got = await store.receive(req, who, +req.headers['content-length'] || 0);
      const { renameSync } = await import('node:fs'); renameSync(got.file, join(dir, part.padStart(5, '0')));
      return send(201);
    }
    if (req.method === 'MOVE' && part === '.file') {
      const to = destPath(req, who), { dir: d, name } = (() => { const p = to.split('/').filter(Boolean); return { dir: '/' + p.slice(0, -1).join('/'), name: p[p.length - 1] }; })();
      const parent = store.resolve(who, d); if (!parent) throw new CloudError(409, 'That folder does not exist.');
      const files = readdirSync(dir).sort();
      const joined = Readable.from((async function* () { for (const f of files) for await (const c of createReadStream(join(dir, f))) yield c; })());
      const got = await store.receive(joined, who, 0);
      rmSync(dir, { recursive: true, force: true }); store.run('delete from uploads where id = ?', who + '-' + id);
      const r = await store.write(parent, name, got, { by: who, ifMatch: req.headers['if-match'] });
      return send(r.created ? 201 : 204, { etag: '"' + r.node.etag + '"', 'oc-etag': '"' + r.node.etag + '"', 'oc-fileid': String(r.node.id).padStart(8, '0') + 'mncloud' });
    }
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'content-type': 'application/xml' }); return res.end(multistatus('')); }
    throw new CloudError(405, 'Not supported.');
  }

  return { serve };
}
