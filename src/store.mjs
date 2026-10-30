// Christian Cloud's file system: folders and files in SQLite, contents in the blob store (blobs.mjs). Every write
// checks the account's allowance (3 GB) and the service's capacity (256 GB) inside one transaction, so neither can be
// exceeded. Overwrites keep the previous contents as a version; deletes go to the trash first. Both count toward the
// allowance, the way the person would expect.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const GB = 1_000_000_000;
export class CloudError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new CloudError(status, message); };
const now = () => Date.now();
const KEEP_VERSIONS = 10, TRASH_DAYS = 30;
const BAD_NAME = /[\\/\u0000-\u001f]|^\.{1,2}$|^\s|\s$/;

const SCHEMA = `
create table if not exists users (id text primary key, display text, did text, quota integer, created integer);
create table if not exists nodes (id integer primary key, owner text not null, parent integer, name text not null, dir integer not null,
  size integer not null default 0, mime text, etag text, mtime integer, blob text, trashed integer not null default 0, trashed_at integer,
  origin_parent integer, modified_by text);
create unique index if not exists nodes_name on nodes(owner, parent, name) where trashed = 0 and parent is not null;
create index if not exists nodes_parent on nodes(parent);
create table if not exists versions (id integer primary key, node integer not null, blob text not null, size integer not null, mtime integer, etag text, by text);
create table if not exists shares (id integer primary key, node integer not null, owner text not null, kind text not null, target text,
  perm text not null, created integer, record text);
create unique index if not exists shares_user on shares(node, kind, target) where kind = 'user';
create table if not exists sessions (id text primary key, user text, csrf text, expires integer);
create table if not exists apppasswords (id integer primary key, user text, name text, hash text unique, created integer, used integer);
create table if not exists flows (token text primary key, poll text unique, user text, password text, name text, created integer);
create table if not exists uploads (id text primary key, user text, created integer);
`;

const mimeOf = (name) => ({ docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip',
  json: 'application/json', beepbox: 'application/json' })[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

export function createStore({ dataDir, blobs, quota = 3 * GB, capacity = 256 * GB }) {
  mkdirSync(join(dataDir, 'tmp'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'cloud.sqlite'));
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  function tx(fn) { db.exec('begin immediate'); try { const r = fn(); db.exec('commit'); return r; } catch (e) { db.exec('rollback'); throw e; } }
  const etag = () => randomBytes(8).toString('hex');
  const blobKey = () => randomBytes(4).toString('hex') + '/' + randomBytes(16).toString('hex');

  // ---------------------------------------------------------------- people
  function ensureUser(id, display, did) {
    const u = one('select * from users where id = ?', id);
    if (!u) {
      run('insert into users values (?, ?, ?, ?, ?)', id, display || id, did || null, quota, now());
      run('insert into nodes (owner, parent, name, dir, etag, mtime) values (?, null, ?, 1, ?, ?)', id, '', etag(), now());
    } else if ((display && display !== u.display) || (did && did !== u.did)) run('update users set display = coalesce(?, display), did = coalesce(?, did) where id = ?', display || null, did || null, id);
    return one('select * from users where id = ?', id);
  }
  const user = (id) => one('select * from users where id = ?', id);
  const root = (owner) => one('select * from nodes where owner = ? and parent is null', owner);
  const used = (owner) => one('select coalesce((select sum(size) from nodes where owner = ?), 0) + coalesce((select sum(v.size) from versions v join nodes n on n.id = v.node where n.owner = ?), 0) as n', owner, owner).n;
  const total = () => one('select coalesce((select sum(size) from nodes), 0) + coalesce((select sum(size) from versions), 0) as n').n;
  function usage(owner) { const u = user(owner); return { used: used(owner), quota: u ? u.quota : quota, serviceUsed: total(), serviceCapacity: capacity }; }
  function room(owner, grow) {
    if (grow <= 0) return;
    const u = user(owner);
    if (used(owner) + grow > u.quota) fail(507, 'Your Cloud is full. Empty the trash or delete something to make room.');
    if (total() + grow > capacity) fail(507, 'Christian Cloud is full for now. Your file was not saved.');
  }

  // ---------------------------------------------------------------- nodes
  const node = (id) => one('select * from nodes where id = ?', id);
  function child(parent, name) { return one('select * from nodes where parent = ? and name = ? and trashed = 0', parent, name); }
  function checkName(name) { name = String(name || '').normalize('NFC'); if (!name || name.length > 240 || BAD_NAME.test(name)) fail(400, 'That name cannot be used.'); return name; }
  function resolve(owner, path) {
    let n = root(owner);
    for (const part of String(path || '').split('/').filter(Boolean)) { if (!n || !n.dir) return null; n = child(n.id, part.normalize('NFC')); }
    return n || null;
  }
  function pathOf(n) { const parts = []; for (let c = n; c && c.parent !== null; c = node(c.parent)) parts.unshift(c.name); return '/' + parts.join('/'); }
  function crumbs(n) { const out = []; for (let c = n; c; c = c.parent !== null ? node(c.parent) : null) out.unshift({ id: c.id, name: c.parent === null ? '' : c.name }); return out; }
  function within(n, ancestor) { for (let c = n; c; c = c.parent !== null ? node(c.parent) : null) if (c.id === ancestor.id) return true; return false; }
  function list(dir) { return all('select * from nodes where parent = ? and trashed = 0 order by dir desc, name collate nocase', dir.id); }
  function touch(n) { for (let c = n; c; c = c.parent !== null ? node(c.parent) : null) run('update nodes set etag = ?, mtime = ? where id = ?', etag(), now(), c.id); }
  function sizeOf(n) { return n.dir ? all('select * from nodes where parent = ?', n.id).reduce((s, c) => s + sizeOf(c), 0) : n.size; }

  function mkdir(parent, name, by) {
    name = checkName(name);
    if (!parent || !parent.dir) fail(409, 'That folder does not exist.');
    if (child(parent.id, name)) fail(405, 'Something with that name is already here.');
    const r = run('insert into nodes (owner, parent, name, dir, etag, mtime, modified_by) values (?, ?, ?, 1, ?, ?, ?)', parent.owner, parent.id, name, etag(), now(), by || parent.owner);
    touch(node(parent.id));
    return node(Number(r.lastInsertRowid));
  }

  /** Receives a request body into a temporary file, refusing early when it cannot fit. Returns { file, size, hash }. */
  async function receive(stream, owner, declared) {
    if (declared && owner) room(owner, declared);
    const file = join(dataDir, 'tmp', randomBytes(12).toString('hex')), out = createWriteStream(file), h = createHash('sha256');
    const limit = owner ? Math.min(user(owner).quota - used(owner), capacity - total()) : capacity;
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > limit) fail(507, 'Your Cloud is full. Empty the trash or delete something to make room.');
        h.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
      return { file, size, hash: h.digest('hex') };
    } catch (e) { out.destroy(); rmSync(file, { force: true }); throw e; }
  }

  /** Writes a received file to parent/name: a new file, or a new version of the existing one. */
  async function write(parent, name, got, { by, ifMatch, ifNoneMatch } = {}) {
    name = checkName(name);
    try {
      if (!parent || !parent.dir) fail(409, 'That folder does not exist.');
      const existing = child(parent.id, name);
      if (existing && existing.dir) fail(409, 'A folder already has that name.');
      if (ifNoneMatch === '*' && existing) fail(412, 'That file already exists.');
      if (ifMatch && (!existing || ifMatch.replace(/"/g, '') !== existing.etag)) fail(412, 'This file changed since you opened it.');
      room(parent.owner, got.size); // the old contents stay as a version, so the whole new size counts
      const key = blobKey();
      await blobs.put(key, got.file, got.size, mimeOf(name));
      try {
        return tx(() => {
          room(parent.owner, got.size);
          const cur = child(parent.id, name);
          if (cur) {
            run('insert into versions (node, blob, size, mtime, etag, by) values (?, ?, ?, ?, ?, ?)', cur.id, cur.blob, cur.size, cur.mtime, cur.etag, cur.modified_by);
            run('update nodes set size = ?, blob = ?, etag = ?, mtime = ?, mime = ?, modified_by = ? where id = ?', got.size, key, etag(), now(), mimeOf(name), by || parent.owner, cur.id);
            touch(node(parent.id));
            return { node: node(cur.id), created: false };
          }
          const r = run('insert into nodes (owner, parent, name, dir, size, mime, etag, mtime, blob, modified_by) values (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)',
            parent.owner, parent.id, name, got.size, mimeOf(name), etag(), now(), key, by || parent.owner);
          touch(node(parent.id));
          return { node: node(Number(r.lastInsertRowid)), created: true };
        });
      } catch (e) { await blobs.del(key).catch(() => {}); throw e; }
    } finally { rmSync(got.file, { force: true }); pruneVersions().catch(() => {}); }
  }

  async function pruneVersions() {
    const extra = all(`select v.id, v.blob from versions v where (select count(*) from versions w where w.node = v.node and w.id > v.id) >= ${KEEP_VERSIONS}`);
    for (const v of extra) { run('delete from versions where id = ?', v.id); await blobs.del(v.blob).catch(() => {}); }
  }

  function rename(n, name, by) {
    name = checkName(name);
    if (n.parent === null) fail(403, 'Your home folder cannot be renamed.');
    if (n.name === name) return n;
    if (child(n.parent, name)) fail(412, 'Something with that name is already here.');
    run('update nodes set name = ?, mtime = ?, etag = ?, modified_by = ? where id = ?', name, now(), etag(), by || n.owner, n.id);
    touch(node(n.parent));
    return node(n.id);
  }
  async function move(n, dest, name, { overwrite = false, by } = {}) {
    name = checkName(name || n.name);
    if (n.parent === null) fail(403, 'Your home folder cannot be moved.');
    if (!dest || !dest.dir) fail(409, 'That folder does not exist.');
    if (dest.owner !== n.owner) fail(403, 'Files can only be moved within one Cloud.');
    if (n.dir && within(dest, n)) fail(409, 'A folder cannot go inside itself.');
    const there = child(dest.id, name);
    if (there && there.id !== n.id) { if (!overwrite) fail(412, 'Something with that name is already there.'); await trash(there, by); }
    const from = n.parent;
    run('update nodes set parent = ?, name = ?, mtime = ?, etag = ?, modified_by = ? where id = ?', dest.id, name, now(), etag(), by || n.owner, n.id);
    touch(node(from)); touch(node(dest.id));
    return { node: node(n.id), replaced: !!there };
  }
  async function copy(n, dest, name, { overwrite = false, by } = {}) {
    name = checkName(name || n.name);
    if (!dest || !dest.dir) fail(409, 'That folder does not exist.');
    if (n.dir && within(dest, n)) fail(409, 'A folder cannot be copied into itself.');
    const there = child(dest.id, name);
    if (there) { if (!overwrite) fail(412, 'Something with that name is already there.'); await trash(there, by); }
    room(dest.owner, sizeOf(n));
    async function dup(src, into, nm) {
      if (src.dir) { const d = mkdir(into, nm, by); for (const c of list(src)) await dup(c, d, c.name); return d; }
      const key = blobKey(); await blobs.copy(src.blob, key);
      const r = run('insert into nodes (owner, parent, name, dir, size, mime, etag, mtime, blob, modified_by) values (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)', into.owner, into.id, nm, src.size, src.mime, etag(), now(), key, by || into.owner);
      return node(Number(r.lastInsertRowid));
    }
    const made = await dup(n, dest, name); touch(node(dest.id));
    return { node: made, replaced: !!there };
  }
  async function trash(n, by) {
    if (n.parent === null) fail(403, 'Your home folder cannot be deleted.');
    run('update nodes set trashed = 1, trashed_at = ?, origin_parent = parent, parent = null, modified_by = ? where id = ?', now(), by || n.owner, n.id);
    run("delete from shares where node = ?", n.id);
    touch(node(n.origin_parent ?? n.parent) || root(n.owner));
    return node(n.id);
  }
  function trashed(owner) { return all('select * from nodes where owner = ? and trashed = 1 order by trashed_at desc', owner); }
  function restore(n) {
    if (!n.trashed) return n;
    let dest = node(n.origin_parent);
    if (!dest || dest.trashed) dest = root(n.owner);
    let name = n.name, k = 1;
    while (child(dest.id, name)) { const dot = n.name.lastIndexOf('.'); name = dot > 0 && !n.dir ? n.name.slice(0, dot) + ' (' + (++k) + ')' + n.name.slice(dot) : n.name + ' (' + (++k) + ')'; }
    run('update nodes set trashed = 0, trashed_at = null, parent = ?, origin_parent = null, name = ? where id = ?', dest.id, name, n.id);
    touch(dest);
    return node(n.id);
  }
  async function purge(n) {
    const doomed = [];
    (function walk(x) { doomed.push(x); for (const c of all('select * from nodes where parent = ?', x.id)) walk(c); })(n);
    for (const d of doomed) {
      for (const v of all('select * from versions where node = ?', d.id)) await blobs.del(v.blob).catch(() => {});
      run('delete from versions where node = ?', d.id); run('delete from shares where node = ?', d.id);
      if (d.blob) await blobs.del(d.blob).catch(() => {});
      run('delete from nodes where id = ?', d.id);
    }
  }
  async function emptyOld() { for (const n of all('select * from nodes where trashed = 1 and trashed_at < ?', now() - TRASH_DAYS * 864e5)) await purge(n); }
  function versions(n) { return all('select id, size, mtime, etag, by from versions where node = ? order by id desc', n.id); }
  function restoreVersion(n, versionId, by) {
    const v = one('select * from versions where id = ? and node = ?', versionId, n.id);
    if (!v) fail(404, 'That version is gone.');
    return tx(() => {
      run('update versions set blob = ?, size = ?, mtime = ?, etag = ?, by = ? where id = ?', n.blob, n.size, n.mtime, n.etag, n.modified_by, v.id);
      run('update nodes set blob = ?, size = ?, etag = ?, mtime = ?, modified_by = ? where id = ?', v.blob, v.size, etag(), now(), by || n.owner, n.id);
      touch(node(n.parent));
      return node(n.id);
    });
  }
  function search(owner, q) {
    const like = '%' + String(q || '').replace(/[%_]/g, '').slice(0, 80) + '%';
    return all('select * from nodes where owner = ? and trashed = 0 and parent is not null and name like ? order by mtime desc limit 100', owner, like);
  }
  function recent(owner) { return all('select * from nodes where owner = ? and trashed = 0 and dir = 0 order by mtime desc limit 50', owner); }

  // ---------------------------------------------------------------- shares
  function shareWith(n, target, perm, record) {
    if (n.parent === null) fail(400, 'Share a folder or file inside your Cloud.');
    perm = perm === 'edit' ? 'edit' : 'view';
    const had = one("select * from shares where node = ? and kind = 'user' and target = ?", n.id, target);
    if (had) { run('update shares set perm = ? where id = ?', perm, had.id); return one('select * from shares where id = ?', had.id); }
    const r = run("insert into shares (node, owner, kind, target, perm, created, record) values (?, ?, 'user', ?, ?, ?, ?)", n.id, n.owner, target, perm, now(), record || null);
    return one('select * from shares where id = ?', Number(r.lastInsertRowid));
  }
  function shareLink(n, perm) {
    if (n.parent === null) fail(400, 'Share a folder or file inside your Cloud.');
    const token = randomBytes(18).toString('base64url');
    const r = run("insert into shares (node, owner, kind, target, perm, created) values (?, ?, 'link', ?, ?, ?)", n.id, n.owner, token, perm === 'edit' ? 'edit' : 'view', now());
    return one('select * from shares where id = ?', Number(r.lastInsertRowid));
  }
  const sharesOf = (n) => all('select * from shares where node = ? order by created', n.id);
  const share = (id) => one('select * from shares where id = ?', id);
  const linkShare = (token) => one("select * from shares where kind = 'link' and target = ?", token);
  function unshare(id) { run('delete from shares where id = ?', id); }
  function setShareRecord(id, uri) { run('update shares set record = ? where id = ?', uri, id); }
  function sharedWith(userId) { return all("select s.*, n.name, n.dir, n.size, n.mtime, n.mime, n.owner from shares s join nodes n on n.id = s.node where s.kind = 'user' and s.target = ? and n.trashed = 0 order by s.created desc", userId); }
  /** What can `who` do with node n: 'owner', 'edit', 'view' or null. Shares on a folder cover everything inside it. */
  function access(n, who) {
    if (!n || n.trashed && n.owner !== who) return null;
    if (n.owner === who) return 'owner';
    let best = null;
    for (let c = n; c; c = c.parent !== null ? node(c.parent) : null) {
      const s = one("select perm from shares where node = ? and kind = 'user' and target = ?", c.id, who);
      if (s) best = s.perm === 'edit' ? 'edit' : best || 'view';
    }
    return best;
  }
  function linkAccess(n, token) {
    const s = linkShare(token); if (!s || !n) return null;
    const top = node(s.node);
    return top && !top.trashed && within(n, top) ? s.perm : null;
  }

  return { db, one, all, run, tx, ensureUser, user, root, node, child, resolve, pathOf, crumbs, within, list, mkdir, receive, write, rename, move, copy, trash, trashed, restore,
    purge, emptyOld, versions, restoreVersion, search, recent, usage, room, shareWith, shareLink, sharesOf, share, linkShare, unshare, setShareRecord, sharedWith, access, linkAccess, mimeOf, blobs };
}
