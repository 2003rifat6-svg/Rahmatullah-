// মিডিয়া প্রসেসিং: ffmpeg/ffprobe দিয়ে নির্দিষ্ট, পরীক্ষাযোগ্য "রেসিপি" (ডকুমেন্টারি স্টুডিওর Part A3)।
// shell কখনো ব্যবহার হয় না: সব আর্গুমেন্ট আলাদা অ্যারেতে যায়, তাই ফাইলের নাম দিয়ে কমান্ড ঢোকানো যায় না।
'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (bin, args, timeoutMs = 20 * 60e3) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || '').slice(-2000); return reject(err); }
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

let available = null;
async function ffmpegAvailable() {
  if (available === null) available = await run('ffmpeg', ['-hide_banner', '-version'], 10000).then(() => true, () => false);
  return available;
}

/* ---------------- WAV ---------------- */
// WAV পড়া: fmt আর data অংশ। Gemini কখনো কখনো data-র আকার 0xFFFFFFFF দেয় (স্ট্রিম), তাই বাকি পুরোটা নেওয়া হয়।
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null, data = null, p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    let size = buf.readUInt32LE(p + 4);
    const start = p + 8;
    if (size > buf.length - start) size = buf.length - start;
    if (id === 'fmt ' && size >= 16) fmt = { format: buf.readUInt16LE(start), channels: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    if (id === 'data') { data = buf.subarray(start, start + size); break; }
    p = start + size + (size % 2);
  }
  return fmt && data ? { ...fmt, data } : null;
}
function wavHeader({ channels, rate, bits }, dataLen) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * bits / 8, 28); h.writeUInt16LE(channels * bits / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataLen, 40);
  return h;
}
// Gemini-র অডিও: WAV হলে সরাসরি, "audio/L16;rate=24000" ধরনের কাঁচা PCM হলে mime থেকে মাপ নিয়ে
function toPcm(buf, mime = '') {
  const w = parseWav(buf);
  if (w) {
    if (w.format !== 1) throw new Error('অডিওর ফরম্যাট (PCM নয়) জোড়া লাগানো যায় না');
    return w;
  }
  const m = /audio\/(?:l16|pcm)[^;]*(?:;.*?rate=(\d+))?(?:;.*?channels=(\d+))?/i.exec(mime);
  if (m) {
    // L16 নিয়ম অনুযায়ী big-endian; WAV-এর জন্য little-endian করা
    const data = Buffer.from(buf);
    if (/l16/i.test(mime)) for (let i = 0; i + 1 < data.length; i += 2) { const a = data[i]; data[i] = data[i + 1]; data[i + 1] = a; }
    return { format: 1, channels: +m[2] || 1, rate: +m[1] || 24000, bits: 16, data };
  }
  throw new Error('কণ্ঠের অডিওর ধরন চেনা যায়নি' + (mime ? ` (${mime})` : ''));
}
// কয়েকটা অংশ জোড়া, মাঝে স্বাভাবিক বিরতি (নীরবতা)
function joinPcm(parts, pausesMs) {
  const f = parts[0];
  for (const p of parts) if (p.rate !== f.rate || p.channels !== f.channels || p.bits !== f.bits) throw new Error('অংশগুলোর অডিওর মাপ আলাদা');
  const frame = f.channels * f.bits / 8;
  const chunks = [];
  parts.forEach((p, i) => {
    chunks.push(p.data);
    if (i < parts.length - 1) chunks.push(Buffer.alloc(Math.round(f.rate * (pausesMs[i] || 0) / 1000) * frame));
  });
  const data = Buffer.concat(chunks);
  return { buf: Buffer.concat([wavHeader(f, data.length), data]), seconds: data.length / frame / f.rate };
}

/* ---------------- রেসিপি ---------------- */
const num = (re, s) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,sample_rate,channels,width,height,r_frame_rate', '-of', 'json', file], 60000);
  const j = JSON.parse(stdout);
  return { duration: Number(j.format?.duration) || 0, streams: (j.streams || []).map(s => ({ type: s.codec_type, codec: s.codec_name, rate: s.sample_rate ? +s.sample_rate : undefined, channels: s.channels, width: s.width, height: s.height, fps: s.r_frame_rate })) };
}
async function loudness(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.8,ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const silences = [];
  for (const m of stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)) silences.push({ start: +(+m[1] - +m[2]).toFixed(2), end: +m[1], seconds: +m[2] });
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/, summary), truePeakDb: num(/Peak:\s+(-?[\d.]+) dBFS/, summary), lra: num(/LRA:\s+(-?[\d.]+) LU/, summary), silences };
}
// জোড়া লাগানো কণ্ঠে নিয়মিত লম্বা বিরতি (যেমন প্রতি ~২৬ সেকেন্ডে) খোঁজা
function regularPauses(silences) {
  const long = silences.filter(s => s.seconds >= 1.2);
  if (long.length < 3) return null;
  const gaps = long.slice(1).map((s, i) => s.start - long[i].start);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const spread = Math.max(...gaps.map(g => Math.abs(g - avg)));
  return spread < avg * 0.25 ? { everySeconds: +avg.toFixed(1), count: long.length } : null;
}

const V_OUT = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const FIT = 'scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,setsar=1,fps=30';
const GRADES = {
  S1: 'colorbalance=rs=-0.06:bs=0.08:rh=0.06:bh=-0.05,eq=contrast=1.08:saturation=0.95,noise=alls=6:allf=t,vignette=PI/5',
  S2: 'eq=saturation=1.1:contrast=1.03',
  S3: 'eq=brightness=0.02:contrast=1.05:saturation=1.05',
  S4: 'eq=contrast=1.1:saturation=0.85,noise=alls=8:allf=t',
};

// প্রতিটা রেসিপি: ইনপুট ফাইলের লোকাল পথ নেয়, আউটপুট ফাইলের পথ আর রিপোর্ট দেয়
const RECIPES = {
  async audio_probe({ input }) {
    const p = await probe(input);
    const l = await loudness(input);
    return { report: { ...p, ...l, silences: l.silences.slice(0, 200), regularLongPauses: regularPauses(l.silences) } };
  },
  // কৃত্রিম লম্বা বিরতি ছোট করা (>১.২ সে. → ০.৭ সে.), পরিষ্কার EQ, হালকা কম্প্রেশন, -14 LUFS / -1.5 dBTP
  async audio_clean({ input }, dir) {
    const out = path.join(dir, 'clean.wav');
    await run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-af', [
      'silenceremove=stop_periods=-1:stop_duration=1.2:stop_threshold=-45dB:stop_silence=0.7',
      'highpass=f=85', 'equalizer=f=280:t=q:w=1:g=-3', 'equalizer=f=3200:t=q:w=1:g=4', 'equalizer=f=8000:t=q:w=1:g=2',
      'acompressor=threshold=-18dB:ratio=3:attack=10:release=200', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    ].join(','), '-ar', '48000', '-c:a', 'pcm_s16le', out]);
    return { output: out, mime: 'audio/wav', report: { before: await loudness(input).then(l => ({ lufs: l.lufs, truePeakDb: l.truePeakDb })), after: await loudness(out).then(l => ({ lufs: l.lufs, truePeakDb: l.truePeakDb })) } };
  },
  // ক্লিপ নির্দিষ্ট সময়ে মেলানো: গতি বদল সর্বোচ্চ ±৮%, নইলে কাটা; 2560×1440, 30fps
  async clip_fit({ input, seconds }, dir) {
    const target = Number(seconds);
    if (!(target > 0 && target <= 60)) throw new Error('seconds ০ থেকে ৬০-এর মধ্যে দাও');
    const { duration } = await probe(input);
    const k = target / duration;
    let vf = FIT, how;
    if (Math.abs(k - 1) <= 0.08) { vf = `setpts=${k.toFixed(5)}*PTS,${FIT}`; how = `speed ${((1 / k - 1) * 100).toFixed(1)}%`; }
    else if (duration > target) how = 'trimmed';
    else throw new Error(`ক্লিপ ${duration.toFixed(2)} সে., দরকার ${target} সে. — ৮%-এর বেশি ধীর করা যাবে না। আরেকটা শট যোগ করো।`);
    const out = path.join(dir, 'fit.mp4');
    await run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-vf', vf, '-t', String(target), '-an', ...V_OUT, out]);
    return { output: out, mime: 'video/mp4', report: { from: +duration.toFixed(2), to: target, how } };
  },
  async grade({ input, style }, dir) {
    const vf = GRADES[style];
    if (!vf) throw new Error('style হবে S1, S2, S3 বা S4');
    const out = path.join(dir, 'graded.mp4');
    await run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-vf', vf, '-c:a', 'copy', ...V_OUT, out]);
    return { output: out, mime: 'video/mp4', report: { style } };
  },
  // কণ্ঠ + মিউজিক: কণ্ঠ এলে মিউজিক নিজে থেকে নিচে নামে (sidechain), লিমিটার, -14 LUFS
  async mix({ voice, music, music_db = -20 }, dir) {
    const out = path.join(dir, 'mix.wav');
    const db = Math.max(-40, Math.min(-6, Number(music_db) || -20));
    const args = ['-hide_banner', '-y', '-i', voice];
    if (music) {
      args.push('-i', music, '-filter_complex',
        `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[v][sc];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${db}dB[m];` +
        '[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck];[v][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84,loudnorm=I=-14:TP=-1.5:LRA=11[out]',
        '-map', '[out]');
    } else args.push('-af', 'loudnorm=I=-14:TP=-1.5:LRA=11');
    args.push('-ar', '48000', '-c:a', 'pcm_s16le', out);
    await run('ffmpeg', args);
    const l = await loudness(out);
    return { output: out, mime: 'audio/wav', report: { lufs: l.lufs, truePeakDb: l.truePeakDb, musicDb: music ? db : null } };
  },
  // শট জোড়া (হার্ড কাট) + কণ্ঠ, শুরুতে ১.৫ সে. আগে ছবি চলে; MASTER 2560×1440 30fps H.264 CRF18 + AAC 192k
  async assemble({ clips, audio, lead_in = 1.5 }, dir) {
    if (!Array.isArray(clips) || !clips.length) throw new Error('clips খালি');
    if (clips.length > 400) throw new Error('একবারে ৪০০টির বেশি শট নয়');
    const args = ['-hide_banner', '-y'];
    clips.forEach(c => args.push('-i', c));
    if (audio) args.push('-i', audio);
    const lead = Math.max(0, Math.min(5, Number(lead_in) || 0));
    const v = clips.map((_, i) => `[${i}:v]${FIT},format=yuv420p[v${i}]`).join(';');
    let fc = `${v};${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vout]`;
    if (audio) fc += `;[${clips.length}:a]adelay=${Math.round(lead * 1000)}:all=1,apad[aout]`;
    args.push('-filter_complex', fc, '-map', '[vout]');
    if (audio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    const out = path.join(dir, 'master.mp4');
    args.push(...V_OUT, out);
    await run('ffmpeg', args, 60 * 60e3);
    return { output: out, mime: 'video/mp4', report: await probe(out) };
  },
  // ফোন/চ্যাটের জন্য ছোট কপি: HEVC ~5 Mbps
  async small_copy({ input }, dir) {
    const out = path.join(dir, 'small.mp4');
    await run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-c:v', 'libx265', '-preset', 'fast', '-b:v', '5M', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], 60 * 60e3);
    return { output: out, mime: 'video/mp4', report: await probe(out) };
  },
  // মান যাচাই: কালো/থেমে থাকা ফ্রেম, লাউডনেস, পিক, দৈর্ঘ্য, প্রতি ১০ সেকেন্ডের ছবি দিয়ে কন্টাক্ট শিট
  async qc({ input }, dir) {
    const p = await probe(input);
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 60 * 60e3);
    const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => ({ start: +m[1], end: +m[2] }));
    const frozen = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map(m => +m[1]);
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
    const sheet = path.join(dir, 'contact.jpg');
    const every = Math.max(1, Math.min(10, p.duration / 4));
    await run('ffmpeg', ['-hide_banner', '-y', '-i', input, '-vf', `fps=1/${every.toFixed(2)},scale=320:-2,tile=6x${Math.max(1, Math.ceil(p.duration / every / 6))}`, '-frames:v', '1', '-q:v', '4', sheet]);
    const lufs = num(/I:\s+(-?[\d.]+) LUFS/, summary), peak = num(/Peak:\s+(-?[\d.]+) dBFS/, summary);
    return {
      output: sheet, mime: 'image/jpeg',
      report: {
        duration: p.duration, black, frozen, lufs, truePeakDb: peak,
        checks: {
          loudnessOk: lufs !== null && p.streams.some(s => s.type === 'audio') ? lufs <= -13 && lufs >= -16.5 : null,
          peakOk: peak !== null ? peak <= -1.4 : null,
          noBlack: black.length === 0, noFrozen: frozen.length === 0,
          sync: 'not checked: needs speech-to-text with word timestamps (not configured)',
        },
      },
    };
  },
};

// রেসিপি চালানো: অস্থায়ী ফোল্ডারে, শেষে মুছে ফেলা
async function runRecipe(name, inputs, params) {
  const fn = RECIPES[name];
  if (!fn) throw new Error('অজানা রেসিপি: ' + name);
  if (!(await ffmpegAvailable())) throw new Error('এই সার্ভারে ffmpeg নেই');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cp-media-'));
  try {
    const local = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (Array.isArray(v)) {
        local[k] = [];
        for (const [i, f] of v.entries()) { const p = path.join(dir, `${k}${i}${f.ext}`); await fs.promises.writeFile(p, f.buf); local[k].push(p); }
      } else if (v) { const p = path.join(dir, `${k}${v.ext}`); await fs.promises.writeFile(p, v.buf); local[k] = p; }
    }
    const r = await fn({ ...params, ...local }, dir);
    return { ...r, buf: r.output ? await fs.promises.readFile(r.output) : null };
  } catch (e) {
    throw new Error(`${name} ব্যর্থ: ${e.message}${e.stderr ? ' — ' + e.stderr.split('\n').filter(Boolean).slice(-2).join(' ') : ''}`.slice(0, 900));
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { parseWav, wavHeader, toPcm, joinPcm, runRecipe, ffmpegAvailable, RECIPES, regularPauses };
