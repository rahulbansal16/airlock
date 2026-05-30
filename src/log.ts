const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a: unknown[]) => console.log(`\x1b[2m${ts()}\x1b[0m`, ...a),
  warn: (...a: unknown[]) => console.warn(`\x1b[33m${ts()} warn\x1b[0m`, ...a),
  error: (...a: unknown[]) => console.error(`\x1b[31m${ts()} err \x1b[0m`, ...a),
  ok: (...a: unknown[]) => console.log(`\x1b[32m${ts()}\x1b[0m`, ...a),
};
