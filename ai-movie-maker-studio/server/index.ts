import 'dotenv/config';
import path from 'node:path';
import { createApp } from './app';
import { createGeminiProvider } from './provider';

const port = Number(process.env.PORT || 8787);
const provider = createGeminiProvider();
const app = createApp({
  provider,
  mediaDir: path.resolve(process.env.MEDIA_DIR || 'server-data/media'),
  staticDir: path.resolve('dist'),
  accessToken: process.env.STUDIO_ACCESS_TOKEN || undefined,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
});

app.listen(port, '0.0.0.0', () => {
  console.log(`AI Movie Maker Studio backend on http://0.0.0.0:${port}`);
  console.log(
    provider
      ? `Gemini enabled (text: ${provider.models.text}, image: ${provider.models.image}, video: ${provider.models.video})`
      : 'GEMINI_API_KEY not set: AI generation endpoints will answer 503 (no paid API calls).'
  );
});
