# নিরাপত্তা পর্যালোচনা (V4.0)

লক্ষ্য: নিজের ও বন্ধুদের ব্যবহারের জন্য Cloud Run-এ চালানো AI Movie Maker Studio।
পদ্ধতি: কোড পরীক্ষা + স্বয়ংক্রিয় টেস্ট (Emulator/নকল AI)। আসল Google Cloud-এ পরীক্ষা হয়নি।

## ঝুঁকি ও ব্যবস্থা

| ঝুঁকি | ব্যবস্থা | টেস্ট |
|---|---|---|
| অন্যের Project/ফাইল দেখা | সব ডেটা `users/<uid>/…`; uid শুধু যাচাইকৃত Session থেকে; অন্য ব্যবহারকারী 404 পায় | integration (দুই ব্যবহারকারী), security |
| যে কেউ Login করে আপনার Gemini Key ব্যবহার | `ALLOWED_EMAILS` বাধ্যতামূলক (ফাঁকা হলে Server চালু হয় না); প্রতি অনুরোধে যাচাই | deploy, security, integration |
| খরচ বেড়ে যাওয়া | Firestore-ভিত্তিক স্থায়ী Quota (ব্যবহারকারী/Project/Endpoint), 429; Idempotency; ধাপে ধাপে নিশ্চিতকরণ | ratelimit (২৪), jobs |
| একসাথে Save-এ ডেটা নষ্ট | বাধ্যতামূলক `baseRevision` + Firestore Transaction; নতুন Object-এ বড় Body; Checksum | concurrency (১৪), safety |
| Delete ও Save-এর Race, আধা-মোছা ডেটা | দুই-ধাপ Delete, পুনরুদ্ধার, Save প্রত্যাখ্যান | concurrency |
| অন্য Website থেকে আপনার Cookie ব্যবহার (CSRF) | SameSite Cookie + `X-Requested-With` + Origin যাচাই; CORS শুধু নির্দিষ্ট Origin | security |
| XSS / ক্ষতিকর ফাইল | কড়া CSP; Upload-এ ধরন+আকার+ফাইল-স্বাক্ষর; HTML/SVG গ্রহণ নয়; অ-ছবি/ভিডিও শুধু Download | security (৩০), E2E |
| Secret ফাঁস | Log/Error-এ `AIza…`, Token, Cookie লুকানো; Key শুধু Secret Manager | security |
| Cache-এ ব্যক্তিগত ডেটা | Service Worker `/api`, `/media`, `/health` কখনো Cache করে না | PWA E2E |
| Login-এ Brute force/ভুয়া Token | Google Token Server-এ যাচাই; Login-এ প্রতি ঠিকানায় সীমা | security |
| খোলা Dev-সার্ভারে আসল Key | Key থাকলে `STUDIO_ACCESS_TOKEN` বাধ্যতামূলক; Dev-সার্ভার শুধু `127.0.0.1` | security |

## যা এখনো ঝুঁকি / বাকি
1. **আসল Google লগইন** (Google Token-এর স্বাক্ষর যাচাই) এখানে চালানো যায়নি; কেবল ভুয়া Token প্রত্যাখ্যানের টেস্ট আছে। Library-টি Google-এর নিজস্ব (`google-auth-library`)।
2. **Signed URL-এ সরাসরি Upload** আসল Cloud Storage ছাড়া পরীক্ষা অসম্ভব। ফাইল পরে যাচাই হয়, অবৈধ হলে মোছা হয়।
3. Login-এর Rate Limit প্রতি Instance-এ (মেমোরিতে); আসল খরচ-নিয়ন্ত্রণ Quota স্থায়ী।
4. Quota Project-ID ঘুরিয়ে এড়ানো যায়; ব্যবহারকারী-ভিত্তিক সীমাই চূড়ান্ত।
5. Veo-তে শুরু হয়ে যাওয়া অনুরোধ বাতিল করা যায় না (ফল ফেলে দেওয়া হয়, খরচ হতে পারে)।
6. Load/Penetration test হয়নি; Monitoring/Alert নেই; পেমেন্ট/Billing ব্যবস্থা নেই।
7. কোনো তৃতীয়-পক্ষ নিরাপত্তা-নিরীক্ষা (Audit) হয়নি।
