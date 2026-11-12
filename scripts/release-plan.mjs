import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const platforms = [
  { runner: 'ubuntu-24.04', platform: 'linux-x86_64', target: 'x86_64-unknown-linux-musl' },
  { runner: 'ubuntu-24.04-arm', platform: 'linux-aarch64', target: 'aarch64-unknown-linux-musl' },
  { runner: 'macos-15-intel', platform: 'macos-x86_64', target: 'x86_64-apple-darwin' },
  { runner: 'macos-26', platform: 'macos-aarch64', target: 'aarch64-apple-darwin' },
];
export function releasePlan(ref, publish = false) {
  if (publish && ref !== 'refs/heads/main') throw new Error('Manual publication requires main');
  const publishing = publish || ref.startsWith('refs/tags/v') || ref.startsWith('refs/heads/release-candidates/');
  const include = platforms.filter(item => publishing || ['linux-x86_64', 'macos-aarch64'].includes(item.platform));
  return { publishing, matrix: { include } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { publishing, matrix } = releasePlan(process.env.GITHUB_REF ?? '', process.env.PUBLISH_REQUEST === 'true');
  console.log(`publishing=${publishing}\nmatrix=${JSON.stringify(matrix)}`);
}
