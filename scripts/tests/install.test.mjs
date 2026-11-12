import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'orbit-bridge-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const tools = join(home, 'tools'), assets = join(home, 'assets');
  mkdirSync(tools); mkdirSync(assets);
  const put = (name, content) => writeFileSync(join(assets, name), content);
  put('orbit-install.sh', readFileSync(join(root, 'install.sh')));
  put('orbit-update', readFileSync(join(root, 'scripts/orbit-update')));
  for (const role of ['server', 'host']) put(`${role}-installer.sh`, `#!/bin/bash
printf '%s\\n' '${role}' "$@" >> "$HOME/installed"
printf '%s\\n' "\${ORBIT_USER_BIN_DIR:-}" > "$HOME/user-bin"
exit "\${INSTALL_STATUS:-0}"
`);
  const sums = () => put('SHA256SUMS', ['server-installer.sh', 'host-installer.sh', 'orbit-update'].map(name =>
    `${createHash('sha256').update(readFileSync(join(assets, name))).digest('hex')}  ${name}\n`).join(''));
  sums();
  writeFileSync(join(tools, 'curl'), `#!/bin/bash
set -eu
output='' url='' head=0
while (( $# )); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --head) head=1; shift ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$HOME/downloads"
[[ \${FAIL_DOWNLOAD:-0} == 0 ]] || exit 22
if (( head )); then printf '%s/tag/v2.0.0' "\${url%/latest}"; exit; fi
cp "$HOME/assets/\${url##*/}" "$output"
`, { mode: 0o755 });
  const run = (script, args, extra = {}) => spawnSync('bash', [join(root, script), ...args], {
    env: { ...process.env, HOME: home, PATH: `${tools}:${process.env.PATH}`, ORBIT_RELEASE_REPOSITORY: '',
      ORBIT_INSTALL_ROOT: '', ORBIT_USER_BIN_DIR: '', ...extra }, encoding: 'utf8', timeout: 10000,
  });
  const saved = (role, repository) => {
    const directory = join(home, '.local/lib', role === 'server' ? 'orbit' : 'orbit-host');
    const runtime = join(directory, role === 'server' ? 'latest/backend/node' : 'current/runtime/node');
    mkdirSync(dirname(runtime), { recursive: true }); symlinkSync(process.execPath, runtime);
    writeFileSync(join(directory, role === 'server' ? 'update.json' : 'installation.json'), JSON.stringify({ repository, user_bin_dir: `${home}/custom bin` }));
  };
  return { home, assets, put, sums, run, saved, read: name => readFileSync(join(home, name), 'utf8') };
}

for (const role of ['server', 'host']) {
  test(`one-click ${role} install verifies and delegates to only that product`, t => {
    const f = fixture(t);
    const result = f.run('install.sh', ['--role', role]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.read('installed'), `${role}\n--repo\nyorkart/orbit-release\n--version\nv2.0.0\n`);
    assert.ok(existsSync(join(f.home, '.local/lib/orbit-release/bin/orbit-update')));
    assert.equal(f.read('downloads').match(/\/latest\n/g)?.length, 1);
    assert.ok(f.read('downloads').includes('/download/v2.0.0/SHA256SUMS'));
  });
}

test('explicit version and host options are forwarded without resolving latest', t => {
  const f = fixture(t);
  const result = f.run('install.sh', ['--role', 'host', '--version', 'v1.0.0', '--repo', 'fork/releases', '--no-start', '--state-dir', '/a state']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read('installed'), /--no-start\n--state-dir\n\/a state/);
  assert.doesNotMatch(f.read('downloads'), /latest/);
  assert.match(f.read('downloads'), /fork\/releases\/releases\/download\/v1.0.0/);
});

for (const failure of ['checksum', 'duplicate', 'download', 'install']) {
  test(`${failure} failure cannot replace the installed update tool`, t => {
    const f = fixture(t);
    const tool = join(f.home, '.local/lib/orbit-release/bin/orbit-update');
    mkdirSync(dirname(tool), { recursive: true }); writeFileSync(tool, 'old updater');
    if (failure === 'checksum') f.put('server-installer.sh', '#!/bin/bash\nexit 0\n');
    if (failure === 'duplicate') f.put('SHA256SUMS', f.read('assets/SHA256SUMS').repeat(2));
    const result = f.run('install.sh', ['--role', 'server'], failure === 'download' ? { FAIL_DOWNLOAD: '1' } : failure === 'install' ? { INSTALL_STATUS: '19' } : {});
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(tool, 'utf8'), 'old updater');
    if (failure !== 'install') assert.equal(existsSync(join(f.home, 'installed')), false);
  });
}

test('update migrates legacy repository and preserves a custom command directory', t => {
  const f = fixture(t); f.saved('server', 'yorkart/orbit');
  const result = f.run('scripts/orbit-update', ['--role', 'server']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read('downloads'), /^https:\/\/github.com\/yorkart\/orbit-release\//);
  assert.equal(f.read('user-bin'), `${f.home}/custom bin\n`);
});

test('update uses the saved fork and pins the bootstrap to an explicit version', t => {
  const f = fixture(t); f.saved('host', 'fork/releases');
  const result = f.run('scripts/orbit-update', ['--role', 'host', '--version', 'v1.0.0']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read('downloads'), /^https:\/\/github.com\/fork\/releases\/releases\/download\/v1.0.0\/orbit-install.sh/);
  assert.doesNotMatch(f.read('downloads'), /latest/);
});

test('explicit update repository overrides environment and saved settings', t => {
  const f = fixture(t); f.saved('server', 'saved/release');
  const result = f.run('scripts/orbit-update', ['--repo', 'chosen/release', '--version', 'v3.0.0'], {
    ORBIT_RELEASE_REPOSITORY: 'environment/release',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.read('downloads'), /chosen\/release/);
  assert.doesNotMatch(f.read('downloads'), /saved\/release|environment\/release/);
});

for (const content of ['', 'if\n']) {
  test(`update rejects an ${content ? 'invalid' : 'empty'} downloaded installer before installation`, t => {
    const f = fixture(t); f.saved('server', 'yorkart/orbit-release');
    const before = f.read('.local/lib/orbit/update.json');
    f.put('orbit-install.sh', content);
    assert.notEqual(f.run('scripts/orbit-update', ['--repo', 'replacement/release']).status, 0);
    assert.equal(f.read('.local/lib/orbit/update.json'), before);
    assert.equal(existsSync(join(f.home, 'installed')), false);
  });
}

test('invalid update arguments and help do not download or mutate services', t => {
  const f = fixture(t);
  for (const args of [['--version', '../bad'], ['--repo', 'file:///bad'], ['--role', 'other'], ['--version']]) {
    assert.notEqual(f.run('scripts/orbit-update', args).status, 0);
  }
  assert.equal(f.run('scripts/orbit-update', ['--help']).status, 0);
  assert.equal(existsSync(join(f.home, 'downloads')), false);
  assert.equal(existsSync(join(f.home, 'installed')), false);
});
