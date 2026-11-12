import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceRefs } from '../source-refs.mjs';

const pins = { server: 'a'.repeat(40), host: 'b'.repeat(40) };
test('tag builds select immutable source pins; manual runs can override either source', () => {
  assert.deepEqual(sourceRefs(pins), pins);
  assert.deepEqual(sourceRefs(pins, { server: 'feat/space-session-foundation' }), { ...pins, server: 'feat/space-session-foundation' });
  assert.deepEqual(sourceRefs(pins, { host: 'v2.0.0' }), { ...pins, host: 'v2.0.0' });
});
test('missing pins and output injection are rejected before source checkout', () => {
  assert.throws(() => sourceRefs({ ...pins, host: 'main' }), /immutable host/);
  assert.throws(() => sourceRefs(pins, { server: 'main\nhost=another' }), /Invalid server/);
  assert.throws(() => sourceRefs(pins, { host: '--option' }), /Invalid host/);
});
