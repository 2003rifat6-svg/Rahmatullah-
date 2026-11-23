/**
 * Starts the official Cloud Firestore emulator (Java) and fake-gcs-server (GCS API emulator)
 * for integration tests. The real @google-cloud/firestore and @google-cloud/storage clients
 * talk to them exactly like they talk to Google Cloud.
 *
 * Setup (one time):
 *   npx firebase-tools setup:emulators:firestore           # downloads the Firestore emulator jar
 *   go install github.com/fsouza/fake-gcs-server@v1.52.2   # GCS emulator
 * Override paths with FIRESTORE_EMULATOR_JAR and FAKE_GCS_BIN.
 */
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function findJar(): string | null {
  if (process.env.FIRESTORE_EMULATOR_JAR) return process.env.FIRESTORE_EMULATOR_JAR;
  const dir = path.join(os.homedir(), '.cache/firebase/emulators');
  if (!fs.existsSync(dir)) return null;
  const jar = fs.readdirSync(dir).filter((f) => /^cloud-firestore-emulator.*\.jar$/.test(f)).sort().pop();
  return jar ? path.join(dir, jar) : null;
}

function findFakeGcs(): string | null {
  const p = process.env.FAKE_GCS_BIN || path.join(os.homedir(), 'go/bin/fake-gcs-server');
  return fs.existsSync(p) ? p : null;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitHttp(url: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Emulator did not start: ${url}`);
}

export interface Emulators {
  firestoreHost: string;
  gcsEndpoint: string;
  stop: () => void;
}

export function emulatorsAvailable(): string | null {
  if (!findJar()) return 'Firestore emulator jar not found (npx firebase-tools setup:emulators:firestore)';
  if (!findFakeGcs()) return 'fake-gcs-server not found (go install github.com/fsouza/fake-gcs-server@v1.52.2)';
  return null;
}

export async function startEmulators(): Promise<Emulators> {
  const procs: ChildProcess[] = [];
  const fsPort = await freePort();
  const gcsPort = await freePort();
  procs.push(
    spawn('java', ['-jar', findJar()!, '--host=127.0.0.1', `--port=${fsPort}`], { stdio: 'ignore' }),
    spawn(findFakeGcs()!, ['-scheme', 'http', '-host', '127.0.0.1', '-port', String(gcsPort), '-backend', 'memory', '-public-host', `127.0.0.1:${gcsPort}`], {
      stdio: 'ignore',
    })
  );
  const stop = () => procs.forEach((p) => p.kill('SIGKILL'));
  try {
    await waitHttp(`http://127.0.0.1:${fsPort}/`);
    await waitHttp(`http://127.0.0.1:${gcsPort}/storage/v1/b`);
  } catch (err) {
    stop();
    throw err;
  }
  return { firestoreHost: `127.0.0.1:${fsPort}`, gcsEndpoint: `http://127.0.0.1:${gcsPort}`, stop };
}
