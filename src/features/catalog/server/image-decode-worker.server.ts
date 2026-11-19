// Entry point of one decode worker (SD-216, INF-201; plan Step 44). Forked by the image-helper
// supervisor with an env of exactly { UV_THREADPOOL_SIZE: '2' } and advanced serialisation, so the
// image bytes cross the IPC channel as a Uint8Array. One job at a time; the supervisor enforces the
// 10 s kill and the 256 MB watchdog from outside, so this file has no limits of its own.
import type { ImageFormat } from '../domain/image.ts';

// INF-203 check 2 input: the env KEYS this process received, captured before sharp loads (libvips
// adds VIPSHOME to its own process env when it initialises, which is not something it received).
const receivedEnvKeys = Object.keys(process.env);
const { configureSharpForWorker, decodeImage } = await import('./image-decode.server.ts');

type JobMessage = { type: 'job'; jobId: string; bytes: Uint8Array; sniffedFormat: ImageFormat };

if (typeof process.send !== 'function') {
  throw new Error('the decode worker must be forked by the image helper');
}
const send = process.send.bind(process);

configureSharpForWorker();

process.on('message', (message: JobMessage) => {
  if (message?.type !== 'job') return;
  void decodeImage(message.bytes, message.sniffedFormat).then((result) =>
    send({ type: 'result', jobId: message.jobId, result }),
  );
});

// The worker reports its received env keys (never values) once it is up.
send({ type: 'ready', envKeys: receivedEnvKeys });
