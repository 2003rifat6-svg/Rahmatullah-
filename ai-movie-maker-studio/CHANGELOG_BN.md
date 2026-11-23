# পরিবর্তনের তালিকা (Changelog)

## সংস্করণ ৪.০ — Critical Bug Fix ও উন্নয়ন

### ঠিক করা ত্রুটি (Bug Fix)
- **Version History:** আগে সর্বোচ্চ ৮টি Version থাকত (`slice(-8)`), নবমটি এলে পুরোনো মুছে যেত। এখন সীমাহীন; কোনো Version নিজে থেকে মোছে না। Version-এর মেটাডেটা Project-এ, বড় ছবি/ভিডিও আলাদা IndexedDB স্টোরে। Reload-এর পরেও সব থাকে। ব্রাউজারের জায়গা ৮০% ভরলে সতর্কবার্তা।
- **Video Job:** আগে Server-এর মেমোরির `Map`-এ থাকত, Restart-এ হারাত। এখন Firestore-এ স্থায়ী (Job ID, Project, User, সময়, Status, Result, Error, Scene/Shot)। Restart-এর পর অন্য Instance থেকেও চালু থাকে।
- **Revision Conflict:** `baseRevision` বাদ দিলেও Update চলত। এখন বাধ্যতামূলক (না থাকলে 400)। Mismatch = 409; Update কখনো নতুন Project তৈরি করে না; অন্ধ `force` Overwrite সরানো হয়েছে।
- **Save/Delete Race:** Delete দুই ধাপে (`deleting` চিহ্ন → ফাইল মোছা → Document মোছা); Delete চলাকালে Save প্রত্যাখ্যাত; মাঝপথে ব্যর্থ Delete নিজে থেকে বা আবার Delete চাপলে শেষ হয়; পুনরুদ্ধার কখনো নতুন তৈরি Project-কে ছোঁয় না; এতিম (Orphan) ফাইল পরিষ্কার।
- **Deployment Guard:** `ALLOWED_EMAILS`-এ শুধু কমা/স্পেস বা ভুল ইমেইল থাকলে এখন Backend ও Deploy-স্ক্রিপ্ট দুটোই একই নিয়মে থামে (`server/shared/config-rules.mjs`)। প্রথম `gcloud` কমান্ডের আগে সব যাচাই।
- **CSP-র ভুল (পরীক্ষায় ধরা পড়ে):** `connect-src`-এ `blob:`/`data:` না থাকায় Reload-এর পর সংরক্ষিত ছবির Upload/Download আটকাত। ঠিক করা হয়েছে; E2E এখন CSP-লঙ্ঘনে ব্যর্থ হয়।

### নতুন সুবিধা
- **স্থায়ী Rate Limit ও Quota (Firestore):** প্রতি ব্যবহারকারী/প্রতি Project, Chat/Image/Video/Story আলাদা, মিনিট ও দিন; সীমা পেরোলে 429 + `Retry-After` + দুই ভাষার বার্তা; Restart-এ হারায় না; বাতিল ও Duplicate অনুরোধে Quota খরচ হয় না।
- **Security:** Security Header ও কড়া CSP, নির্দিষ্ট Origin-এর CORS, Origin যাচাই (CSRF), Production-এ সবসময় `Secure` Cookie, Secret লুকানো Log, Upload-এর ধরন/আকার/ফাইল-স্বাক্ষর যাচাই, সব Prompt/Metadata যাচাই, Dev-সার্ভার শুধু `127.0.0.1`-এ।
- **Idempotency ও Job নিয়ন্ত্রণ:** একই Key বা সক্রিয় Shot-এ দ্বিতীয় Paid Job শুরু হয় না; Retry (এক চাপে সব ব্যর্থ Shot), বাতিল, সার্ভারে শেষ হওয়া ভিডিও পুনরুদ্ধার।
- **AI Story Analysis (খসড়া):** গল্প → চরিত্র → Scene → Shot → Image/Video Prompt; JSON যাচাই ও মেরামত; Scene/Shot ID, চরিত্রের ধারাবাহিকতা ও Image↔Video Mapping কোডে নিশ্চিত; খসড়া সম্পাদনাযোগ্য, শুধু Save চাপলে Materials হয়, Production নিজে থেকে শুরু হয় না।
- **PWA:** Manifest, আইকন, Service Worker, Offline-এ অ্যাপ খোলা, Offline পেজ; কোনো ব্যক্তিগত ডেটা Cache হয় না। Safe-area ও iPhone Share fallback।
- Cloud Save-এ ছবি/ভিডিও আলাদা আপলোড (Version সীমাহীন হওয়ায় ৩০ MB অনুরোধ-সীমা এড়াতে)।
- Queue Adapter ইন্টারফেস (`server/queue.ts`), Deploy-এ `MAX_INSTANCES` ও Firestore TTL ধাপ।
- `npm run verify`: সব যাচাই চালিয়ে PASS/FAIL/SKIPPED দেখায়। Playwright এখন `package.json`-এ।

## সংস্করণ ৩.২ — Final Release

- Deploy স্ক্রিপ্ট: `ALLOWED_EMAILS` ফাঁকা বা না দিলে এখন পরিষ্কার বার্তা দিয়ে থামে (আগে `unbound variable` Error আসত; তখনও কিছু তৈরি হতো না)।

## সংস্করণ ৩.১ — Deploy-এর আগের সংশোধন

- **বড় Project-এর Conflict-এ ক্ষতি বন্ধ:** আগে বড় Project সবসময় একই `project.json` ফাইলে লেখা হতো, Revision যাচাইয়ের আগেই। এখন প্রতি Save-এর জন্য নতুন ফাইল (`_body/<uuid>.json`) হয়; Firestore Commit সফল হলেই পুরোনোটা মোছে। Commit ব্যর্থ বা Conflict হলে নতুন ফাইলটিও মুছে যায়, পুরোনো কপি অক্ষত থাকে।
- **Data Integrity:** প্রতিটি বড় Project-এর SHA-256 রাখা হয়; মেলে না এমন ডেটা লোড হয় না, পরিষ্কার Error দেয়।
- **ALLOWED_EMAILS বাধ্যতামূলক:** Sign-in চালু থাকলে ফাঁকা হলে Server চালু হয় না। Deploy স্ক্রিপ্টও ফাঁকা থাকলে শুরুতেই থেমে যায়। তালিকা থেকে সরালে সেই ইমেইলের চলমান Session-ও সাথে সাথে বন্ধ হয়।
- **নতুন Integration Test:** বড় Project-এর Conflict, ব্যর্থ Commit, Checksum ভাঙা, দুই ব্যবহারকারীর নিরাপত্তা, ALLOWED_EMAILS বাদ দিলে Session বন্ধ — আসল Firestore ও GCS Emulator-এ (৯টি)।

## সংস্করণ ৩ — Google Cloud

- **Sign in with Google:** Server Google ID Token যাচাই করে HttpOnly Cookie দেয়; CSRF সুরক্ষা; `ALLOWED_EMAILS` দিয়ে নির্দিষ্ট ইমেইল।
- **Firestore:** Project Create / List / Load / Update / Delete (`users/<uid>/projects/<id>`), Revision দিয়ে Conflict ধরা (409), বড় Project GCS-এ।
- **Cloud Storage:** ছবি, ভিডিও, ZIP, Movie Upload / List / Download (Range) / Delete; Signed URL দিয়ে বড় ফাইল সরাসরি GCS-এ।
- Project Cloud-এ Save করলে ভেতরের ছবি GCS-এ সরে যায় (Firestore-এর 1 MiB সীমা)।
- তৈরি ভিডিও ও Movie এখন GCS-এ; Cloud Run-এর Disk-এ কিছু রাখা হয় না, FFmpeg-এর অস্থায়ী ফাইল সঙ্গে সঙ্গে মোছে।
- Cloud Run-এ Bucket বা Sign-in ছাড়া Server চালু হয় না (Fail-closed)।
- Local (IndexedDB) Save আগের মতো; Cloud Sync আলাদা, হাতে চাপলে তবেই।
- Dockerfile, Deploy স্ক্রিপ্ট, Firestore Rules, Bucket CORS, IAM ও Env তালিকা।
- Test: Unit, আসল Firestore Emulator + fake-gcs-server-এ Integration, আর দুই ডিভাইস/দুই ব্যবহারকারীর Browser E2E।

## সংস্করণ ২

## সমাধান করা সমস্যা

- **Install/Build ভাঙা ছিল:** `esbuild@^0.25` Vite 8-এর সাথে মেলে না, তাই `npm install` ব্যর্থ হতো। `^0.28.0` করা হয়েছে; এখন install, typecheck, build সব চলে।
- **Character-এর Reference Save কাজ করত না:** নতুন (Save না করা) Character-এর ছবির Slot-এ Save চাপলে কিছুই হতো না, তাই Lock-ও হতো না। এখন Character Information আর Reference Images আলাদা Section; Reference শুধু Save করা Character-এর জন্য, আর প্রতিটি Slot-এর Save/Lock/Unlock বাস্তবে কাজ করে।
- **Prompt আবার Save করলে তৈরি হওয়া ছবি/ভিডিও মুছে যেত।** এখন Scene/Shot ID মিলিয়ে আগের Output থেকে যায়।
- **Lock করা Prompt Main Chat থেকে বদলানো যেত।** এখন Lock মানা হয়।
- **Hub-এ ৬টি Section ছিল।** এখন ৮টি: Story Master, Character Information, Character Reference Images, Image Prompts, Video Prompts, Production Settings, Generated Images, Generated Videos & Export।
- **Production Settings শুধু Popup ছিল।** এখন পূর্ণ Section, Back করলে Hub-এ ফেরে।
- **Outputs-এর বোতামে লেখা ছিল "Back to Chat"।** এখন সব Back Project Materials-এ ফেরে, আর Save না করা পরিবর্তন থাকলে আগে জিজ্ঞেস করে।
- **Job Queue-তে Pause/Resume/Retry বোতাম শুধু লেবেল বদলাত** (ভুয়া নিয়ন্ত্রণ)। সরিয়ে বাস্তব Request Log রাখা হয়েছে।
- **কোনো Backend ছিল না**, তাই সব AI বোতাম শুধু "not connected" দেখাত। এখন `server/`-এ আসল Backend আছে (Gemini ছবি ও Chat, Veo ভিডিও, FFmpeg)।

## নতুন

- Send All Materials to Main Chat: শুধু Save করা উপকরণ একটি গোছানো Bundle হিসেবে যায়; কী যাবে আর কী যাবে না তা আগে দেখা যায়।
- Step 1 (ছবি) আর Step 2 (ছবি থেকে ভিডিও) আলাদা; প্রতিটি Paid Request-এর আগে নিশ্চিত করতে বলে।
- প্রতিটি Shot-এ একাধিক Version (Quantity অনুযায়ী) রাখা ও বাছাই করা যায়; নিজের ছবি/ভিডিও Upload করা যায় ("Uploaded" চিহ্নসহ)।
- ছবি ও ভিডিওর আলাদা ZIP (manifest.json সহ), আলাদা Download, আর FFmpeg দিয়ে Movie MP4।
- Server-এ ঐচ্ছিক `STUDIO_ACCESS_TOKEN` সুরক্ষা।
- Test: unit + backend (`npm test`) এবং মোবাইল স্ক্রিনে browser E2E (`npm run test:e2e`)।
