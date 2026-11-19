// Test-only decode worker: reports ready, then never answers a job (exercises the 10 s kill).
if (typeof process.send !== 'function') throw new Error('fork me');
process.send({ type: 'ready', envKeys: Object.keys(process.env) });
setInterval(() => undefined, 1_000);
