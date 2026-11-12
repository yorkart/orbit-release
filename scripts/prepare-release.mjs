import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const platforms = ['linux-x86_64', 'linux-aarch64', 'macos-x86_64', 'macos-aarch64'];
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export async function prepareRelease({ version, revision, repository, server, host, input, output }) {
  if (!/^v[0-9][A-Za-z0-9._-]*$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(revision ?? '')
      || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid release identity');
  const source = directory => ({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
    node: readFileSync(join(directory, '.node-version'), 'utf8').trim() });
  const serverSource = source(server), hostSource = source(host);
  if (serverSource.node !== hostSource.node) throw new Error('Server and Host must pin the same Node version');
  output = resolve(output);
  if (existsSync(output)) throw new Error('Output already exists');
  mkdirSync(dirname(output), { recursive: true });
  const stage = mkdtempSync(`${output}.pending-`);
  try {
    // Product repositories own archive formats and provenance validation.
    const serverTools = await import(pathToFileURL(join(server, 'scripts/prepare-github-release.mjs')));
    const hostTools = await import(pathToFileURL(join(host, 'scripts/prepare-github-release.mjs')));
    for (const [role, tools, spec] of [['server', serverTools, serverSource], ['host', hostTools, hostSource]]) {
      await tools.prepareGitHubRelease({ version, revision: spec.revision, repository,
        inputDir: resolve(input), outputDir: join(stage, role) });
      for (const name of readdirSync(join(stage, role))) {
        if (name.endsWith('.tar.gz')) copyFileSync(join(stage, role, name), join(stage, name));
      }
    }
    copyFileSync(join(stage, 'server/orbit-install.sh'), join(stage, 'server-installer.sh'));
    copyFileSync(join(stage, 'host/install.sh'), join(stage, 'host-installer.sh'));
    for (const role of ['server', 'host']) rmSync(join(stage, role), { recursive: true });
    const packages = [];
    const hostPin = { repository, version, revision: hostSource.revision, platforms: {} };
    for (const platform of platforms) {
      for (const [role, name, spec] of [['server', `orbit-${platform}.tar.gz`, serverSource],
        ['host', `orbit-host-${version}-${platform}.tar.gz`, hostSource]]) {
        const manifest = JSON.parse(execFileSync('tar', ['-xOzf', join(stage, name), './manifest.json'], { encoding: 'utf8' }));
        if (manifest.runtime?.version !== spec.node) throw new Error(`Runtime pin mismatch: ${name}`);
        const sha256 = hash(join(stage, name));
        writeFileSync(join(stage, `${name}.sha256`), `${sha256}  ${name}\n`);
        packages.push({ role, platform, asset: name, sha256, revision: spec.revision });
        if (role === 'host') {
          if (!Number.isInteger(manifest.api_version) || manifest.api_version < 1 || typeof manifest.daemon_version !== 'string'
              || (hostPin.api_version != null && (manifest.api_version !== hostPin.api_version || manifest.daemon_version !== hostPin.daemon_version))) {
            throw new Error('Host platforms disagree on the wire contract');
          }
          hostPin.api_version = manifest.api_version;
          hostPin.daemon_version = manifest.daemon_version;
          hostPin.platforms[platform] = { asset: name, sha256 };
        }
      }
    }
    const installer = readFileSync(join(root, 'install.sh'), 'utf8')
      .replace(/^DEFAULT_REPOSITORY=.*$/m, `DEFAULT_REPOSITORY='${repository}'`)
      .replace(/^DEFAULT_VERSION=.*$/m, `DEFAULT_VERSION='${version}'`);
    for (const [name, role] of [['orbit-install.sh', ''], ['install.sh', 'host']]) {
      writeFileSync(join(stage, name), installer.replace(/^DEFAULT_ROLE=.*$/m, `DEFAULT_ROLE='${role}'`), { mode: 0o755 });
      execFileSync('bash', ['-n', join(stage, name)]);
    }
    copyFileSync(join(root, 'scripts/orbit-update'), join(stage, 'orbit-update'));
    writeFileSync(join(stage, 'host-release.json'), `${JSON.stringify(hostPin, null, 2)}\n`);
    writeFileSync(join(stage, 'release.json'), `${JSON.stringify({ version, revision, repository,
      sources: { server: { repository: 'yorkart/orbit', ...serverSource }, host: { repository: 'yorkart/orbit-host', ...hostSource } },
      packages }, null, 2)}\n`);
    writeFileSync(join(stage, 'SHA256SUMS'), readdirSync(stage).sort().map(name => `${hash(join(stage, name))}  ${name}\n`).join(''));
    renameSync(stage, output);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, revision, repository, server, host, input, output] = process.argv.slice(2);
  if (process.argv.length !== 9) throw new Error('Usage: prepare-release.mjs VERSION SHA REPO SERVER_DIR HOST_DIR INPUT OUTPUT');
  await prepareRelease({ version, revision, repository, server: resolve(server), host: resolve(host), input, output });
}
