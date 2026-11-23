# AI Movie Maker Studio

Mobile-first AI film production studio. Story → Characters (Face / Front / Side / Back reference images) → Image Prompts → Video Prompts → Production Settings → **Step 1: shot images** → **Step 2: image-to-video** → ZIP export → FFmpeg movie.

> বাংলা সারাংশ নিচে আছে।

## Run it

Requirements: Node.js 22+, and `ffmpeg` on the server if you want movie assembly.

```bash
npm install
cp .env.example .env          # put GEMINI_API_KEY in .env only if you want real AI generation
```

Development (two terminals):

```bash
npm run server                # backend on :8787 (keeps the API key)
npm run dev                   # app on :3000 (proxies /api, /health, /media to :8787)
```

Production (one process: builds the app and serves app + API):

```bash
npm start                     # http://localhost:8787
```

In the app: **Cloud ☁ → "Use this app's own server" → Test Backend Connection**.
`/health` reports whether `GEMINI_API_KEY` and FFmpeg are available.

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
| Backend API (Gemini, Veo, FFmpeg) | `server/app.ts`, `server/provider.ts`, `server/index.ts` |

## Rules the app follows

- Every section opens **UNLOCKED**. **Save** stores data and never locks. **Lock / Unlock** are separate buttons; Lock needs a clean Save first. Unlock re-enables every text field, upload and AI button.
- **Back** always returns to Project Materials (asks first if there are unsaved edits). Nothing is ever sent to Main Chat from a section.
- A new character is only a draft until its **Save Character** is pressed. A character is *complete* when its information is saved **and** a Face image is saved. Incomplete characters never go to Main Chat or to generation.
- Only the **Send All Materials to Main Chat** button sends materials — as one organised bundle of *saved* content.
- Image generation (Step 1) and video generation (Step 2) are separate. Each video uses the image of its Scene/Shot as its first frame. Re-saving prompts keeps existing outputs (matched by Scene/Shot ID).
- No fake AI output or fake progress: without a backend + key, generate buttons explain why they are disabled, and you can upload your own files (marked "Uploaded").
- The API key exists only on the server. Every paid generation asks for confirmation and shows the number of requests.

## Backend API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | status, `geminiConfigured`, `ffmpegAvailable` |
| POST | `/api/chat` | Main Chat reply (Gemini), with the last materials bundle as context |
| POST | `/api/generate-character-ref` | one reference image (Face/Front/Side/Back), reuses saved slots for identity |
| POST | `/api/generate/shot-image` | one shot image with the reference images of characters named in the prompt |
| POST | `/api/generate/shot-video` | starts a Veo image-to-video job → `{ jobId }` |
| GET | `/api/generate/video-status/:id` | real job status; when done the MP4 is saved under `/media/...` |
| POST | `/api/export/mp4` | FFmpeg joins server-stored clips in Scene/Shot order |
| any | `/api/projects*`, `/api/storage/upload` | **501 Not implemented** (projects are saved in the browser) |

Set `STUDIO_ACCESS_TOKEN` when the server is public, and enter it in Cloud Settings.

## Tests

```bash
npm run lint        # TypeScript: app + server (strict)
npm test            # unit + backend tests (stub AI provider, real FFmpeg)
npm run build && npm run test:e2e   # browser test on a phone-sized screen (needs Playwright + Chromium)
```

The stub AI provider lives only in `test/` and is never used by the real server.

## Known limits

- Real Gemini / Veo output was **not** tested here (no API key was used; they are paid). Model names can be changed with `GEMINI_*_MODEL`.
- Video jobs are tracked in server memory: if the server restarts during a job, that shot shows a clear error and can be generated again.
- Generated videos are stored on the server disk (`MEDIA_DIR`). On hosts with temporary disks (e.g. Cloud Run) download them or mount persistent storage.
- Cloud project sync (Firestore / GCS) is not implemented; projects are saved in the browser (IndexedDB). Use project ZIPs to move them.
- Veo accepts only 16:9 and 9:16 for video.

---

## বাংলা সারাংশ

- **চালানো:** `npm install` → `.env`-এ `GEMINI_API_KEY` (শুধু আসল AI চাইলে) → `npm start` → অ্যাপে Cloud → "Use this app's own server" → Test।
- প্রতিটি Section প্রথমবার **Unlocked**। **Save** করলে Lock হয় না। Lock/Unlock আলাদা বোতাম। Unlock করলে সব লেখা, Upload, Generate আবার চালু হয়।
- **Back** সবসময় Project Materials-এ ফেরে; কোনো Section নিজে থেকে Main Chat-এ কিছু পাঠায় না।
- অসংখ্য Character; নতুন Character শুধু **Save Character** চাপলে Project-এ যায়। প্রতিটির Face, Front Body, Side Body, Back Body — Upload বা AI Generate।
- সব কাজ শেষে Project Materials-এ **Send All Materials to Main Chat** — শুধু Save করা উপকরণ একটি Bundle হিসেবে যায়, অসম্পূর্ণ Character যায় না।
- Step 1-এ ছবি, Step 2-এ সেই ছবি থেকে ভিডিও। ছবি ও ভিডিও আলাদাভাবে Download ও ZIP, আর FFmpeg দিয়ে পুরো Movie MP4।
- API Key শুধু Server-এ। প্রতিটি Paid Generation-এর আগে নিশ্চিত করতে বলে। Backend না থাকলে ভুয়া কিছু দেখায় না।
