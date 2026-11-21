# চিত্রপট অনলাইনে তোলা — সবচেয়ে সহজ পথ (Render, ১০ মিনিট)

## ০. আগে একবার (এক মিনিট)
এই ফোল্ডারের **সব ফাইল** একটা **নতুন, খালি GitHub রিপোতে** তোলো, যাতে `Dockerfile` আর `render.yaml` রিপোর একদম ওপরে থাকে।
(আগের রিপোতে অন্য অ্যাপও আছে, তাই আলাদা রিপো লাগে। এতে Root Directory বা Build/Start Command-এর কোনো সেটিং লাগে না, আর আটকানোর সবচেয়ে বড় কারণটা চলে যায়।)

GitHub → **New repository** → নাম `chitropot` → তৈরি হলে **uploading an existing file** চেপে ZIP-এর ভেতরের সব ফাইল টেনে দাও → **Commit**।

## ১. Gemini key (নতুন)
aistudio.google.com → **Get API key**। ছবি/ভিডিওর জন্য ওই প্রজেক্টে বিলিং চালু করো।

## ২. Google লগইন (Client ID)
console.cloud.google.com → **APIs & Services → OAuth consent screen** (External, নাম "চিত্রপট", তোমার ইমেইল, **Publish app**) → **Credentials → Create credentials → OAuth client ID → Web application** → Client ID কপি করো। (ঠিকানা পরে ধাপ ৫-এ বসবে।)

## ৩. Render-এ এক চাপে
render.com → **New → Blueprint** → নতুন রিপোটা বাছো → **Apply**।
Render `render.yaml` পড়ে নিজেই সব বানাবে: সার্ভার, স্থায়ী ডিস্ক (`/data`), হেলথ চেক, গোপন সেশন-চাবি।
শুধু এই ৪টা ঘর জিজ্ঞেস করবে, নিজে বসাও:

| ঘর | কী দেবে |
|---|---|
| GEMINI_API_KEY | ধাপ ১-এর key |
| GOOGLE_CLIENT_ID | ধাপ ২-এর Client ID |
| OWNER_EMAIL | তোমার Gmail |
| OWNER_PANEL_PASSWORD | কন্ট্রোল প্যানেলের পাসওয়ার্ড |

`PUBLIC_URL`, `PORT`, `TRUST_PROXY`: **বসাতে হবে না**, অ্যাপ নিজে Render থেকে নেয়।
`DEV_LOGIN` কখনো বসাবে না।

> ডিস্ক পেইড প্ল্যানে (Starter, মাসে প্রায় $৭) পাওয়া যায়। ফ্রি প্ল্যানে ডিস্ক নেই, তাই আপডেটে সব ডেটা মুছে যায়। অ্যাপ নিজেই লগে আর অ্যাডমিন পাতায় লাল সতর্কতা দিয়ে এটা জানাবে।

## ৪. চালু হয়েছে কি না দেখো
Render → সার্ভিস → **Logs**। এই চেকলিস্ট দেখলে হয়েছে:
```
চিত্রপট চালু: http://localhost:10000
── চালুর চেকলিস্ট ──
✓ Gemini key আছে
✓ Gmail লগইন চালু
✓ মালিক: তোমার@gmail.com
✓ কন্ট্রোল প্যানেলের পাসওয়ার্ড আছে
✓ ঠিকানা: https://....onrender.com
✓ ডেটা রাখার জায়গা: /data (স্থায়ী)
```
কোনো ✗ থাকলে ওই লাইনেই লেখা আছে কী বাকি।

## ৫. Google-কে ঠিকানা জানাও (এটা না করলে লগইন বোতাম কাজ করে না)
Render-এ সার্ভিসের ঠিকানা (`https://চিত্রপট-xxxx.onrender.com`) কপি করো → Google Cloud → OAuth client → **Authorized JavaScript origins** → যোগ করো → Save। (এক-দুই মিনিট লাগতে পারে।)

## ৬. প্রথম ব্যবহার
ঠিকানা খুলে তোমার Gmail দিয়ে ঢোকো → পাশের মেনু → **🔐 মালিকের কন্ট্রোল** → পাসওয়ার্ড → যোগাযোগের তথ্য আর বন্ধুদের Gmail বসাও।
ফোনে: ব্রাউজারের মেনু → **Install app / Add to Home screen**।

---
## বিকল্প হোস্ট
এই ফোল্ডারে `Dockerfile` একদম ওপরে আছে, তাই Railway, Fly.io, Koyeb সবখানেই রিপো জুড়ে দিলেই নিজে ধরে নেয়, Root Directory সেটিং লাগে না।
শুধু একটা Volume/Disk যোগ করো (Mount path `/data`) আর ধাপ ৩-এর ৪টা Variables বসাও।

## আটকে গেলে
Logs-এর শেষ কয়েক লাইন (কোনো key ছাড়া) পাঠালেই কারণ ধরা যায়।
