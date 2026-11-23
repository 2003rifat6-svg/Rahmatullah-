# পরিবর্তনের তালিকা (Changelog)

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
