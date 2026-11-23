import 'dotenv/config';
import { createApp } from './app';
import { buildOptionsFromEnv, ConfigError } from './config';

let options;
try {
  options = buildOptionsFromEnv();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const port = Number(process.env.PORT || 8787);
// Without sign-in (development) only this computer may connect. Cloud Run (sign-in required) listens on all interfaces.
const host = options.auth.mode === 'none' ? process.env.HOST || '127.0.0.1' : '0.0.0.0';
createApp(options).listen(port, host, () => {
  console.log(`AI Movie Maker Studio backend on http://${host}:${port}`);
  console.log(`Auth: ${options.auth.mode} · Storage: ${options.blobStore.kind} · Firestore: ${options.projectStore ? 'on' : 'off'}`);
  console.log(
    options.provider
      ? `Gemini enabled (text: ${options.provider.models.text}, image: ${options.provider.models.image}, video: ${options.provider.models.video})`
      : 'GEMINI_API_KEY not set: AI generation endpoints answer 503 (no paid API calls).'
  );
  for (const w of options.warnings ?? []) console.warn(`Warning: ${w}`);
});
