import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mergedSource, postMergeRefs } from '../merged-source.mjs';
import { githubRequest, integrationResult, reportFailure, resultMarkdown, validationJobs } from '../post-merge-report.mjs';

const server = 'a'.repeat(40), host = 'b'.repeat(40), releaseSha = 'c'.repeat(40);
const source = { repository: 'yorkart/orbit', number: '26', sha: server };
const checks = () => Object.fromEntries(validationJobs.map(name => [name, { result: 'success' }]));
const context = () => ({ source, server, host, checks: checks(), runId: 123, attempt: 1, releaseSha });
const options = { ref: 'refs/heads/main', publish: 'false' };
const failedResult = (attempt = 1) => {
  const input = { ...context(), attempt }; input.checks['server-test'].result = 'failure'; input.checks['joint-integration'].result = 'skipped';
  return integrationResult(input);
};

test('each product merge pins its merged source and selects the other current main, independently of publication pins', () => {
  assert.deepEqual(postMergeRefs(source, options), { server, host: 'main' });
  assert.deepEqual(postMergeRefs({ repository: 'yorkart/orbit-host', number: '16', sha: host }, options), { server: 'main', host });
  assert.equal(postMergeRefs({}, options), null, 'ordinary manual validation retains its own source selection');
  for (const changes of [{ repository: 'fork/orbit' }, { number: '0' }, { number: '1\nserver=evil' }, { sha: 'main' }]) {
    assert.throws(() => mergedSource({ ...source, ...changes }), /Expected/);
  }
  assert.throws(() => mergedSource({ repository: source.repository }), /Expected/);
});

test('post-merge validation cannot publish, use another release branch, or override its merge pair', () => {
  for (const changes of [{ publish: 'true' }, { publish: true }, { ref: 'refs/heads/release-candidates/v1-rc.1' },
    { ref: 'refs/tags/v1-rc.1' }, { ref: 'refs/heads/feature' }, { server: 'other' }, { host: 'old-pin' }]) {
    assert.throws(() => postMergeRefs(source, { ...options, ...changes }), /Post-merge/);
  }
});

test('source selection CLI passes the post-merge inputs through to checkout outputs', t => {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-merge-refs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'outputs');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../source-refs.mjs', import.meta.url))], { encoding: 'utf8', env: {
    ...process.env, GITHUB_OUTPUT: output, GITHUB_REF: options.ref, PUBLISH_REQUEST: 'false',
    SERVER_REF: '', HOST_REF: '', MERGED_REPOSITORY: source.repository, MERGED_PR: source.number, MERGED_SHA: source.sha,
  } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(output, 'utf8'), `server=${server}\nhost=main\n`);
});

test('successful validation records both SHAs and makes no issue API calls', async () => {
  const result = integrationResult(context());
  assert.equal(result.status, 'success');
  assert.deepEqual(result.sources, { server, host });
  assert.equal(result.source.url, 'https://github.com/yorkart/orbit/pull/26');
  assert.match(resultMarkdown(result), /publish=false/);
  await reportFailure(result, () => assert.fail('successful runs must not create issues'));
});

test('a missing or skipped required check cannot report success, while cancellation records without opening an issue', async () => {
  for (const job of validationJobs) {
    const input = context(); delete input.checks[job];
    assert.equal(integrationResult(input).status, 'failure', job);
    input.checks[job] = { result: 'skipped' };
    assert.equal(integrationResult(input).status, 'failure', job);
  }
  const input = context(); input.checks['server-build'].result = 'cancelled'; input.checks['joint-integration'].result = 'skipped';
  const cancelled = integrationResult(input);
  assert.equal(cancelled.status, 'cancelled');
  await reportFailure(cancelled, () => assert.fail('cancellation is not an integration failure'));
  input.checks['server-test'].result = 'failure';
  assert.equal(integrationResult(input).status, 'failure', 'real failures remain actionable even if other jobs were cancelled');
});

test('early resolution failures preserve the triggering SHA and explicitly mark the unresolved peer', () => {
  const input = context(); input.server = ''; input.host = ''; input.checks.resolve.result = 'failure';
  const result = integrationResult(input);
  assert.deepEqual(result.sources, { server, host: null });
  assert.match(resultMarkdown(result), /unresolved \(source selection failed/);
  assert.throws(() => integrationResult({ ...context(), host: '' }), /both source SHAs/);
  assert.throws(() => integrationResult({ ...context(), server: host }), /does not match/);
  assert.throws(() => integrationResult({ ...context(), host: 'main' }), /Invalid resolved/);
});

test('failed validation opens an issue with source revisions, PR, failed steps and log links', async () => {
  const result = failedResult(), calls = [];
  const request = async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (path.includes('/jobs?')) return { jobs: [
      { id: 55, name: 'server-test (macos-26)', conclusion: 'failure', steps: [{ name: 'External Host acceptance', conclusion: 'failure' }] },
      { id: 56, name: 'host-build', conclusion: 'success' },
    ] };
    if (method === 'GET') return [];
    return { html_url: 'https://github.com/yorkart/orbit-release/issues/9' };
  };
  await reportFailure(result, request);
  const write = calls.find(call => call.method === 'POST');
  assert.equal(write.path, '/repos/yorkart/orbit-release/issues');
  assert.match(write.body.body, new RegExp(server));
  assert.match(write.body.body, new RegExp(host));
  assert.match(write.body.body, /orbit\/pull\/26/);
  assert.match(write.body.body, /runs\/123\/attempts\/1/);
  assert.match(write.body.body, /runs\/123\/job\/55/);
  assert.match(write.body.body, /External Host acceptance/);
  assert.equal(result.issue_url, 'https://github.com/yorkart/orbit-release/issues/9');
});

test('reruns find their own issue across pages, ignore PRs and update rather than duplicate it', async () => {
  const result = failedResult(2);
  const marker = `<!-- orbit-post-merge:${source.repository}:${source.number}:${source.sha} -->`;
  const calls = [];
  await reportFailure(result, async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (path.includes('/jobs?')) return { jobs: path.endsWith('page=1')
      ? Array.from({ length: 100 }, (_, id) => ({ id, conclusion: 'success' }))
      : [{ id: 111, name: 'build', conclusion: 'timed_out', steps: [] }] };
    if (method === 'GET') return path.endsWith('page=1')
      ? Array.from({ length: 100 }, () => ({ number: 100, pull_request: {}, body: marker }))
      : [{ number: 9, state: 'closed', body: marker }];
    return { html_url: 'https://github.com/yorkart/orbit-release/issues/9' };
  });
  const writes = calls.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].path, '/repos/yorkart/orbit-release/issues/9');
  assert.equal(writes[0].body.state, 'open');
  assert.match(writes[0].body.body, /attempts\/2/);
  assert.equal(result.failed_jobs[0].conclusion, 'timed_out');
});

test('report API errors fail visibly and never expose credentials', async () => {
  assert.throws(() => githubRequest(''), /GITHUB_TOKEN/);
  const request = githubRequest('secret-must-not-appear', async () => new Response(null, { status: 403 }));
  await assert.rejects(request('/repos/yorkart/orbit-release/issues'), error => {
    assert.match(error.message, /HTTP 403/); assert.doesNotMatch(error.message, /secret-must-not-appear/); return true;
  });
});

test('the reporter preserves a machine-readable result even if issue reporting fails', t => {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-merge-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = context(); input.checks['server-test'].result = 'failure';
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../post-merge-report.mjs', import.meta.url))], { cwd: directory, encoding: 'utf8', env: {
    ...process.env, GITHUB_TOKEN: '', GITHUB_STEP_SUMMARY: join(directory, 'summary'),
    MERGED_REPOSITORY: source.repository, MERGED_PR: source.number, MERGED_SHA: source.sha,
    SERVER_REVISION: server, HOST_REVISION: host, CHECK_RESULTS: JSON.stringify(input.checks),
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: releaseSha,
  } });
  assert.notEqual(child.status, 0);
  const result = JSON.parse(readFileSync(join(directory, 'target/post-merge-result.json'), 'utf8'));
  assert.equal(result.status, 'failure');
  assert.deepEqual(result.sources, { server, host });
  assert.match(readFileSync(join(directory, 'summary'), 'utf8'), /Post-merge joint integration/);
});

test('the reporting job covers every validation dependency and remains active after upstream failure', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const reporter = workflow.split('  post-merge-result:\n')[1];
  assert.match(reporter, /if: always\(\) && inputs\.merged_repository != ''/);
  assert.deepEqual(/needs: \[([^\]]+)\]/.exec(reporter)[1].split(', ').sort(), [...validationJobs].sort());
  assert.match(reporter, /issues: write/);
  assert.match(reporter, /actions: read/);
  assert.match(reporter, /if: always\(\)\s+uses: actions\/upload-artifact@/);
  assert.match(workflow, /group:.*orbit-post-merge-/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.ok(workflow.indexOf("printf 'server=") < workflow.indexOf('cmp orbit/.node-version'), 'source SHAs survive compatibility failures');
});
