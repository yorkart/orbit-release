import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sourceRefs(pins, overrides = {}) {
  const refs = {};
  for (const role of ['server', 'host']) {
    if (!/^[a-f0-9]{40}$/.test(pins[role] ?? '')) throw new Error(`Missing immutable ${role} source pin`);
    const ref = overrides[role] || pins[role];
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) throw new Error(`Invalid ${role} source ref`);
    refs[role] = ref;
  }
  return refs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pins = JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8'));
  const refs = sourceRefs(pins, { server: process.env.SERVER_REF, host: process.env.HOST_REF });
  appendFileSync(process.env.GITHUB_OUTPUT, `server=${refs.server}\nhost=${refs.host}\n`);
}
