/**
 * TEST-ONLY server for the end-to-end UI test: the real Express app + the built
 * frontend, but with a stub AI provider so no paid API is called.
 */
import path from 'node:path';
import { createApp } from '../server/app';
import { createStubProvider, makeTestClip, tempDir } from './helpers';

const dir = tempDir('e2e-');
const clip = makeTestClip(dir, 'clip.mp4', 'blue');
const { provider, resetPolls } = createStubProvider(clip);
// Each new video job should take one "running" poll before completing.
const wrapped = {
  ...provider,
  async startVideo(req: Parameters<typeof provider.startVideo>[0]) {
    resetPolls();
    return provider.startVideo(req);
  },
};
const app = createApp({
  provider: process.env.STUB_NO_PROVIDER ? null : wrapped,
  mediaDir: path.join(dir, 'media'),
  staticDir: path.resolve('dist'),
});
const port = Number(process.env.PORT || 8799);
app.listen(port, () => console.log(`stub server ready on ${port}`));
