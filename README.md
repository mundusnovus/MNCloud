# MNCloud

The file hub for every Mundus Novus app, at **cloud.mundusnovus.org**.

- **3 GB free** for every Mundus Novus account. Sign in with the same account you use on Social.
- **Share with your friends on Social.** The people you follow and who follow you are your contacts. A share is
  kept on your Social account (your PDS) as an `org.mundusnovus.cloud.share` record, and the person gets a
  notice on Social. You can also make a link anyone can view.
- **Open documents in MNOffice** and write them together, live. Each save keeps the older version.
- **Trash and versions.** Deleted files wait 30 days; the last 10 versions of each file are kept.
- **Sprite and Box** save to Cloud, and the **desktop sync app** keeps a folder on your computer in step.

## How it works

One small Node 24 service with no outside packages (`src/`):

| File | What it does |
| --- | --- |
| `server.mjs` | Routes, sign-in pages, the web app's API, security headers |
| `store.mjs` | Files, folders, versions, trash, shares and space, in SQLite (`node:sqlite`) |
| `blobs.mjs` | File contents, in the S3-compatible storage bucket (or a folder for local runs) |
| `auth.mjs` | Sign-in with Social (OpenID Connect), sessions, device keys, contacts and share records |
| `dav.mjs` | WebDAV and chunked uploads, for the desktop app and other apps |
| `office.mjs` | Opening, co-editing and saving documents with MNOffice |

The web app is plain HTML, CSS and JavaScript in `public/`. It speaks the same protocols as Nextcloud
(Login Flow v2, WebDAV, OCS capabilities), so the desktop sync app, built from Nextcloud's desktop client
(`desktop/`), works with it. Nextcloud's design was our example; none of its server code is used.

## Run it

```bash
node src/server.mjs
```

Then open http://localhost:8090. Settings are in `.env.example`. Run the tests with:

```bash
node --test test/*.test.mjs
```

## License

Free and open source under the **Mundus Novus License 1.0** (GPL-3.0); see [LICENSE](LICENSE).
The desktop sync app is built from Nextcloud's desktop client (GPL-2.0-or-later). MNCloud is not
affiliated with Nextcloud.
