import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergedSource } from './merged-source.mjs';

const repository = 'yorkart/orbit-release';
export const validationJobs = ['tooling', 'resolve', 'server-lint', 'server-test', 'server-test-scripts',
  'server-frontend', 'host-lint', 'host-test', 'server-build', 'host-build', 'joint-integration'];
const failures = new Set(['failure', 'timed_out', 'action_required', 'startup_failure', 'stale']);

export function integrationResult({ source, server, host, checks, runId, attempt, releaseSha }) {
  const merged = mergedSource(source);
  if (!merged || !/^[1-9][0-9]*$/.test(String(runId)) || !/^[1-9][0-9]*$/.test(String(attempt))
      || !/^[a-f0-9]{40}$/.test(releaseSha ?? '')) throw new Error('Invalid post-merge result context');
  const statuses = validationJobs.map(name => checks[name]?.result ?? 'missing');
  const status = statuses.every(result => result === 'success') ? 'success'
    : statuses.includes('failure') ? 'failure' : statuses.includes('cancelled') ? 'cancelled' : 'failure';
  const sources = { server: server || (merged.role === 'server' ? merged.sha : null),
    host: host || (merged.role === 'host' ? merged.sha : null) };
  for (const sha of Object.values(sources)) if (sha !== null && !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid resolved source SHA');
  if (sources[merged.role] !== merged.sha) throw new Error('Resolved source does not match merged SHA');
  if (status === 'success' && (!sources.server || !sources.host)) throw new Error('Successful validation must record both source SHAs');
  return { schema_version: 1, status, source: merged, sources,
    run: { id: String(runId), attempt: Number(attempt), url: `https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`, release_sha: releaseSha },
    checks: Object.fromEntries(validationJobs.map((name, i) => [name, statuses[i]])), failed_jobs: [] };
}

export function githubRequest(token, fetchImpl = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN is required to report post-merge integration');
  return async (path, method = 'GET', body) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Post-merge report ${method} failed: HTTP ${response.status}`);
    return response.json();
  };
}

function issueMarker(result) {
  return `<!-- orbit-post-merge:${result.source.repository}:${result.source.number}:${result.source.sha} -->`;
}

export function resultMarkdown(result) {
  const revisions = Object.entries(result.sources).map(([role, sha]) => {
    const product = role === 'server' ? 'orbit' : 'orbit-host';
    return `- ${role}: ${sha ? `[\`${sha}\`](https://github.com/yorkart/${product}/commit/${sha})` : 'unresolved (source selection failed; see logs)'}`;
  });
  const failed = result.failed_jobs.map(job => `- [${job.name}](${job.url}): ${job.conclusion}${job.steps.length ? ` — ${job.steps.join(', ')}` : ''}`);
  return [`Post-merge joint integration: **${result.status}**`, '',
    `Source PR: [${result.source.repository}#${result.source.number}](${result.source.url})`,
    `Merged commit: \`${result.source.sha}\``, '', ...revisions, '',
    `[Actions logs, attempt ${result.run.attempt}](${result.run.url})`,
    `Release workflow commit: \`${result.run.release_sha}\``, '',
    ...(failed.length ? ['Failed jobs and steps:', '', ...failed, ''] : []),
    'Check results:', '', ...Object.entries(result.checks).map(([name, status]) => `- ${name}: ${status}`), '',
    'This validation uses publish=false and does not create a release.', issueMarker(result), ''].join('\n');
}

export async function reportFailure(result, request) {
  if (result.status !== 'failure') return;
  for (let page = 1; ; page++) {
    const { jobs } = await request(`/repos/${repository}/actions/runs/${result.run.id}/jobs?filter=latest&per_page=100&page=${page}`);
    result.failed_jobs.push(...jobs.filter(job => failures.has(job.conclusion)).map(job => ({
      name: job.name, conclusion: job.conclusion,
      url: `https://github.com/${repository}/actions/runs/${result.run.id}/job/${job.id}`,
      steps: (job.steps ?? []).filter(step => failures.has(step.conclusion)).map(step => step.name),
    })));
    if (jobs.length < 100) break;
  }
  let existing;
  for (let page = 1; ; page++) {
    const issues = await request(`/repos/${repository}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
    existing = issues.find(issue => !issue.pull_request && issue.body?.includes(issueMarker(result)));
    if (existing || issues.length < 100) break;
  }
  const body = { title: `Post-merge integration failed: ${result.source.repository}#${result.source.number}`, body: resultMarkdown(result) };
  // Runs for the same merge use one concurrency group, so retries update one issue.
  const issue = existing
    ? await request(`/repos/${repository}/issues/${existing.number}`, 'PATCH', { ...body, state: 'open' })
    : await request(`/repos/${repository}/issues`, 'POST', body);
  result.issue_url = issue.html_url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = integrationResult({ source: { repository: process.env.MERGED_REPOSITORY, number: process.env.MERGED_PR, sha: process.env.MERGED_SHA },
    server: process.env.SERVER_REVISION, host: process.env.HOST_REVISION, checks: JSON.parse(process.env.CHECK_RESULTS),
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, releaseSha: process.env.GITHUB_SHA });
  mkdirSync('target', { recursive: true });
  try {
    await reportFailure(result, githubRequest(process.env.GITHUB_TOKEN));
  } finally {
    writeFileSync('target/post-merge-result.json', `${JSON.stringify(result, null, 2)}\n`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, resultMarkdown(result)
      + (result.issue_url ? `\nFailure issue: ${result.issue_url}\n` : ''));
  }
}
