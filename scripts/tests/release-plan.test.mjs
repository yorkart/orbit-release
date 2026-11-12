import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePlan } from '../release-plan.mjs';

test('unpublished source-pair validation runs Linux and ARM Mac without a public Host release', () => {
  for (const ref of ['refs/heads/main', 'refs/heads/integration-validation/concurrent-feature']) {
    const plan = releasePlan(ref);
    assert.equal(plan.publishing, false);
    assert.deepEqual(plan.matrix.include.map(item => item.platform), ['linux-x86_64', 'macos-aarch64']);
    assert.equal(plan.matrix.include[1].runner, 'macos-26');
  }
});

test('every publication requires the complete four-platform matrix', () => {
  for (const [ref, manual] of [['refs/heads/main', true], ['refs/tags/v1-rc.1', false], ['refs/heads/release-candidates/v1-rc.1', false]]) {
    const plan = releasePlan(ref, manual);
    assert.equal(plan.publishing, true);
    assert.equal(plan.matrix.include.length, 4);
    assert.equal(new Set(plan.matrix.include.map(item => item.platform)).size, 4);
  }
  assert.throws(() => releasePlan('refs/heads/work', true), /requires main/);
});
