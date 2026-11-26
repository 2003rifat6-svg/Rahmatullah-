# এপিসোড ১: Your Phone Has a Hidden Mode. Never Turn It On.

| | |
|---|---|
| দৈর্ঘ্য | প্রায় ৫ মিনিট (৫৬০ শব্দ, ধীর গলায় আর বিরতিসহ) |
| প্লেলিস্ট | Hidden Modes on Your Phone |
| গল্প এক লাইনে | ভোর ৩:৩৩-এ ফোনে একটা গোপন মোড দেখা যায়। চালু করলে ভবিষ্যতের নোটিফিকেশন আসে। একটা বদলালে ভবিষ্যৎ বদলায়, কিন্তু প্রতিবার ১% ব্যাটারি কমে, আর ফোন আর চার্জ হয় না। শেষে মাকে বাঁচাতে শেষ ব্যাটারিটুকু খরচ হয়, আর আসে একটা "আপডেট"। |
| কাউন্টার | ব্যাটারি: ১০০% → ৯৯% → ৬০% → ২০% → ৩% → ১% |
| সিক্যুয়েলের ইঙ্গিত | "Nevermode update available." ভবিষ্যতের "তুমি" বলছে: don't install it। পরের পর্ব: **Part 2: The Update** |

---

## ১. কণ্ঠের লেখা (Ruvo-র tts-এ সরাসরি দেবেন)

কণ্ঠ: **Charon**। স্টাইল (কপি করুন): `calm, intimate American storyteller, slightly mysterious, natural pacing, slows down before reveals`

প্রতিটা অনুচ্ছেদ একটা শট-ব্লক। ফাঁকা লাইনে স্বাভাবিক বিরতি পড়বে (pause_ms: ৫০০)।

▼ কপি করুন
```
There's a setting on your phone you've never seen.

It only shows up at three thirty-three AM.

It's called Nevermode.

And no matter what happens... never turn it on.

You turned it on.

At first, nothing happens. No sound. No pop-up.

Just a tiny blue dot, right next to your battery.

So you go back to sleep.

In the morning, you have one new notification.

It's from your best friend, Jake.

It says: "Bro... I can't believe you fell in the cafeteria."

Which is weird. Because it's seven AM. And you haven't even left for school.

Then you see the time on the message.

Twelve forty-one PM. Today.

The message... hasn't been sent yet.

At twelve forty, you walk into the cafeteria. Very... slowly.

And there it is. A puddle of spilled milk. Right where you would have stepped.

You step over it.

Twelve forty-one. Jake doesn't send anything. Because nothing happened.

You check your phone. The notification is gone. Like it never existed.

And your battery? Ninety-nine percent.

Nevermode doesn't show you the future. It shows you notifications from the future.

And you just deleted one.

So, you start using it.

A text from your teacher: "Pop quiz tomorrow. Chapter seven."

You read chapter seven. You get an A. Your teacher looks... suspicious.

A weather alert: "Heavy rain at four fifteen."

You bring an umbrella. Everyone else gets soaked.

A message from your bank: "Your card was declined."

You don't buy the sneakers.

For one whole week, you are the luckiest person alive.

Forty notifications changed. Forty little disasters... gone.

Then you notice your battery.

Sixty percent. And it's plugged in.

It doesn't charge anymore. It only goes down.

One percent... every time you change the future.

Fine. You'll just turn it off.

Except... the toggle is gone.

You restart the phone. You reset it. You even buy a new one.

The blue dot shows up on every phone you touch.

And the notifications keep coming. And you keep fixing them. Because how could you not?

Twenty percent. Ten. Five.

Three percent.

That's when they change.

They stop coming from your friends. They start coming from... you.

"Stop changing things."

"You don't know what you're using up."

"Save the rest. You're going to need it."

So you stop.

You let everything happen. You trip in the cafeteria. You fail a quiz. You get soaked.

And your battery holds. Three percent.

Then, at three thirty-three AM... one last notification.

It's from your mom.

Sent tomorrow. Eight fourteen AM. "Running late. Taking the highway. Love you."

That's all it says. But the screen around it... is shaking.

And suddenly, the messages from yourself make sense.

You weren't telling yourself to stop. You were saving the battery. For this.

In the morning, you hide her car keys.

She's late. She's furious. She takes the long way.

At eight fourteen, there's a huge crash on the highway. Your mom is twenty miles away, stuck behind a school bus, still yelling at you on the phone.

Battery: one percent. It cost you two.

That night, your mom hugs you a little longer than usual. She doesn't know why.

Then your phone lights up. A pop-up you've never seen before.

"Nevermode update available. Install tonight at three thirty-three AM?"

And under it... one more message. From you. Sent tomorrow.

"Whatever you do... don't install it."
```
▲ এখানে

---

## ২. শট লিস্ট

প্রতিটা ছবির প্রম্পটের শুরুতে থাকবে **STYLE ব্লক** ([02-brand-and-character.md](../02-brand-and-character.md))। Nev থাকা প্রতিটা শটে রেফারেন্স দেবেন `refs/nev_front`, `refs/nev_side`, `refs/nev_glow`।
🎥 = Ruvo-তে ভিডিও ক্লিপ (৫–৮ সেকেন্ড), 🖼️ = স্থির ছবি + CapCut-এ নড়াচড়া।
"পর্দার লেখা" CapCut-এ বসাবেন, AI-কে দিয়ে নয়।

### হুক (০:০০–০:১৫)
| # | ধরন | দৃশ্য (বাংলায়) | ছবির প্রম্পট (STYLE-এর পরে) | পর্দার লেখা / শব্দ |
|---|---|---|---|---|
| 01 | 🎥 | অন্ধকারে ফোনের সেটিংস স্ক্রল হচ্ছে, কাছ থেকে | Extreme close-up of a smartphone screen in a pitch-dark bedroom, a thumb slowly scrolling through a settings list made of simple grey bars, faint cyan glow at the bottom of the list. Clip: slow scroll, camera pushes in. | নিচু ড্রোন শব্দ |
| 02 | 🖼️ | Nev বিছানায় চোখ খোলা, ফোনের আলো মুখে | NEV lying awake in bed in a dark bedroom, holding a phone above his face, screen light on his face, wide awake eyebrows. | `3:33 AM` |
| 03 | 🖼️ | ফোনের পর্দায় একটা সায়ান টগল, এখনও OFF | Close-up of a phone screen showing one single toggle switch in the OFF position, outlined with a faint cyan glow, everything else dark. | `NEVERMODE` (ছোট, টগলের পাশে) |
| 04 | 🖼️ | Nev-এর মুখ, নিচ থেকে আলো, দ্বিধার ভুরু | Close-up of NEV's face lit from below by a phone, worried, hesitant eyebrows, dark background. | — |
| 05 | 🎥 | আঙুল টগল অন করে, Nev-এর চোখ সায়ান জ্বলে ওঠে | NEV's thumb flips the toggle to ON; his two eyes ignite bright cyan and a cyan glow floods his face. Clip: quick flick, eyes light up, slight camera shake. | ক্লিক + ভুম। তারপর ১ সেকেন্ডের স্টিং `NEVERMODE` |

### শুরু (০:১৫–১:১০)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 06 | 🖼️ | Nev ফোন হাতে বসে, কিছুই ঘটছে না | NEV sitting on the edge of his bed holding the phone, looking at it, nothing happening, quiet dark room. | ঘড়ির টিকটিক |
| 07 | 🖼️ | স্ট্যাটাস বারে ব্যাটারির পাশে ছোট সায়ান বিন্দু | Macro close-up of a phone's top status bar drawn as simple shapes: a battery icon and next to it a tiny glowing cyan dot. | `100%` + নীল বিন্দু |
| 08 | 🖼️ | Nev ঘুমিয়ে পড়েছে, উপুড় করা ফোনের নিচে সায়ান আলো | NEV asleep in bed, the phone lying face-down on the nightstand with cyan light leaking from underneath it. | — |
| 09 | 🖼️ | সকাল, Nev উঠে বসেছে, ফোন কাঁপছে | Morning, soft pale light through blinds, NEV sitting up in bed, phone buzzing on the nightstand. | ding |
| 10 | 🖼️ | ফোনে মেসেজের বাক্স (লেখা ছাড়া) | Phone screen close-up with one notification bubble shape and a small round grey avatar, no readable text. | `Jake` |
| 11 | 🖼️ | Nev-এর বিভ্রান্ত মুখ | NEV holding the phone close, one eyebrow raised, confused. | `Bro... I can't believe you fell in the cafeteria 😂` |
| 12 | 🖼️ | বাথরুমে দাঁত ব্রাশ করতে করতে ফোন দেখছে | NEV in a small bathroom brushing his teeth with one hand, staring at the phone in the other. | `7:02 AM` |
| 13 | 🖼️ | ফোনের দিকে জুম | Over-the-shoulder shot of NEV looking at the phone screen, cyan glow. | — |
| 14 | 🖼️ | মেসেজের সময়, কাছ থেকে | Close-up of the notification bubble on the phone, a cyan shimmer around it. | `Sent 12:41 PM` |
| 15 | 🖼️ | Nev জমে গেছে, চোখ বড় | NEV frozen mid-step in his room, eyes wide, faint cyan glow in his eyes. | হঠাৎ নীরবতা |

### প্রথম পরীক্ষা (১:১০–২:০০)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 16 | 🎥 | Nev খুব সাবধানে স্কুল ক্যাফেটেরিয়ায় ঢুকছে | NEV tiptoeing very carefully into a busy American school cafeteria full of grey stick-figure students with lunch trays. Clip: slow careful walk forward. | ক্যাফেটেরিয়ার হট্টগোল |
| 17 | 🖼️ | মেঝেতে দুধ পড়ে আছে, ঠিক Nev-এর পায়ের সামনে | Low angle on the cafeteria floor: a white puddle of spilled milk, NEV's foot hovering right above it. | `12:40` |
| 18 | 🖼️ | Nev জয়ের ভঙ্গিতে লাফিয়ে পার হচ্ছে | NEV stepping over the puddle in an exaggerated proud pose, arms out. | pop শব্দ |
| 19 | 🖼️ | Jake (উল্টো ক্যাপ) খাচ্ছে, ফোন রাখা | A grey stick figure with a backwards baseball cap (JAKE) eating at a table, phone face-down, NEV sitting across from him smiling. | `12:41` |
| 20 | 🖼️ | ফোনে খালি নোটিফিকেশনের জায়গা | Phone screen showing an empty notification area, a few fading cyan particles where a message used to be. | whoosh |
| 21 | 🖼️ | ব্যাটারি ৯৯% | Close-up of a simple battery icon, almost full, glowing softly cyan. | `99%` |
| 22 | 🖼️ | ফোন থেকে আলোর ফাটল দিয়ে নোটিফিকেশন বের হচ্ছে | Conceptual shot: a phone lying in the dark with a glowing cyan rift on its screen, notification bubble shapes drifting out of it like leaves. | — |
| 23 | 🖼️ | Nev আত্মবিশ্বাসী ভুরু, হালকা হাসি-ভাব | NEV holding the phone, confident, eyebrows raised, a cyan glint in his eyes. | — |

### মজা (২:০০–৩:০০)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 24 | 🖼️ | বিছানায় দুই হাতে ফোন, চোখ জ্বলছে | NEV sitting cross-legged on his bed, phone in both hands, eyes glowing cyan, excited. | হালকা ছন্দের মিউজিক শুরু |
| 25 | 🖼️ | শিক্ষকের নোটিফিকেশন | Phone screen with a notification bubble shape and an avatar with glasses, no readable text. | `Mr. Hall: Pop quiz tomorrow. Chapter 7.` |
| 26 | 🖼️ | ক্লাসে Nev কাগজ উঁচিয়ে ধরেছে, চশমা পরা শিক্ষক সন্দেহের চোখে | Classroom, NEV proudly holding up a test paper, a grey teacher with glasses squinting suspiciously at him. | কাগজে বড় করে `A` |
| 27 | 🖼️ | আবহাওয়ার সতর্কবার্তা | Phone screen with a warning-style notification shape and a cloud icon. | `⚠ Heavy rain at 4:15 PM` |
| 28 | 🎥 | বৃষ্টি, সবাই ভিজছে, Nev ছাতার নিচে শুকনো | Heavy rain on a school sidewalk, grey students running and getting soaked, NEV calmly walking dry under an umbrella. Clip: rain falling, NEV walks past. | বৃষ্টি |
| 29 | 🖼️ | ব্যাংকের নোটিফিকেশন | Phone screen with a red-edged notification shape and a card icon. | `Card declined: $189.99` |
| 30 | 🖼️ | Nev জুতা তাকে ফিরিয়ে রাখছে | NEV in a shoe store placing a pair of sneakers back on the shelf, relieved. | — |
| 31 | 🖼️ | স্কুলের করিডোরে Nev স্টাইলে হাঁটছে | NEV walking confidently down a school hallway, lockers on both sides, a soft cyan glow around him. | — |
| 32 | 🖼️ | নোটিফিকেশনগুলো সায়ান কণা হয়ে মিলিয়ে যাচ্ছে | A phone with a tall stack of notification shapes dissolving into cyan particles. | `40` |

### দাম (৩:০০–৪:১০)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 33 | 🖼️ | হাঁটতে হাঁটতে থেমে ফোনের দিকে তাকানো | NEV stopping in the middle of the hallway, looking down at the phone. | মিউজিক থামে |
| 34 | 🖼️ | চার্জারে লাগানো ফোন, ব্যাটারি অর্ধেক | Phone on a desk connected to a charging cable, battery icon about half full. | `60%` 🔌 |
| 35 | 🖼️ | ব্যাটারি আইকন খালি হচ্ছে | Close-up of a battery icon draining, the cyan level sinking. | — |
| 36 | 🖼️ | একদিকে নোটিফিকেশন মিলিয়ে যাচ্ছে, অন্যদিকে ব্যাটারি কমছে | Split composition: on the left a notification shape vanishing into particles, on the right a battery icon dropping one notch. | `-1%` |
| 37 | 🖼️ | Nev দৃঢ় মুখে সেটিংস খুলছে | NEV opening the phone settings, determined eyebrows. | — |
| 38 | 🖼️ | সেটিংসে টগলের জায়গা খালি | Phone settings screen with an empty dark gap where a toggle used to be. | ভুতুড়ে শব্দ |
| 39 | 🖼️ | ফোন রিসেট, নতুন ফোনের বাক্স | NEV at a desk surrounded by a phone, a laptop showing a progress bar, and an opened new-phone box. | — |
| 40 | 🎥 | নতুন ফোন ছুঁতেই তাতে সায়ান বিন্দু ফুটে ওঠে | NEV touches a brand-new phone and a tiny cyan dot blooms on its screen. Clip: finger touches, dot glows and pulses. | ক্লিক + ভুম (ছোট) |
| 41 | 🖼️ | টেবিলে ফোন কাঁপছে, অনেকগুলো আলো | Phone vibrating on a desk with many notification glows around it, NEV reaching for it. | ding ding ding |
| 42 | 🖼️ | ব্যাটারি লাল, খুব কম | Battery icon almost empty, glowing red. | `20%` → `10%` → `5%` → `3%` (দ্রুত বদলায়) |
| 43 | 🖼️ | অন্ধকার ঘর, শুধু ফোনের আলো | NEV in a dark room, the only light coming from the phone, tense posture. | — |
| 44 | 🖼️ | নোটিফিকেশনের আইকনে Nev-এর নিজের গোল মাথা | Phone screen with a notification whose avatar is NEV's own round white head with two eyes. | `From: You` |
| 45 | 🖼️ | Nev-এর ভয় পাওয়া মুখ | NEV's face close-up, scared eyebrows, phone light. | `You: Stop changing things.` |
| 46 | 🖼️ | আরেকটা নোটিফিকেশন | Same phone screen, a second notification from NEV's own avatar. | `You: You don't know what you're using up.` |
| 47 | 🖼️ | তৃতীয় নোটিফিকেশন | Same screen, a third notification, glowing slightly brighter. | `You: Save the rest. You're going to need it.` |

### ছেড়ে দেওয়া (৪:১০–৪:৩৫)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 48 | 🖼️ | Nev ফোন টেবিলে রেখে লম্বা শ্বাস নিচ্ছে | NEV placing the phone face-down on his desk, shoulders dropping, taking a breath. | — |
| 49 | 🎥 | ক্যাফেটেরিয়ায় Nev পিছলে পড়ে (মজার ভঙ্গিতে) | NEV slipping in the cafeteria in a goofy cartoon way, lunch tray flying, students turning to look. Clip: comedic slow-motion slip. | পড়ে যাওয়ার শব্দ + হাসি |
| 50 | 🖼️ | ব্যাটারি ৩%, স্থির | Battery icon nearly empty, red, steady. | `3%` |

### টুইস্ট (৪:৩৫–৫:৪০)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 51 | 🖼️ | রাত, ফোনের আলো সিলিংয়ে | Night, NEV asleep, the phone on the nightstand lighting the ceiling cyan. | `3:33 AM` · মিউজিক পুরো বন্ধ |
| 52 | 🖼️ | পর্দায় "Mom" | Phone screen with a notification bubble, the avatar is a grey figure with a scarf. | `Mom` |
| 53 | 🖼️ | মেসেজ, কাছ থেকে | Close-up of the notification bubble, shimmering. | `Sent tomorrow, 8:14 AM` + `Running late. Taking the highway. Love you ❤️` |
| 54 | 🖼️ | মেসেজের চারপাশে পর্দা কাঁপছে, লাল কিনারা | The phone screen with the message, red flickering edges and glitch distortion around it. | কাঁপুনির শব্দ |
| 55 | 🖼️ | Nev বিছানায় উঠে বসে, চোখ জ্বলছে | NEV sitting up in bed in the dark, eyes glowing cyan, realization. | নিচু সুর শুরু (আবেগের) |
| 56 | 🖼️ | পাশাপাশি: ব্যাটারি ৩% আর মায়ের মেসেজ | Phone screen showing a red nearly empty battery icon right above the mom notification. | `3%` |
| 57 | 🎥 | ভোরে দরজার পাশের বাটি থেকে Nev চুপচাপ চাবি সরায় | Early morning, NEV quietly taking car keys from a bowl by the front door; in the background, a grey figure with a scarf (MOM) searching her bag. Clip: hand slowly lifts keys. | চাবির টুংটাং |
| 58 | 🖼️ | মা কোমরে হাত দিয়ে রাগী, Nev অপরাধী মুখে | MOM (grey figure with scarf) with hands on hips, furious, NEV standing sheepish. | — |
| 59 | 🖼️ | দূরে হাইওয়েতে জ্যাম আর ধোঁয়া, কাছে শান্ত রাস্তায় মায়ের গাড়ি স্কুলবাসের পেছনে | Wide shot: far in the distance a highway jammed with tiny cars and a soft column of smoke; in the foreground a quiet suburban road where MOM's small car is stuck behind a yellow school bus. No people hurt, nothing graphic. | `8:14 AM` · দূরে সাইরেন |
| 60 | 🖼️ | ব্যাটারি ১% | Battery icon with a single red sliver. | `1%` |
| 61 | 🖼️ | মা Nev-কে জড়িয়ে ধরেছে | Warm lamp-lit kitchen at night, MOM hugging NEV tightly, NEV's eyes closed. | উষ্ণ সুর |

### শেষ (৫:৪০–৬:০৫)
| # | ধরন | দৃশ্য | প্রম্পট | লেখা / শব্দ |
|---|---|---|---|---|
| 62 | 🎥 | অন্ধকারে নাইটস্ট্যান্ডের ফোন সায়ান আলোয় জ্বলে ওঠে | Dark bedroom, the phone on the nightstand suddenly lights up with a strong cyan glow filling the room. Clip: light blooms, camera slowly pushes in. | ভুম |
| 63 | 🖼️ | পর্দায় পপ-আপ বাক্স, দুটো বোতাম | Phone screen with a large pop-up box shape and two button shapes, glowing cyan. | `Nevermode Update Available` · `Install tonight at 3:33 AM?` · `[Install] [Later]` |
| 64 | 🖼️ | পপ-আপের নিচে আরেকটা নোটিফিকেশন, Nev-এর অ্যাভাটার | Same screen, a small notification appears under the pop-up with NEV's own round-head avatar. | `From: You · Sent tomorrow` |
| 65 | 🖼️ | Nev-এর মুখ, চোখ জ্বলছে, ভয় → কালো পর্দা | Extreme close-up of NEV's face, eyes glowing cyan, terrified eyebrows. | `Whatever you do... don't install it.` → ক্লিক → কালো |
| — | End screen | ১০–১৫ সেকেন্ড টেমপ্লেট | — | `NEVER TURN IT ON.` |

---

## ৩. থাম্বনেইল (তিনটা বানাবেন)

**A, প্রধান** (লেখা ছাড়া ছবি, তারপর Canva-তে লেখা):

▼ কপি করুন
```
STYLE as channel style but thumbnail framing: bold, simple, high contrast. Left half: NEV large, upper body, holding a phone toward the viewer, his eyes glowing bright cyan, terrified eyebrows. Right half: the phone screen enlarged, showing one huge glowing cyan toggle switch in the ON position. Near-black navy background, strong cyan rim light. No text.
```
▲ এখানে

Canva-তে লেখা: `IT'S ON.` (Anton, সাদা, ডান-উপরে, "ON" সায়ান রঙে)

**B:** একই ছবি, লেখা `3:33 AM` (সায়ান)
**C:** ব্যাটারি-ভিত্তিক। Nev ভয়ে ফোন ধরে আছে, ফোনে লাল প্রায় খালি ব্যাটারি। লেখা `1% LEFT` ("1%" লাল)

---

## ৪. আপলোড প্যাক

**টাইটেল (মূল)**

▼ কপি করুন
```
Your Phone Has a Hidden Mode. Never Turn It On.
```
▲ এখানে

**বিকল্প টাইটেল (Test & Compare)**

▼ কপি করুন
```
There's a Hidden Mode on Your Phone. Don't Find It.
```
```
Your Phone Has a Setting That Only Appears at 3:33 AM
```
▲ এখানে

**বিবরণের প্রথম দুই লাইন** (বাকিটা Upload default থেকে আসবে)

▼ কপি করুন
```
There's a setting on your phone that only shows up at 3:33 AM. It lets you see notifications from the future — and change them.
But every time you change the future, your battery drops 1%. And it never charges again.
```
▲ এখানে

**ট্যাগ**

▼ কপি করুন
```
nevermode, hidden mode, phone hidden mode, never turn it on, animated story, what if, scary story, sci-fi animation, stick figure animation, notifications from the future, 3:33 am
```
▲ এখানে

**পিন করা কমেন্ট**

▼ কপি করুন
```
Be honest — would you have turned it on? 👀 And which notification would you change first?
```
▲ এখানে

**প্লেলিস্ট:** Hidden Modes on Your Phone

---

## ৫. Short (৪০–৫০ সেকেন্ড, ৯:১৬)

- শট: ০১ → ০৫ (হুক) → ০৯–১৫ (ভবিষ্যতের মেসেজ) → ১৭–১৮ (দুধ পার হওয়া) → ২১–২৩, আর শেষ লাইন "And you just deleted one." এর ঠিক পরে কাটবেন।
- শেষে যোগ করুন (কণ্ঠ, Ruvo-তে আলাদা বানিয়ে): `But it has a price. The full story is on the channel.`
- উপরের লেখা: `NEVER TURN THIS ON`
- Short-এর টাইটেল:

▼ কপি করুন
```
Your phone has a setting that only appears at 3:33 AM 😳 #shorts
```
▲ এখানে

- **Related video:** মূল এপিসোড ১

---

## ৬. Ruvo স্টুডিওতে এক লাইনে শুরু

মাস্টার কমান্ড বসানো থাকলে স্টুডিওতে লিখুন:

```
এপিসোড ১ বানাও। স্ক্রিপ্ট আর শট লিস্ট আমার কাছে তৈরি আছে, আমি ফাইল দিচ্ছি। নতুন করে লিখবে না, শুধু কণ্ঠ, ছবি, ক্লিপ আর এডিট প্ল্যান বানাও।
```

তারপর 📎 দিয়ে এই ফাইলটা (`ep01-phone-hidden-mode.md`) আপলোড করুন।
