# চিত্রপট (Chitropot) — অ্যাপ প্রোফাইল / App Profile

> **বাংলা:** এই ফাইলটা অন্য কোডিং টুল বা রিভিউয়ারের জন্য। এখানে লেখা আছে অ্যাপটা কী করে, কোড কোথায় কী আছে, কীভাবে পরীক্ষা করতে হয়, আর কোন অংশগুলো এখনো আসল API-তে যাচাই হয়নি (সেগুলোতে ভুল থাকার সম্ভাবনা বেশি)।
>
> **For reviewers / coding assistants:** Please review this app for bugs, security problems and mismatches with the Gemini API. The sections "Not yet verified" and "Review checklist" point to the riskiest areas.

---

## 1. What it is
A Bengali-language, mobile-first web app (installable PWA) for making AI videos and images with **consistent characters**, inspired by the feature set of Google Flow (own design, own wording). It runs on the **Google Gemini API** with an AI Studio API key.

- Runtime: **Node.js ≥ 22.13**, **zero required npm dependencies** (`pg` optional, for PostgreSQL) (uses `node:http`, `node:sqlite`, `fetch`).
- Frontend: vanilla-JS single-page app (`public/app.js`, `app.css`), no build step.
- Storage: SQLite (one server) or PostgreSQL (many servers); media on local disk or S3-compatible storage.
- Auth: Google Sign-In (ID token verified via `oauth2.googleapis.com/tokeninfo`), HMAC-signed session cookie.

## 2. Files
| File | Lines | Purpose |
|---|---|---|
| `server.js` | ~250 | Bootstrap: config check, DB, storage, static files (gzip/ETag), security headers + CSP, `/healthz`, `/readyz`, `/media/:id`, body limits, graceful shutdown |
| `lib/app.js` | ~1020 | All `/api` routes, auth, authorisation, limits, enqueue, usage/admin/account/export |
| `lib/db.js` | ~230 | One async DB layer for SQLite (`node:sqlite`) and PostgreSQL (`pg`): schema, migrations, leased job claim, rate-limit counters, locks, settings |
| `lib/jobs.js` | ~175 | Job worker: claim, create, poll with heartbeat lease, cancel detection, crash recovery (`sweep`), graceful hand-off |
| `lib/gemini.js` | ~145 | Gemini client: retries, free-tier detection, text fallbacks, SSRF-safe media download |
| `lib/storage.js`, `lib/sigv4.js` | ~175 | Local disk or S3-compatible storage (own AWS SigV4 signing, presigned 302 for media) |
| `lib/assets.js`, `lib/zip.js`, `lib/config.js` | ~245 | File save/purge + magic-byte check, streaming ZIP export, all settings |
| `public/index.html`, `app.js`, `app.css` | ~1660 | Whole UI (vanilla JS, no build step) |
| `public/login.*`, `sw.js`, `manifest.webmanifest`, `offline.*`, icons | | Sign-in, PWA install, offline page |
| `test/*.js` | ~1500 | See §3 |
| `ARCHITECTURE.md` | | Architecture, measured results, scaling path (Bengali) |
| `Dockerfile`, `../.github/workflows/chitropot.yml` | | Container; CI (SQLite + PostgreSQL tests) then `railway up` |

## 3. How to run and test
```bash
cd chitropot && npm ci
npm run test:unit        # SigV4 against AWS's published vectors, DB layer
npm test                 # 22 API end-to-end groups, mock Gemini
npm run test:advanced    # 20 security/concurrency/failure checks (+5 multi-instance checks on PostgreSQL)
TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:all   # same on PostgreSQL
npm i --no-save s3rver && npm run test:s3     # S3 mode
npm run test:ui          # Playwright, 6 widths 360–1440, overflow + touch-target checks
GEMINI_API_KEY=... npm run test:real          # REAL API: text, TTS, image (REAL_VIDEO=1 adds a paid 4 s video)
```
Everything except `test:real` uses a **mock** Gemini server (`test/mock-gemini.js`).

## 4. Gemini API usage (the part most likely to break)
Base: `https://generativelanguage.googleapis.com/v1beta`, header `x-goog-api-key`.

| Feature | Endpoint | Model (env) | Request shape used |
|---|---|---|---|
| Video | `POST /interactions` (with `background: true`), then poll `GET /interactions/{id}` | `gemini-omni-1.2-flash` (`VIDEO_MODEL`) | `input`: string, or array of `{type:'image', data, mime_type}` + `{type:'text', text}`; `response_format: {type:'video', aspect_ratio, resolution, duration:'8s'}`; `previous_interaction_id` for extend/edit; `store: true` |
| Image | `POST /interactions` (sync) | `gemini-nano-banana-2.1` (`IMAGE_MODEL`, choices `IMAGE_MODELS`) | same input shape; `response_format: {type:'image', aspect_ratio, image_size:'1K'|'2K'|'4K'}` |
| Voice sample | `POST /interactions` | `gemini-3.8-flash-tts` (`TTS_MODEL`) | `input:[{type:'user_input', content:[{type:'text', text, annotations:[{type:'speech_metadata', style}]}]}]`, `response_format:{type:'audio'}`, `generation_config.speech_config:[{voice}]`; result is WAV, cached on disk per voice |
| Text (prompt enhance, titles, story, assistant chat) | `POST /models/{m}:generateContent` | `gemini-3.8-flash` → fallbacks `gemini-3.6-flash`, `gemini-3.5-flash-lite` (`TEXT_MODEL`, `TEXT_MODEL_FALLBACKS`) | classic `contents` / `systemInstruction` / `generationConfig` (+ `responseSchema` for episodes) |

Result parsing: media is taken from `steps[].type=='model_output' → content[]` blocks with `type` `video`/`image`/`audio`, either inline `data` (base64) or a `uri` (downloaded with the API key). Errors: 429/500/503 are retried with backoff; 429 with "Free Tier"/"limit: 0" is reported (in Bengali) as "enable billing" and not retried.

### Verified against the real API (2026-11-21, free-tier key, `npm run test:real`)
- Model list contains all models above. `gemini-2.5-flash` returns 404 for new users (that is why the default changed).
- Text: `gemini-3.8-flash` returned 503 (overloaded); `gemini-3.6-flash` answered in ~36 s; `gemini-3.5-flash-lite` in <1 s. The fallback chain worked.
- Voice sample (TTS): worked, returned a real WAV (~155 KB).
- Image: request reached Google, but the key is on the **free tier** ("limit: 0"), so no image was produced. The app shows a clear "enable billing" message.

### Not yet verified against the real API (highest bug risk)
1. **Video generation end-to-end** (Omni Flash): `background: true` create → poll → parse `steps` → download. Shapes follow the official docs, but no real video has been generated yet.
2. **Image generation** output parsing on a billed key.
3. Video **extend / edit** via `previous_interaction_id`, and **reference images** (6 max for video).
4. Large outputs returned as `uri` instead of inline `data` (`mediaBytes()`).
5. Whether `GET /interactions/{id}` status values are exactly `completed` / `failed` / ... (see `FAILED` set and `isFinished()`).

## 5. Data model (SQLite or PostgreSQL, same schema)
`users` (`sv` = session version for "log out everywhere"), `allowed`, `settings`, `folders`, `projects` (`clips`, `story` JSON), `characters`, `assets` (`character_id`, `parent_id`, `interaction_id`, `deleted_at`, `size`), `jobs` (`status`, `worker`, `lease_until`, `attempts`, `started`, `finished`, `cost_usd`), `collections`, `collection_items`, `chat`, `activity` (audit log), `rate_limits`, `locks`.
Columns added later are migrated automatically on start.

## 6. REST API (all under `/api`, JSON; non-GET requests must send header `x-cp: 1`)
Auth: `GET config`, `POST login`, `POST logout`, `GET me`, `GET usage`, `POST account/logout-all`, `POST account/delete {confirm: email}`.
Owner only: `GET/POST admin/allowed`, `DELETE admin/allowed/:email`, `GET admin/overview`.
Library: `GET library`, `POST/PATCH/DELETE folders[/:id]`, `POST projects`, `GET/PATCH/DELETE projects/:id`, `GET projects/:id/assets?before=&beforeId=` (pagination), `GET projects/:id/export` (ZIP).
Characters: `POST projects/:id/characters`, `PATCH/DELETE characters/:id`, `POST characters/:id/generate`, `DELETE characters/:id/images/:assetId`, `POST projects/:id/avatar`.
Voices: `GET voices`, `GET voices/:name/preview` (WAV).
Media: `POST projects/:id/upload`, `POST projects/:id/generate`, `POST assets/:id/remix`, `PATCH/DELETE assets/:id`, `POST assets/:id/restore`, `POST assets/:id/to-character`, `GET/DELETE projects/:id/trash`.
Jobs: `POST jobs/:id/cancel`, `POST jobs/:id/retry`, `POST jobs/:id/dismiss`.
Organise: `POST projects/:id/collections`, `PATCH/DELETE collections/:id`, `POST collections/:id/items`, `PUT projects/:id/clips`.
Writing: `POST enhance`, `PUT projects/:id/story`, `POST/DELETE projects/:id/story/episodes[/:eid]`, `GET/POST/DELETE projects/:id/chat`.
Files: `GET /media/:assetId` (session-checked; local: `Range`; S3: 302 to a short-lived presigned URL).

## 7. Security model (please check)
- Every query is scoped to the session user (`ownProject`, `ownAsset`, ...). Other users' ids return 404.
- Sign-in only for `OWNER_EMAIL`, `allowed` emails, or everyone with `OPEN_SIGNUP=1`. `DEV_LOGIN=1` refuses to start in production.
- Session: HMAC cookie `uid.sv.exp.sig`, `HttpOnly; SameSite=Lax` (+`Secure` on https). Bumping `sv` revokes all sessions.
- CSRF: `x-cp: 1` header on non-GET. XSS: CSP (`script-src 'self' accounts.google.com`), no inline scripts, `esc()` on all user text.
- Uploads: PNG/JPEG/WEBP verified by magic bytes; body limit 1 MB (12 MB on upload routes); oversize bodies get 413.
- SSRF: the API key is only sent to the `GEMINI_API_BASE` host; redirects are followed without the key.
- Limits (stored in the DB, so they hold across instances): login per IP, generations and text calls per minute, daily video/image limits (atomic via advisory lock on PostgreSQL), running jobs per user, storage quota.

## 8. Known limitations
- Video generation has **never been run against the real API** (free-tier key). See "Not yet verified".
- Cancelling a job that was already sent to Google may still be billed by Google.
- In S3 mode, image crop reads the image in the browser, so the bucket needs CORS for the app origin.
- The Docker container runs as root (Railway volumes are root-owned).
- Load tests ran on one 4-CPU machine with a mock Gemini. This is **not** evidence of million-user scale (see ARCHITECTURE.md).
- Omni Flash has no "voice" parameter; the chosen voice is described in the prompt text.
- Timeline does not merge clips into one file. Cost figures are estimates.

## 9. Review checklist (suggested)
- [ ] Compare §4 request/response shapes with the current Gemini API docs.
- [ ] `lib/jobs.js`: lease, heartbeat, cancel, `sweep()` recovery, `stop()` hand-off.
- [ ] Authorisation on every route in `lib/app.js`.
- [ ] `public/app.js`: every user string goes through `esc()` before `innerHTML`.
- [ ] Behaviour when Gemini returns 429 / 503 / blocked content.
