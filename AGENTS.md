# Christian Cloud and Christian Office: brief for the agent building them

Read this whole file before you start. It is the same in both repositories (ChristianCloud and ChristianOffice).

## Christian Systems in one paragraph

Christian Systems makes free, open-source software and hosts it free, from a Christian Unionist conviction that good
tools belong in every hand. Everything lives under https://github.com/christiansystems. It already has:
**ChristianSprite** (pixel art), **ChristianBox** (music, built on BeepBox), **Christian Systems Social** (on the AT
Protocol) and the website, all in **ChristianSystemsOrg**, deployed on Railway at christiansystems.org with
subdomains sprite., box., social. and pds. One **Christian Systems account** signs people in everywhere.

## What to build

1. **Christian Cloud** (repo: ChristianCloud) at **cloud.christiansystems.org**: the file hub for every Christian
   Systems app. **An original service** (Node 24, no packages), not Nextcloud: the owner did not want Nextcloud's
   interface, so Nextcloud is only the example of how to do the job. Cloud speaks Nextcloud's protocols (Login Flow
   v2, WebDAV, chunked uploads, OCS capabilities) so its desktop client and the app connectors work with it.
   - Every account gets **3 GB** automatically. The whole service is capped at **256 GB** for now (paid tiers later;
     build free only).
   - **The PDS is part of sharing.** Contacts are your friends on Social (mutual follows first). Every share with a
     person is written to the sharer's PDS as an `org.christiansystems.cloud.share` record through Social's service
     API, and the person gets a Social notice. Links anyone can view are also possible.
   - Sprite and Box can save to Cloud (automatically if the person turns that on). Office documents live in Cloud.
   - A **native desktop sync app** for Windows, macOS and Linux: a rebranded build of Nextcloud's desktop client
     (https://github.com/nextcloud/desktop, GPL-2.0-or-later, so it can use the Christian Systems License).
2. **Christian Office** (repo: ChristianOffice) at **office.christiansystems.org**: documents, spreadsheets,
   presentations and PDFs, built on **Euro-Office** (https://github.com/euro-office, AGPL-3.0; a fork of ONLYOFFICE).
   - A cloud editor (Euro-Office **DocumentServer**, image `ghcr.io/euro-office/documentserver`) that Christian Cloud
     opens directly (`src/office.mjs` in ChristianCloud).
   - A portal at office.christiansystems.org: new document, recent documents from Cloud, templates.
   - A **native desktop app** for Windows, macOS and Linux: a rebranded, improved build of Euro-Office's desktop
     editors (`euro-office/desktop-apps`, `DesktopEditors`, `desktop-sdk`, `core`).

The owner decided: **full native desktop apps** built by **GitHub Actions** in these two repositories, and **an original Cloud
service** with its own web interface (Nextcloud's design is only the example).

## Rules from the owner

- **Use only these two repositories** (ChristianCloud, ChristianOffice) plus ChristianSystemsOrg, ChristianSprite and
  ChristianBox where integration needs it. Do not fork upstream projects into new repositories: pin an upstream
  version (commit or image digest) in a lock file and keep our changes as patches, a theme, an app or build
  scripts, the way ChristianBox pins BeepBox (`ChristianBox/src/beepbox.lock.json`, `src/patches/`). If you truly
  need another repository, stop and ask the owner to create it.
- **Rebrand completely, as far as the licenses allow**: names, logos, icons, colours, fonts, About text. Keep every
  upstream copyright notice and license file. Nextcloud's and ONLYOFFICE's names and logos are trademarks: remove
  them from the interface, but credit the projects in About and NOTICE. Euro-Office removed ONLYOFFICE's
  "keep the logo" clause; its files carry only a copyright line, which must stay.
- **Improve, don't only rebrand.** The interfaces must match Christian Systems quality: calm, fast, accessible
  (keyboard, screen readers, reduced motion), light and dark, responsive down to phones.
- **Design philosophy:** show, don't tell (and never say so). Not loud, not cheesy, not corny. Always Christian,
  quietly. Plain, short sentences.
- **Fonts:** use **Chancel** (our pixel display face) throughout the apps. In Office, **Chancel is the default
  interface font**, and the **default writing font is "Christian Sans"**: a new, readable serif in the style of
  Times New Roman (the owner chose the name). Make it by renaming a metric-compatible open font such as
  **Liberation Serif** (SIL OFL 1.1: its Reserved Font Name "Liberation" must be dropped, so renaming is required
  and allowed); keep it under the OFL with a FONTLOG, and set it as the default font for new documents. Chancel's
  source and builder: `ChristianSystemsOrg/brand/font/` (`chancel-glyphs.json`, `build_font.py`).
- **Licenses:** our default is the **Christian Systems License 1.0** (`ChristianSystemsOrg/LICENSE`, the GPL-3.0
  text unchanged plus a nonbinding Christian Unionist statement). Work derived from AGPL code uses the
  **Christian Systems Affero License 1.0** (the `LICENSE` in these two repositories: AGPL-3.0 unchanged plus the same
  statement). Any other license that is not GPLv3-compatible gets its own Christian Systems edition in the same
  pattern. AGPL means a public, hosted, modified version must offer its source to users: link the exact source in
  every About box and footer.
- Never commit secrets. Railway holds them.

## The brand

- Tokens (colours, type steps, easing, light and dark): `ChristianSystemsOrg/brand/tokens.css`. Red `#e3261c`,
  gold `#f2b33d`, ink `#140708`, cream `#f6ebdd`.
- Shared app chrome: `ChristianSystemsOrg/brand/host/cs-app.css`; the app host layer (files, key dialog, offline):
  `brand/host/cs-host.js`. Sprite and Box use them; see `ChristianBox/src/app/index.html`.
- Logos and product icons are generated, not drawn by hand: `ChristianSystemsOrg/brand/build_brand.py` (the mark is a
  red chip with gold pins and a cream cross on a 64-pixel grid; each product has a face drawn on it in `FACES`).
  **Add `cloud` and `office` faces there** (never a thin ring that touches a star's points), regenerate, and use
  the outputs (`brand/logo/products/<name>/`: PNG sizes, SVG, .icns, .ico, maskable) everywhere, including the
  desktop apps and the Euro-Office branding. Make whatever further UI assets the interfaces need
  (empty states, file-type icons, loaders) in the same pixel style.
- The site's style to match: `ChristianSystemsOrg/site/css/site.css`, `site/social/social.css`.

## Accounts: one Christian Systems account

Accounts live in Social (`ChristianSystemsOrg/social/app.mjs`) on the PDS. Every christiansystems.org address
answers `/api/` (`/api/me`, `/api/login`, ...), and the sign-in cookie covers the whole domain.
**Add an OpenID Connect provider** to `ChristianSystemsOrg` (for example `social/oidc.mjs`, served at
`https://social.christiansystems.org/oauth/...` with discovery at `/.well-known/openid-configuration`): authorize
(send people to `/signin?return=...` if not signed in), token, userinfo, JWKS, RS256 keys kept in `DATA_DIR`,
first-party clients configured by environment. Cloud signs people in with it (user id = Social name), and so does the desktop sync app's browser login.
Add tests in `ChristianSystemsOrg/test/` (`node --test test/*.test.mjs`, Node 24, no packages).

## Christian Cloud: how it fits together

- **Server** (`src/`, Dockerfile here): `node:24-slim`. File contents in the **Railway storage bucket** (S3 API,
  prefix `cc/`); the file list, shares, versions and sessions in SQLite on the `/data` volume. Space is checked in
  the same transaction that records a file, so the 3 GB quota and the 256 GB cap always hold.
- **Sign-in**: OpenID Connect against Social (client `christian-cloud`). The user id is the Social name.
- **Social service API** (`ChristianSystemsOrg/social/app.mjs`, `/api/service/...`, header `x-cs-service` =
  `SERVICE_SECRET` on both services): person, contacts, cloud-share (writes the PDS record and the notice) and
  cloud-unshare.
- **Web app** (`public/`): files, folders, upload (drag and drop), rename, move, copy, trash, versions, search,
  recent, shared with you, share sheet with Social contacts, links, devices. Opens documents at `/edit/<id>`.
- **Office**: Cloud signs the editor config with `OFFICE_JWT_SECRET`; the document key is `<id>-<etag>`, so everyone
  on the same version edits together; saves come back through a signed callback and become a new version.
- **Desktop sync app** (`desktop/`): branding for `nextcloud/desktop` plus `.github/workflows/desktop.yml`.

## Christian Office: how it should fit together

- **Server image** (Dockerfile in ChristianOffice): `ghcr.io/euro-office/documentserver`, pinned, with our branding
  applied (title, loader, favicon, About, editor colours and fonts, Chancel for the interface, Christian Sans
  installed and set as the default for new documents), JWT secret from Railway, and our **portal** replacing the
  welcome page at `/`. The document server needs about 2 to 4 GB of memory.
- **Cloud** opens documents itself (`ChristianCloud/src/office.mjs`): it signs the editor config with the same JWT
  secret and receives saves through a signed callback. No connector app is needed.
- **Desktop app** (`desktop/`): branding and patches for Euro-Office's desktop editors, built for Windows, macOS
  and Linux by GitHub Actions (reuse Euro-Office's own build scripts and `release` automation where you can), able
  to connect to Christian Cloud.

## Sprite and Box

Add **Save to / Open from Christian Cloud** and an optional **autosave to Cloud**, through `cs-host.js` so both apps
get it: connect with **Login Flow v2** (Nextcloud's protocol, which Cloud speaks) (app password kept on the device), then WebDAV into
`/ChristianSprite/` and `/ChristianBox/`. The desktop builds of Sprite and Box (`ChristianSystemsOrg/tools/package/`)
use the same code. Keep each app's tests green (`node --test src/test/*.test.js`).

## The website

Add Cloud and Office to christiansystems.org: navigation, home page, `/downloads/` (the downloads list is
`site/downloads/files/downloads.json`, made by `tools/package/package.py`; add the GitHub release downloads for the
new desktop apps), and the source page. Pages are generated by `tools/pages.py` and `tools/build.py`.

## Hosting (Railway)

Project **"Christian Systems"** (id `56ce7528-37c8-4d32-9708-98df2a03ca0e`), environment `production`. It has `web`
(ChristianSystemsOrg), `pds`, `cloud` (ChristianCloud's Dockerfile, volume at `/data`), a storage bucket and
`office` (ChristianOffice's Dockerfile). Custom domains `cloud.christiansystems.org` and `office.christiansystems.org`;
Railway gives a CNAME and a `_railway-verify` TXT record for each. Give the owner those records. The owner pushes
to GitHub; Railway deploys from it.

## Order of work, and what done means

1. Cloud and Office faces in `build_brand.py`; Christian Sans built and licensed. Done: icons at every size, fonts load.
2. OIDC provider in ChristianSystemsOrg with tests. Done: a test client completes the code flow.
3. Cloud server boots locally (or on Railway) with a bucket, OIDC sign-in, 3 GB quota and the 256 GB cap.
4. Our Cloud web app: browse, upload, download, rename, move, delete and restore, share links, quota bar, search.
5. Office server with branding and portal; documents open and save from Cloud; co-editing works.
6. Sprite and Box save to Cloud.
7. Desktop workflows produce installers for both apps on all three platforms.
8. Website, downloads, deployment, DNS records.

Report honestly what you verified and what you could not (for example, desktop builds you could not run).
