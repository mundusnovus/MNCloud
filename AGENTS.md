# Christian Cloud and Christian Office: brief for the agent building them

Read this whole file before you start. It is the same in both repositories (ChristianCloud and ChristianOffice).

## Christian Systems in one paragraph

Christian Systems makes free, open-source software and hosts it free, from a Christian Unionist conviction that good
tools belong in every hand. Everything lives under https://github.com/christiansystems. It already has:
**ChristianSprite** (pixel art), **ChristianBox** (music, built on BeepBox), **Christian Systems Social** (on the AT
Protocol) and the website, all in **ChristianSystemsOrg**, deployed on Railway at christiansystems.org with
subdomains sprite., box., social. and pds. One **Christian Systems account** signs people in everywhere.

## What to build

1. **Christian Cloud** (this repo: ChristianCloud) at **cloud.christiansystems.org**: the file hub for every Christian
   Systems app, built on **Nextcloud** (https://github.com/nextcloud, server AGPL-3.0-or-later).
   - Every account gets **3 GB** automatically. The whole service is capped at **256 GB** for now (paid tiers later;
     build free only).
   - **Our own web interface** in Christian Systems style (files, folders, upload, sharing, trash, quota, search,
     opening documents in Office). Nextcloud's own pages stay only for admin work. Do not just restyle Nextcloud.
   - Sprite and Box can save to Cloud (automatically if the person turns that on). Office documents live in Cloud.
   - A **native desktop sync app** for Windows, macOS and Linux: a rebranded, improved fork of Nextcloud's desktop
     client (https://github.com/nextcloud/desktop, GPL-2.0-or-later, so it can use the Christian Systems License).
2. **Christian Office** (repo: ChristianOffice) at **office.christiansystems.org**: documents, spreadsheets,
   presentations and PDFs, built on **Euro-Office** (https://github.com/euro-office, AGPL-3.0; a fork of ONLYOFFICE).
   - A cloud editor (Euro-Office **DocumentServer**, image `ghcr.io/euro-office/documentserver`) working with Christian
     Cloud through Euro-Office's Nextcloud connector (`euro-office/eurooffice-nextcloud`).
   - A portal at office.christiansystems.org: new document, recent documents from Cloud, templates.
   - A **native desktop app** for Windows, macOS and Linux: a rebranded, improved build of Euro-Office's desktop
     editors (`euro-office/desktop-apps`, `DesktopEditors`, `desktop-sdk`, `core`).

The owner decided: **full native desktop apps** built by **GitHub Actions** in these two repositories, and **our own
Cloud web interface** on Nextcloud's engine.

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
  desktop apps and the Nextcloud and Euro-Office branding hooks. Make whatever further UI assets the interfaces need
  (empty states, file-type icons, loaders) in the same pixel style.
- The site's style to match: `ChristianSystemsOrg/site/css/site.css`, `site/social/social.css`.

## Accounts: one Christian Systems account

Accounts live in Social (`ChristianSystemsOrg/social/app.mjs`) on the PDS. Every christiansystems.org address
answers `/api/` (`/api/me`, `/api/login`, ...), and the sign-in cookie covers the whole domain.
**Add an OpenID Connect provider** to `ChristianSystemsOrg` (for example `social/oidc.mjs`, served at
`https://social.christiansystems.org/oauth/...` with discovery at `/.well-known/openid-configuration`): authorize
(send people to `/signin?return=...` if not signed in), token, userinfo, JWKS, RS256 keys kept in `DATA_DIR`,
first-party clients configured by environment. Then configure Nextcloud's **user_oidc** app so Cloud signs people
in with their Christian Systems account (user id = Social name), and so the desktop sync app's browser login works.
Add tests in `ChristianSystemsOrg/test/` (`node --test test/*.test.mjs`, Node 24, no packages).

## Christian Cloud: how it should fit together

- **Server image** (Dockerfile here): official `nextcloud` image, pinned. Postgres (Railway). Files in a **Railway
  storage bucket** as Nextcloud's S3 primary storage (the bucket plan allows up to 1 TB; we cap at 256 GB).
  Configure it all at start-up with the image's hook folders (`/docker-entrypoint-hooks.d/`): apps (user_oidc,
  the Euro-Office connector, our app), `default_quota` = 3 GB, theming (name, colours, logos, Chancel), trusted
  domains, pretty URLs, CORS for `*.christiansystems.org` on WebDAV and Login Flow v2 (Sprite and Box need it).
- **Our Nextcloud app** (`apps/christiancloud/`, PHP): Christian Systems defaults and the **256 GB cap**. One workable
  design: a background job that sums usage every few minutes and, at the cap, freezes every user's quota at what
  they use ("Cloud is full; uploads are paused"), restoring 3 GB when space frees. Prefer a real storage wrapper if
  you can make it reliable.
- **Our web app** (served at `/`; Nextcloud keeps `/index.php`, `/remote.php`, `/ocs`, `/apps`, `/core`,
  `/status.php`, `/.well-known`): talks to WebDAV and OCS with the Nextcloud session (same origin, CSRF token from
  `/index.php/csrftoken`). Opens documents in Office through the connector.
- **Desktop sync app** (`desktop/`): branding for `nextcloud/desktop` (its `NEXTCLOUD.cmake`/theme options: app
  name "Christian Cloud", executable, vendor, server URL `https://cloud.christiansystems.org`, colours, icons) plus
  `.github/workflows/` that build installers for Windows (MSI), macOS (DMG, Apple silicon and Intel) and Linux
  (AppImage) on GitHub's runners and attach them to a GitHub release.

## Christian Office: how it should fit together

- **Server image** (Dockerfile in ChristianOffice): `ghcr.io/euro-office/documentserver`, pinned, with our branding
  applied (title, loader, favicon, About, editor colours and fonts, Chancel for the interface, Christian Sans
  installed and set as the default for new documents), JWT secret from Railway, and our **portal** replacing the
  welcome page at `/`. The document server needs about 2 to 4 GB of memory.
- **Connector**: Euro-Office's Nextcloud app, installed in Cloud and pointed at `https://office.christiansystems.org`
  with the same JWT secret; branded through its settings and the `customization` options of the editor config.
- **Desktop app** (`desktop/`): branding and patches for Euro-Office's desktop editors, built for Windows, macOS
  and Linux by GitHub Actions (reuse Euro-Office's own build scripts and `release` automation where you can), able
  to connect to Christian Cloud.

## Sprite and Box

Add **Save to / Open from Christian Cloud** and an optional **autosave to Cloud**, through `cs-host.js` so both apps
get it: connect with Nextcloud **Login Flow v2** (app password kept on the device), then WebDAV into
`/ChristianSprite/` and `/ChristianBox/`. The desktop builds of Sprite and Box (`ChristianSystemsOrg/tools/package/`)
use the same code. Keep each app's tests green (`node --test src/test/*.test.js`).

## The website

Add Cloud and Office to christiansystems.org: navigation, home page, `/downloads/` (the downloads list is
`site/downloads/files/downloads.json`, made by `tools/package/package.py`; add the GitHub release downloads for the
new desktop apps), and the source page. Pages are generated by `tools/pages.py` and `tools/build.py`.

## Hosting (Railway)

Project **"Christian Systems"** (id `56ce7528-37c8-4d32-9708-98df2a03ca0e`), environment `production`. It already has
`web` (ChristianSystemsOrg) and `pds`. Add: `cloud` (this repo's Dockerfile), Postgres, a storage bucket, `office`
(ChristianOffice's Dockerfile). Custom domains `cloud.christiansystems.org` and `office.christiansystems.org`;
Railway gives a CNAME and a `_railway-verify` TXT record for each. Give the owner those records. The owner pushes
to GitHub; Railway deploys from it.

## Order of work, and what done means

1. Cloud and Office faces in `build_brand.py`; Christian Sans built and licensed. Done: icons at every size, fonts load.
2. OIDC provider in ChristianSystemsOrg with tests. Done: a test client completes the code flow.
3. Cloud server image boots locally (or on Railway) with Postgres and a bucket, OIDC sign-in, 3 GB quota, the cap job.
4. Our Cloud web app: browse, upload, download, rename, move, delete and restore, share links, quota bar, search.
5. Office server with branding and portal; documents open and save from Cloud; co-editing works.
6. Sprite and Box save to Cloud.
7. Desktop workflows produce installers for both apps on all three platforms.
8. Website, downloads, deployment, DNS records.

Report honestly what you verified and what you could not (for example, desktop builds you could not run).
