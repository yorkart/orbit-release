const roles = { 'yorkart/orbit': 'server', 'yorkart/orbit-host': 'host' };

export function mergedSource({ repository, number, sha }) {
  if (!repository && !number && !sha) return null;
  if (!Object.hasOwn(roles, repository) || !/^[1-9][0-9]*$/.test(String(number))
      || !Number.isSafeInteger(Number(number)) || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
    throw new Error('Expected a product repository, merged PR number and immutable merge SHA');
  }
  return { repository, number: Number(number), sha, role: roles[repository],
    url: `https://github.com/${repository}/pull/${number}` };
}

export function postMergeRefs(source, { ref, publish, server, host }) {
  const merged = mergedSource(source);
  if (!merged) return null;
  if (ref !== 'refs/heads/main' || publish === 'true' || publish === true) {
    throw new Error('Post-merge integration requires main and publish=false');
  }
  if (server || host) throw new Error('Post-merge source refs are selected from the merge SHA and peer main');
  return { server: 'main', host: 'main', [merged.role]: merged.sha };
}
