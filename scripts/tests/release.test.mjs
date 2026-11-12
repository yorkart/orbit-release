import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { platforms, prepareRelease } from '../prepare-release.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'packages'); mkdirSync(input);
  const version = 'v2026-test';
  const sources = {};
  for (const role of ['server', 'host']) {
    const source = join(directory, role); sources[role] = source;
    mkdirSync(join(source, 'scripts'), { recursive: true });
    writeFileSync(join(source, '.node-version'), '24.22.2\n');
    // This fixture models a product-owned validator. The bridge must use the
    // checkout's implementation and pass that checkout's own revision to it.
    writeFileSync(join(source, 'scripts/prepare-github-release.mjs'), `
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function prepareGitHubRelease({version, revision, inputDir, outputDir}) {
  mkdirSync(outputDir);
  for (const platform of ${JSON.stringify(platforms)}) {
    const name = ${JSON.stringify(role)} === 'server' ? 'aow-' + platform + '.tar.gz' : 'orbit-host-' + version + '-' + platform + '.tar.gz';
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', join(inputDir,name), './manifest.json'], {encoding:'utf8'}));
    if (manifest.git_revision !== revision) throw new Error('wrong source revision');
    copyFileSync(join(inputDir,name), join(outputDir,name));
  }
  writeFileSync(join(outputDir, ${JSON.stringify(role === 'server' ? 'aow-install.sh' : 'install.sh')}), '#!/bin/bash\\n# product installer\\nexit 0\\n');
}
`);
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', role]]) {
      execFileSync('git', args, { cwd: source });
    }
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    for (const platform of platforms) {
      const bundle = join(directory, `${role}-${platform}`); mkdirSync(bundle);
      writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ git_revision: revision, runtime: { version: '24.22.2' } }));
      const name = role === 'server' ? `aow-${platform}.tar.gz` : `orbit-host-${version}-${platform}.tar.gz`;
      execFileSync('tar', ['-czf', join(input, name), '-C', bundle, '.']);
    }
  }
  return { directory, version, revision: 'a'.repeat(40), repository: 'fork/release', ...sources, input, output: join(directory, 'output') };
}

test('assembly uses both product validators and records eight independently versioned source assets', async t => {
  const f = fixture(t); await prepareRelease(f);
  const release = JSON.parse(readFileSync(join(f.output, 'release.json')));
  assert.equal(release.packages.length, 8);
  assert.notEqual(release.sources.server.revision, release.sources.host.revision);
  assert.equal(release.revision, f.revision);
  const sums = readFileSync(join(f.output, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.equal(sums.length, readdirSync(f.output).length - 1);
  for (const line of sums) {
    const [hash, name] = line.split('  ');
    assert.equal(createHash('sha256').update(readFileSync(join(f.output, name))).digest('hex'), hash);
  }
  assert.match(readFileSync(join(f.output, 'orbit-install.sh'), 'utf8'), /DEFAULT_VERSION='v2026-test'/);
  assert.match(readFileSync(join(f.output, 'aow-install.sh'), 'utf8'), /DEFAULT_ROLE='server'/);
  assert.match(readFileSync(join(f.output, 'install.sh'), 'utf8'), /DEFAULT_ROLE='host'/);
  assert.match(readFileSync(join(f.output, 'server-installer.sh'), 'utf8'), /product installer/);
  await assert.rejects(prepareRelease(f), /already exists/);
});

test('incompatible runtime pins and incomplete platform matrices cannot produce a release', async t => {
  const f = fixture(t);
  writeFileSync(join(f.host, '.node-version'), '26.13.0\n');
  await assert.rejects(prepareRelease(f), /same Node version/);
  assert.equal(existsSync(f.output), false);
  writeFileSync(join(f.host, '.node-version'), '24.22.2\n');
  rmSync(join(f.input, `orbit-host-${f.version}-macos-aarch64.tar.gz`));
  await assert.rejects(prepareRelease(f));
  assert.equal(existsSync(f.output), false);
  assert.equal(readdirSync(f.directory).some(name => name.startsWith('output.pending-')), false);
});

test('publication verifies uploaded assets before publishing and rejects published versions', async t => {
  const f = fixture(t); await prepareRelease(f);
  const tools = join(f.directory, 'tools'); mkdirSync(tools);
  writeFileSync(join(tools, 'gh'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$LOG"
case "$2" in
  view) if [[ \${PUBLISHED:-0} == 1 ]]; then printf '{"isDraft":false,"targetCommitish":"%s"}' "$REVISION"; else exit 1; fi ;;
  download) cp "$ASSETS/"* "$5/" ;;
esac
`, { mode: 0o755 });
  const log = join(f.directory, 'gh.log');
  const run = extra => spawnSync('bash', [join(root, 'scripts/publish-release.sh'), f.version, f.revision, f.output], {
    encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, LOG: log,
      ASSETS: f.output, REVISION: f.revision, GH_REPO: f.repository, ...extra },
  });
  const result = run({}); assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.ok(calls.indexOf('release download') < calls.indexOf('release edit'));
  writeFileSync(log, '');
  assert.notEqual(run({ PUBLISHED: '1' }).status, 0);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /release upload|release edit/);
});
