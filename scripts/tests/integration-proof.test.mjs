import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { integrationProof } from '../integration-proof.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-joint-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'packages'); mkdirSync(input);
  const spec = { server: 'a'.repeat(40), host: 'b'.repeat(40), version: 'v1-validation', input,
    platforms: ['linux-x86_64', 'macos-aarch64'], nodeVersion: '24.22.2' };
  const pack = (role, platform, changes = {}) => {
    const bundle = join(directory, `${role}-${platform}`); mkdirSync(bundle, { recursive: true });
    const [os, arch] = platform.split('-');
    writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ git_revision: spec[role], release_id: spec.version,
      git_dirty: false, runtime: { version: spec.nodeVersion }, platform: { os, arch }, api_version: 2, daemon_version: '0.1.0', ...changes }));
    const asset = role === 'server' ? `orbit-${platform}.tar.gz` : `orbit-host-${spec.version}-${platform}.tar.gz`;
    execFileSync('tar', ['-czf', join(input, asset), '-C', bundle, '.']);
    return asset;
  };
  for (const platform of spec.platforms) for (const role of ['server', 'host']) pack(role, platform);
  return { spec, pack };
}

test('joint proof records the exact unmerged source pair and actual archive digests', t => {
  const { spec } = fixture(t), proof = integrationProof(spec);
  assert.equal(proof.sources.server.revision, spec.server);
  assert.equal(proof.sources.host.revision, spec.host);
  assert.equal(proof.packages.length, 4);
  for (const asset of proof.packages) assert.equal(asset.sha256, createHash('sha256').update(readFileSync(join(spec.input, asset.asset))).digest('hex'));
});

test('mixed revisions, runtimes, platforms and wire versions cannot generate a valid pair', t => {
  for (const change of [{ git_revision: 'c'.repeat(40) }, { git_dirty: true }, { runtime: { version: '26.0.0' } },
    { platform: { os: 'linux', arch: 'aarch64' } }, { api_version: 3 }]) {
    const { spec, pack } = fixture(t);
    pack('host', 'macos-aarch64', change);
    assert.throws(() => integrationProof(spec), /source pair|wire contract/);
  }
});

test('incomplete matrices and unexpected packages cannot be reported as jointly tested', t => {
  const { spec, pack } = fixture(t);
  assert.throws(() => integrationProof({ ...spec, platforms: ['linux-x86_64'] }), /Linux and macOS/);
  pack('server', 'linux-aarch64');
  assert.throws(() => integrationProof(spec), /unexpected package matrix/);
});
