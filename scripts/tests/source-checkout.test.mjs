import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

test('every private source checkout uses the dedicated read-only credential without persisting it', () => {
  const checkouts = workflow.split(/^ {6}- /m).filter(step => step.startsWith('uses: actions/checkout@')
    && /^ {10}repository: yorkart\/(?:orbit|orbit-host)$/m.test(step));
  assert.ok(checkouts.length > 0);
  const repositories = new Set();
  for (const step of checkouts) {
    const repository = /^ {10}repository: (.+)$/m.exec(step)[1];
    repositories.add(repository);
    assert.match(step, /^ {10}token: \$\{\{ secrets\.ORBIT_SOURCE_TOKEN \}\}$/m, repository);
    assert.match(step, /^ {10}persist-credentials: false$/m, repository);
  }
  assert.deepEqual([...repositories].sort(), ['yorkart/orbit', 'yorkart/orbit-host']);
});
