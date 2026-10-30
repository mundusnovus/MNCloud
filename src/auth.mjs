// Who is asking. People sign in with their Christian Systems account (OpenID Connect against Social, with PKCE).
// Apps and the desktop client get a device key through the same sign-in flow Nextcloud clients use (Login Flow v2),
// so Sprite, Box, Office and the sync app need no password of their own. Keys are stored hashed.
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySig } from 'node:crypto';
import { CloudError } from './store.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
const fail = (status, message) => { throw new CloudError(status, message); };

export function createAuth({ store, issuer, clientId, clientSecret, publicUrl, secret, fetchImpl = fetch }) {
  const { one, run } = store;
  let discovery = null, jwks = null;
  async function disc() { if (!discovery) discovery = await (await fetchImpl(issuer + '/.well-known/openid-configuration')).json(); return discovery; }
  async function keys() { if (!jwks) jwks = (await (await fetchImpl((await disc()).jwks_uri)).json()).keys; return jwks; }

  // A small signed cookie carries the sign-in state between the redirect and the callback.
  const seal = (obj) => { const body = b64u(JSON.stringify(obj)); return body + '.' + createHmac('sha256', secret).update(body).digest('base64url'); };
  function unseal(v) {
    const [body, mac] = String(v || '').split('.');
    if (!body || !mac) return null;
    const want = createHmac('sha256', secret).update(body).digest('base64url');
    if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  }

  async function startLogin(returnTo) {
    const d = await disc(), verifier = b64u(randomBytes(32)), state = b64u(randomBytes(16)), nonce = b64u(randomBytes(16));
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: publicUrl + '/auth/callback', scope: 'openid profile', state, nonce,
      code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
    const back = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    return { url: url.href, cookie: seal({ verifier, state, nonce, back, at: Date.now() }) };
  }
  async function finishLogin(query, cookie) {
    const st = unseal(cookie);
    if (!st || st.state !== query.get('state') || Date.now() - st.at > 600000) fail(400, 'That sign-in expired. Please try again.');
    if (!query.get('code')) fail(400, query.get('error_description') || 'Sign-in was cancelled.');
    const d = await disc();
    const r = await fetchImpl(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64') },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: query.get('code'), redirect_uri: publicUrl + '/auth/callback', code_verifier: st.verifier }) });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) fail(502, 'Christian Systems sign-in did not answer as expected.');
    const claims = await checkIdToken(tok.id_token, st.nonce);
    const u = store.ensureUser(claims.sub, claims.name || claims.preferred_username || claims.sub, claims.did);
    return { user: u, session: newSession(u.id), back: st.back };
  }
  async function checkIdToken(jwt, nonce) {
    const [h, p, s] = jwt.split('.'), head = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
    const jwk = (await keys()).find((k) => k.kid === head.kid) || (await keys())[0];
    if (head.alg !== 'RS256' || !jwk || !verifySig('RSA-SHA256', Buffer.from(h + '.' + p), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'))) fail(401, 'The sign-in token was not genuine.');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !aud.includes(clientId) || claims.exp * 1000 < Date.now() || claims.nonce !== nonce || !/^[a-z0-9-]{2,40}$/.test(claims.sub || '')) fail(401, 'The sign-in token was not for Christian Cloud.');
    return claims;
  }

  // ---------------------------------------------------------------- sessions and device keys
  function newSession(userId) {
    const id = b64u(randomBytes(32)), csrf = b64u(randomBytes(18));
    run('insert into sessions values (?, ?, ?, ?)', id, userId, csrf, Date.now() + 30 * 864e5);
    return { id, csrf };
  }
  function session(req) {
    const id = (/(?:^|;\s*)cc_session=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '') || [])[1];
    const s = id && one('select * from sessions where id = ? and expires > ?', id, Date.now());
    return s ? { user: s.user, csrf: s.csrf, sid: s.id } : null;
  }
  function endSession(sid) { run('delete from sessions where id = ?', sid); }
  function newAppPassword(userId, name) {
    const pw = b64u(randomBytes(30)).replace(/[-_]/g, 'x');
    run('insert into apppasswords (user, name, hash, created) values (?, ?, ?, ?)', userId, String(name || 'Device').slice(0, 80), sha(pw), Date.now());
    return pw;
  }
  function basic(req) {
    const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const [login, ...rest] = Buffer.from(m[1], 'base64').toString().split(':'), pw = rest.join(':');
    const k = one('select * from apppasswords where hash = ?', sha(pw));
    if (!k || k.user !== login.toLowerCase()) return null;
    run('update apppasswords set used = ? where id = ?', Date.now(), k.id);
    return { user: k.user, device: k.id };
  }
  function devices(userId) { return store.all('select id, name, created, used from apppasswords where user = ? order by created desc', userId); }
  function forgetDevice(userId, id) { run('delete from apppasswords where id = ? and user = ?', id, userId); }

  // ---------------------------------------------------------------- Login Flow v2 (device sign-in)
  function flowStart(name) {
    const token = b64u(randomBytes(32)), poll = b64u(randomBytes(48));
    run('insert into flows (token, poll, name, created) values (?, ?, ?, ?)', token, poll, String(name || 'A Christian Systems app').slice(0, 80), Date.now());
    run('delete from flows where created < ?', Date.now() - 20 * 60000);
    return { poll: { token: poll, endpoint: publicUrl + '/login/v2/poll' }, login: publicUrl + '/login/v2/flow/' + token };
  }
  const flow = (token) => one('select * from flows where token = ? and created > ?', token, Date.now() - 20 * 60000);
  function flowGrant(token, userId) {
    const f = flow(token); if (!f || f.user) fail(410, 'This sign-in request expired. Start again from the app.');
    run('update flows set user = ?, password = ? where token = ?', userId, newAppPassword(userId, f.name), token);
  }
  function flowPoll(pollToken) {
    const f = one('select * from flows where poll = ? and created > ?', pollToken, Date.now() - 20 * 60000);
    if (!f || !f.password) return null;
    run('delete from flows where token = ?', f.token); // the key is handed out exactly once
    return { server: publicUrl, loginName: f.user, appPassword: f.password };
  }

  return { startLogin, finishLogin, session, endSession, basic, newAppPassword, devices, forgetDevice, flowStart, flow, flowGrant, flowPoll, unseal, seal };
}

/** Social, server to server: contacts from your Social friends, profiles, and share records written to the PDS. */
export function createSocialLink({ url, secret, fetchImpl = fetch }) {
  if (!url || !secret) return null;
  async function call(method, path, body) {
    const r = await fetchImpl(url.replace(/\/+$/, '') + '/api/service/' + path, { method, headers: { 'x-cs-service': secret, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Social did not answer'); e.status = r.status; throw e; }
    return j;
  }
  return {
    contacts: (name) => call('GET', 'contacts?name=' + encodeURIComponent(name)).then((j) => j.contacts),
    person: (name) => call('GET', 'person?name=' + encodeURIComponent(name)).then((j) => j.person),
    recordShare: (body) => call('POST', 'cloud-share', body),
    removeShare: (body) => call('POST', 'cloud-unshare', body),
  };
}
