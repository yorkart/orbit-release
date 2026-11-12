import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function integrationProof({ server, host, version, input, platforms, nodeVersion }) {
  if (![server, host].every(sha => /^[a-f0-9]{40}$/.test(sha)) || !/^v[0-9][A-Za-z0-9._-]*$/.test(version)) throw new Error('Invalid source pair');
  if (!platforms.includes('linux-x86_64') || !platforms.includes('macos-aarch64')) throw new Error('Joint validation requires Linux and macOS');
  const packages = [];
  let api, daemon;
  for (const platform of platforms) {
    for (const [role, asset, revision] of [['server', `orbit-${platform}.tar.gz`, server], ['host', `orbit-host-${version}-${platform}.tar.gz`, host]]) {
      const path = join(input, asset);
      const manifest = JSON.parse(execFileSync('tar', ['-xOzf', path, './manifest.json'], { encoding: 'utf8' }));
      if (manifest.git_revision !== revision || manifest.release_id !== version || manifest.git_dirty
          || manifest.runtime?.version !== nodeVersion || `${manifest.platform?.os}-${manifest.platform?.arch}` !== platform) {
        throw new Error(`Package does not match the tested source pair: ${asset}`);
      }
      if (role === 'host') {
        if (!Number.isInteger(manifest.api_version) || manifest.api_version < 1 || typeof manifest.daemon_version !== 'string'
            || (api != null && (api !== manifest.api_version || daemon !== manifest.daemon_version))) throw new Error('Host packages disagree on the wire contract');
        api = manifest.api_version; daemon = manifest.daemon_version;
      }
      packages.push({ role, platform, asset, revision, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
  }
  if (new Set(platforms).size !== platforms.length || packages.length !== readdirSync(input).filter(name => name.endsWith('.tar.gz')).length) throw new Error('Incomplete or unexpected package matrix');
  return { version, sources: { server: { repository: 'yorkart/orbit', revision: server }, host: { repository: 'yorkart/orbit-host', revision: host } },
    host_api_version: api, host_daemon_version: daemon, packages };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [server, host, version, input, output, matrix] = process.argv.slice(2);
  const platforms = JSON.parse(matrix).include.map(item => item.platform);
  const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
  writeFileSync(output, `${JSON.stringify(integrationProof({ server, host, version, input, platforms, nodeVersion }), null, 2)}\n`);
}
