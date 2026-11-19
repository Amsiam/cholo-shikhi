// Test-only decode worker: reports ready, then exits on the first job (exercises RD-210 restart).
if (typeof process.send !== 'function') throw new Error('fork me');
process.on('message', () => process.exit(3));
process.send({ type: 'ready', envKeys: Object.keys(process.env) });
