// Asteria Office in Asteria Cloud. Cloud tells the document server (office.asteria.technology) what to open,
// signed with the shared secret; the server fetches the file from Cloud with a short-lived signed link and sends the
// edited document back through a signed callback, which Cloud saves as a new version. Everyone who opens the same
// version gets the same document key, so they edit it together, live.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { CloudError } from './store.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, secret) {
  const body = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(payload));
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export function verifyJwt(token, secret) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return null;
  const want = createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  if (want.length !== s.length || !timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try { const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp && c.exp * 1000 < Date.now() ? null : c; } catch { return null; }
}

const TYPES = { word: ['docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'docm', 'dotx', 'epub', 'html'], cell: ['xlsx', 'xls', 'ods', 'csv', 'xlsm', 'xltx'], slide: ['pptx', 'ppt', 'odp', 'pptm', 'potx'], pdf: ['pdf', 'djvu', 'xps', 'oxps'] };
const EDITABLE = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'md', 'rtf', 'docm', 'xlsm', 'pptm', 'pdf'];
export const extOf = (name) => String(name).split('.').pop().toLowerCase();
export function officeType(name) { const e = extOf(name); return Object.keys(TYPES).find((k) => TYPES[k].includes(e)) || null; }

export function createOffice({ store, officeUrl, secret, publicUrl }) {
  const enabled = !!(officeUrl && secret);
  // a link the document server can fetch the file with, for a few hours, without anyone's session
  const fileLink = (n) => publicUrl + '/api/office/file/' + n.id + '?t=' + signJwt({ f: n.id, e: n.etag, exp: Math.floor(Date.now() / 1000) + 6 * 3600 }, secret);
  const callbackLink = (n) => publicUrl + '/api/office/callback/' + n.id + '?t=' + signJwt({ f: n.id, cb: 1, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 }, secret);
  const docKey = (n) => (n.id + '-' + n.etag).replace(/[^0-9A-Za-z._=-]/g, '').slice(0, 120);

  function editorConfig(n, user, perm, lang) {
    if (!enabled) throw new CloudError(503, 'Asteria Office is not connected.');
    const type = officeType(n.name); if (!type) throw new CloudError(415, 'Asteria Office cannot open this kind of file.');
    const canEdit = (perm === 'owner' || perm === 'edit') && EDITABLE.includes(extOf(n.name));
    const config = {
      document: { fileType: extOf(n.name), key: docKey(n), title: n.name, url: fileLink(n),
        info: { owner: (store.user(n.owner) || {}).display || n.owner, uploaded: new Date(n.mtime).toISOString() },
        permissions: { edit: canEdit, download: true, print: true, comment: canEdit, review: canEdit, fillForms: canEdit, chat: true } },
      documentType: type,
      editorConfig: {
        mode: canEdit ? 'edit' : 'view', lang: lang || 'en', callbackUrl: callbackLink(n),
        user: { id: user.id, name: user.display || user.id },
        coEditing: { mode: 'fast', change: true },
        customization: {
          autosave: true, forcesave: false, compactHeader: false, toolbarNoTabs: false, uiTheme: 'default-light',
          logo: { image: officeUrl + '/asteria-office/brand/icons/office-mark.svg', url: officeUrl + '/' },
          customer: { name: 'Asteria Technology', www: 'https://asteria.technology', info: 'Asteria Office is free and open source.', logo: officeUrl + '/asteria-office/brand/icons/office-mark.svg' },
          goback: { url: publicUrl + '/files/' + (n.parent || ''), text: 'Back to Cloud', blank: false },
          feedback: false, help: false, plugins: false, hideRightMenu: false,
        },
      },
    };
    config.token = signJwt(config, secret);
    return config;
  }

  /** The document server fetches the file to open it. */
  async function file(req, res, id, query) {
    const c = verifyJwt(query.get('t'), secret), n = store.node(id);
    if (!c || c.f !== id || !n || n.trashed) throw new CloudError(403, 'This link expired.');
    const g = await store.blobs.get(n.blob);
    res.writeHead(200, { 'content-type': n.mime || 'application/octet-stream', 'content-length': String(n.size), 'cache-control': 'no-store' });
    g.stream.pipe(res);
  }

  /** The document server reports what happened; on "ready to save" Cloud fetches the result and keeps it. */
  async function callback(req, res, id, query) {
    const link = verifyJwt(query.get('t'), secret);
    let raw = ''; for await (const c of req) raw += c;
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
    const signed = body.token ? verifyJwt(body.token, secret) : verifyJwt(String(req.headers.authorizationjwt || req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret);
    const msg = signed ? (signed.payload || signed) : null;
    const ok = (error = 0) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error })); };
    if (!link || link.f !== id || !msg) return ok(1);
    const n = store.node(id);
    if (!n || n.trashed) return ok(1);
    if ((msg.status === 2 || msg.status === 6) && msg.url) {
      const u = new URL(msg.url);
      if (u.origin !== new URL(officeUrl).origin) return ok(1); // only ever fetch from our own document server
      const r = await fetch(u.href);
      if (!r.ok) return ok(1);
      const by = (msg.users && msg.users[0]) || n.owner;
      try {
        const got = await store.receive(Readable.fromWeb(r.body), n.owner, +r.headers.get('content-length') || 0);
        await store.write(store.node(n.parent), n.name, got, { by });
      } catch (e) { return ok(1); }
    }
    return ok(0);
  }
  return { enabled, editorConfig, file, callback, officeUrl };
}
