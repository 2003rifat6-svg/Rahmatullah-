# AI Movie Maker Studio

Mobile-first AI film production studio. Story → Characters (Face / Front / Side / Back references) → Image Prompts → Video Prompts → Production Settings → **Step 1 images** → **Step 2 image-to-video** → ZIP export → FFmpeg movie. Optional **Cloud Sync** (Firestore + Cloud Storage) with **Sign in with Google**.

> সহজ বাংলা Deploy নির্দেশনা নিচে আছে ("Cloud Run-এ Deploy — ধাপে ধাপে")।

## Run locally

Node.js 22+ (and `ffmpeg` for movie assembly).

```bash
npm install
cp .env.example .env          # optional: GEMINI_API_KEY for real AI generation
npm start                     # builds and serves app + API on http://localhost:8787
```

Dev mode with hot reload: `npm run server` (API :8787) + `npm run dev` (app :3000, proxies the API).
In the app: **Cloud ☁ → "Use this app's own server" → Test Backend Connection**.

Without sign-in configured, everything works locally (saved in the browser's IndexedDB); Cloud Sync stays off.

## Cloud Run-এ Deploy — ধাপে ধাপে (সহজ নির্দেশনা)

> ⚠️ **খরচ:** Cloud Run, Firestore, Cloud Storage, Cloud Build, Artifact Registry ও Secret Manager — সবগুলোর free tier আছে, কিন্তু Google Cloud Project-এ **Billing Account চালু থাকতেই হবে**। Gemini/Veo (ছবি/ভিডিও) আলাদা Paid API। নিচের ধাপগুলো আপনি নিজে চালাবেন; এই কোড নিজে থেকে কিছু Deploy বা চালু করে না।

1. **Google Cloud Project** তৈরি করুন: <https://console.cloud.google.com> → নতুন Project → Billing যুক্ত করুন।
2. **gcloud** ইনস্টল করে লগইন: `gcloud auth login`
3. **OAuth Client ID** (Sign in with Google-এর জন্য, ফ্রি): Console → *APIs & Services* → *OAuth consent screen* (External, নিজের ইমেইল) → *Credentials* → *Create credentials* → *OAuth client ID* → **Web application** → Client ID কপি করুন।
4. **Gemini API Key** (ঐচ্ছিক, Paid): <https://aistudio.google.com/apikey>
5. প্রজেক্ট ফোল্ডারে চালান (স্ক্রিপ্ট সব দেখিয়ে `YES` চাইবে, তারপর Key চাইবে):

   ```bash
   PROJECT_ID=your-project-id \
   REGION=asia-south1 \
   OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com \
   ALLOWED_EMAILS=you@gmail.com \
   bash deploy/deploy-cloudrun.sh
   ```

   স্ক্রিপ্ট যা করে: API চালু → Firestore (Native) → Private GCS Bucket → কম-অনুমতির Service Account → Secret Manager-এ `SESSION_SECRET` ও `GEMINI_API_KEY` → Dockerfile দিয়ে Build ও Deploy → Bucket CORS।
6. শেষে যে URL দেখাবে সেটি OAuth Client-এর **Authorized JavaScript origins**-এ যোগ করুন (ধাপ ৩-এর পেজে)।
7. URL খুলুন → Cloud ☁ → "Use this app's own server" → Test → **Sign in with Google** → "Save to Cloud"।

Firestore-এ ব্রাউজার থেকে সরাসরি প্রবেশ বন্ধ রাখতে (ঐচ্ছিক, প্রস্তাবিত): `deploy/firestore.rules` ফাইলটি Console → Firestore → Rules-এ বসান।

### Google Cloud IAM permissions

The Cloud Run service runs as its own service account (`movie-studio-run@PROJECT.iam.gserviceaccount.com`):

| Role | Where | Why |
|---|---|---|
| `roles/datastore.user` | project | read/write Firestore project documents |
| `roles/storage.objectAdmin` | the media bucket only | upload / read / delete images, videos, ZIPs, movies |
| `roles/secretmanager.secretAccessor` | secrets `SESSION_SECRET`, `GEMINI_API_KEY` | read secrets at start-up |
| `roles/iam.serviceAccountTokenCreator` | on the service account itself | only if `GCS_SIGNED_URLS=true` (sign V4 URLs for big files) |

The person running the deploy script needs (or Owner): `roles/run.admin`, `roles/iam.serviceAccountAdmin`, `roles/iam.serviceAccountUser`, `roles/resourcemanager.projectIamAdmin`, `roles/serviceusage.serviceUsageAdmin`, `roles/datastore.owner`, `roles/storage.admin`, `roles/secretmanager.admin`, `roles/cloudbuild.builds.editor`, `roles/artifactregistry.admin`.

APIs enabled by the script: `run`, `cloudbuild`, `artifactregistry`, `firestore`, `storage`, `secretmanager`, `iamcredentials`.

### Environment variables

| Variable | Required on Cloud Run | Meaning |
|---|---|---|
| `GCS_BUCKET` | **yes** | Cloud Storage bucket for all media (server refuses to start without it on Cloud Run) |
| `GOOGLE_OAUTH_CLIENT_ID` | **yes** | OAuth Web client ID for Sign in with Google |
| `SESSION_SECRET` (secret) | **yes** | ≥ 32 random chars, signs the HttpOnly login cookie |
| `FIRESTORE_ENABLED` | yes for Cloud Sync | `true` turns on Firestore project sync |
| `GOOGLE_CLOUD_PROJECT` | recommended | GCP project id |
| `ALLOWED_EMAILS` | recommended | comma list of Google accounts allowed to sign in |
| `GEMINI_API_KEY` (secret) | no | empty = AI generation disabled (paid API) |
| `GCS_SIGNED_URLS` | no | `true` = big uploads/downloads go directly to GCS |
| `FIRESTORE_DATABASE_ID` | no | non-default Firestore database |
| `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` / `GEMINI_VIDEO_MODEL` | no | model overrides |
| `PORT` | set by Cloud Run | listen port |
| `MEDIA_DIR`, `STUDIO_ACCESS_TOKEN`, `CORS_ORIGIN`, `FFMPEG_PATH` | no | local development / special setups |

## Security model

- **Sign in with Google** → the server verifies the Google ID token (`google-auth-library`) and sets an **HttpOnly, Secure, SameSite=Lax** signed session cookie (7 days). State-changing requests also need an `X-Requested-With` header (CSRF guard).
- The user id is the Google account's `sub`, taken **only** from the verified token. All data lives under `users/<uid>/…` in Firestore and in GCS; every request checks that prefix. Other users get 404 for your projects and files.
- Firestore rules deny all browser access; only the server's service account can read/write. The bucket has public access prevention.
- Gemini key and session secret are in Secret Manager, never in the frontend.
- On Cloud Run nothing important is written to the container disk: generated videos and assembled movies go to GCS; FFmpeg's temporary work folder is deleted after every export.

## Local save vs Cloud Sync

- The browser (IndexedDB, with localStorage backup) is always the main save — exactly as before, also offline and without sign-in.
- Cloud Sync is **manual and optional**: Cloud ☁ → *Save to Cloud* / *Load* / *Delete from cloud*. Nothing syncs automatically.
- Each cloud save increments a **revision**. If another device saved a newer copy, you get a warning and choose: keep the cloud copy (Load it) or overwrite.
- When a project is saved to the cloud, its images (data URLs) are moved to Cloud Storage and replaced by `/api/media/...` links (Firestore documents are limited to 1 MiB; bodies over 800 KB are stored in GCS automatically).
- Deleting a project locally does not delete the cloud copy, and *Delete from cloud* keeps the local copy.

## Where things live

| Part | Files |
|---|---|
| Main Chat (control centre) | `src/components/MainWorkspaceScreen.tsx` |
| Project Materials Hub (8 sections + **Send All Materials to Main Chat**) | `src/components/MaterialsHubScreen.tsx`, `src/utils/sections.ts` |
| 1 Story, 4 Image Prompts, 5 Video Prompts | `src/components/SimpleTextModuleScreen.tsx` |
| 2 Character Information (unlimited characters) | `src/components/CharacterInfoScreen.tsx` |
| 3 Character Reference Images (4 slots each) | `src/components/CharacterReferencesScreen.tsx` |
| 6 Production Settings | `src/components/ProductionSettingsModal.tsx` (page variant) |
| 7 Generated Images, 8 Generated Videos & Export | `src/components/ShotOutputsScreen.tsx`, `src/services/productionRunner.ts` |
| Shared Save / Lock / Unlock / Back bar | `src/components/SectionControls.tsx` |
| Validation, Scene/Shot parsing, bundle rules | `src/utils/validation.ts`, `src/services/studioBackend.ts` |
| Backend API routes, auth checks | `server/app.ts` |
| Sign in with Google, session cookie, CSRF | `server/auth.ts` |
| Firestore project store | `server/projectStore.ts` |
| Cloud Storage / local-dev file store | `server/blobStore.ts` |
| Env → config (fails closed on Cloud Run) | `server/config.ts`, `server/index.ts` |
| Gemini / Veo provider | `server/provider.ts` |
| Cloud Sync UI + client | `src/components/CloudSyncPanel.tsx`, `src/services/cloudSync.ts` |
| Deploy | `Dockerfile`, `deploy/deploy-cloudrun.sh`, `deploy/cors.json`, `deploy/firestore.rules` |

## Rules the app follows

- Every section opens **UNLOCKED**. **Save** stores data and never locks. **Lock / Unlock** are separate buttons; Lock needs a clean Save first. Unlock re-enables every text field, upload and AI button.
- **Back** always returns to Project Materials (asks first if there are unsaved edits). Nothing is ever sent to Main Chat from a section.
- A new character is only a draft until its **Save Character** is pressed. A character is *complete* when its information is saved **and** a Face image is saved. Incomplete characters never go to Main Chat or to generation.
- Only the **Send All Materials to Main Chat** button sends materials — as one organised bundle of *saved* content.
- Image generation (Step 1) and video generation (Step 2) are separate. Each video uses the image of its Scene/Shot as its first frame. Re-saving prompts keeps existing outputs (matched by Scene/Shot ID).
- No fake AI output or fake progress: without a backend + key, generate buttons explain why they are disabled, and you can upload your own files (marked "Uploaded").
- The API key exists only on the server. Every paid generation asks for confirmation and shows the number of requests.

## Backend API

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/health` | – | status: Gemini, FFmpeg, auth mode, Cloud Sync, storage |
| POST | `/api/auth/session` | – | `{ credential }` Google ID token → session cookie |
| GET | `/api/auth/me` · POST `/api/auth/logout` | cookie | current user · sign out |
| GET | `/api/projects` | user | list my cloud projects (Firestore) |
| POST | `/api/projects` | user | create `{ project }` (409 if it exists) |
| GET | `/api/projects/:id` | user | load |
| PUT | `/api/projects/:id` | user | update `{ project, baseRevision, force? }` → 409 on conflict |
| DELETE | `/api/projects/:id` | user | delete document + all its GCS files |
| GET | `/api/storage/files?projectId=` | user | list files of a project |
| POST | `/api/storage/upload-url` | user | prepare upload → signed GCS URL or `/api/storage/upload/<key>` |
| PUT | `/api/storage/upload/<key>` | owner | upload through the server (≤ 30 MB) |
| GET | `/api/media/<key>` | owner | download / stream (Range), or redirect to a 15-min signed URL |
| DELETE | `/api/storage/files/<key>` | owner | delete a file |
| POST | `/api/chat`, `/api/generate-character-ref`, `/api/generate/shot-image`, `/api/generate/shot-video` | user | AI (Gemini / Veo), 503 without key |
| GET | `/api/generate/video-status/:id` | job owner | real Veo job status; result saved to GCS |
| POST | `/api/export/mp4` | owner of all clips | FFmpeg join → saved to GCS |

## Tests

```bash
npm run lint                 # TypeScript (app + strict server)
npm test                     # unit tests: auth, config fail-closed, keys, validation, AI stub, FFmpeg
npm run emulators:setup      # one time: Firestore emulator + fake-gcs-server
npm run test:integration     # real Firestore + GCS client libraries against the emulators
npm run build && npm run test:e2e && npm run test:e2e:cloud   # phone-size browser tests
```

Stub AI provider and test sign-in verifier live only in `test/`; the real server never uses them.

## Known limits

- Not tested against a real Google Cloud project or real Gemini/Veo (no project, billing or API key was used). Firestore and GCS were tested with the official Firestore emulator and fake-gcs-server through the real Google client libraries.
- The Docker image was not built here (no Docker daemon); its build steps (`npm run build`, `node dist-server/index.mjs`) were run directly.
- Veo video jobs are tracked in server memory, so the deploy uses `--max-instances 1 --session-affinity`. If the instance restarts during a job, that shot shows an error and can be generated again.
- Uploads through the server are limited to 30 MB (Cloud Run's 32 MB request limit); with `GCS_SIGNED_URLS=true` the browser uploads directly to GCS.
- Veo accepts only 16:9 and 9:16 for video.

## বাংলা সারাংশ

- **চালানো:** `npm install` → `.env`-এ `GEMINI_API_KEY` (শুধু আসল AI চাইলে) → `npm start` → অ্যাপে Cloud → "Use this app's own server" → Test।
- প্রতিটি Section প্রথমবার **Unlocked**। **Save** করলে Lock হয় না। Lock/Unlock আলাদা বোতাম। Unlock করলে সব লেখা, Upload, Generate আবার চালু হয়।
- **Back** সবসময় Project Materials-এ ফেরে; কোনো Section নিজে থেকে Main Chat-এ কিছু পাঠায় না।
- অসংখ্য Character; নতুন Character শুধু **Save Character** চাপলে Project-এ যায়। প্রতিটির Face, Front Body, Side Body, Back Body — Upload বা AI Generate।
- সব কাজ শেষে Project Materials-এ **Send All Materials to Main Chat** — শুধু Save করা উপকরণ একটি Bundle হিসেবে যায়, অসম্পূর্ণ Character যায় না।
- Step 1-এ ছবি, Step 2-এ সেই ছবি থেকে ভিডিও। ছবি ও ভিডিও আলাদাভাবে Download ও ZIP, আর FFmpeg দিয়ে পুরো Movie MP4।
- API Key শুধু Server-এ। প্রতিটি Paid Generation-এর আগে নিশ্চিত করতে বলে। Backend না থাকলে ভুয়া কিছু দেখায় না।
- **Cloud Sync (ঐচ্ছিক):** Sign in with Google → Firestore-এ Project, Cloud Storage-এ ছবি/ভিডিও/ZIP। প্রত্যেক ব্যবহারকারী শুধু নিজের ডেটা দেখে। Browser-এর Local Save আগের মতোই চলে; Cloud-এ কিছু নিজে থেকে যায় না।
