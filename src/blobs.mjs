// Where file contents live. In production: an S3-compatible bucket (Railway's), spoken to directly with AWS
// Signature Version 4 (no SDK). For tests and local runs: a folder. Both store whole objects under opaque keys;
// names, folders and owners live in the database (db.mjs).
import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function s3Store({ endpoint, bucket, key, secret, region = 'auto', prefix = 'cc/' }) {
  const base = new URL(endpoint);
  async function call(method, objectKey, { body, length, type, headers = {}, query = '' } = {}) {
    const path = '/' + enc(bucket) + '/' + (prefix + objectKey).split('/').map(enc).join('/');
    const now = new Date(), amz = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = amz.slice(0, 8);
    const h = { host: base.host, 'x-amz-date': amz, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', ...headers };
    if (length !== undefined) h['content-length'] = String(length);
    if (type) h['content-type'] = type;
    const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
    const canonical = [method, path, query, names.map((n) => n + ':' + lower[n] + '\n').join(''), names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
    const scope = day + '/' + region + '/s3/aws4_request';
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
    const kSign = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), 's3'), 'aws4_request');
    h.authorization = 'AWS4-HMAC-SHA256 Credential=' + key + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + createHmac('sha256', kSign).update(toSign).digest('hex');
    delete h.host;
    const r = await fetch(base.origin + path + (query ? '?' + query : ''), { method, headers: h, body, duplex: body ? 'half' : undefined });
    if (r.status >= 300 && !(method === 'GET' && r.status === 304)) { const t = await r.text().catch(() => ''); const e = new Error('storage ' + method + ' ' + r.status + ' ' + t.slice(0, 200)); e.status = r.status; throw e; }
    return r;
  }
  return {
    async put(k, file, size, type) { await call('PUT', k, { body: Readable.toWeb(createReadStream(file)), length: size, type: type || 'application/octet-stream' }); },
    async get(k, range) { const r = await call('GET', k, { headers: range ? { range } : {} }); return { stream: Readable.fromWeb(r.body), status: r.status, headers: { 'content-range': r.headers.get('content-range'), 'content-length': r.headers.get('content-length') } }; },
    async del(k) { try { await call('DELETE', k); } catch (e) { if (e.status !== 404) throw e; } },
    async copy(from, to) { await call('PUT', to, { length: 0, headers: { 'x-amz-copy-source': '/' + bucket + '/' + (prefix + from).split('/').map(enc).join('/') } }); },
  };
}

export function folderStore(root) {
  mkdirSync(root, { recursive: true });
  const at = (k) => join(root, k);
  return {
    async put(k, file) { mkdirSync(dirname(at(k)), { recursive: true }); await pipeline(createReadStream(file), createWriteStream(at(k))); },
    async get(k, range) {
      const p = at(k); if (!existsSync(p)) { const e = new Error('missing'); e.status = 404; throw e; }
      const size = statSync(p).size, m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
      if (!m) return { stream: createReadStream(p), status: 200, headers: { 'content-length': String(size) } };
      const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? +m[2] : size - 1;
      return { stream: createReadStream(p, { start, end }), status: 206, headers: { 'content-range': 'bytes ' + start + '-' + end + '/' + size, 'content-length': String(end - start + 1) } };
    },
    async del(k) { rmSync(at(k), { force: true }); },
    async copy(from, to) { mkdirSync(dirname(at(to)), { recursive: true }); await pipeline(createReadStream(at(from)), createWriteStream(at(to))); },
  };
}
