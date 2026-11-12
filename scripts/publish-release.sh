#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: publish-release.sh VERSION SHA ASSETS' >&2; exit 1; }
version=$1
revision=$2
assets=$3
prerelease=${RELEASE_PRERELEASE:-false}
[[ "$prerelease" == true || "$prerelease" == false ]] || { echo 'Invalid RELEASE_PRERELEASE' >&2; exit 1; }
: "${GH_REPO:?GH_REPO must name OWNER/REPO}"
[[ "$version" =~ ^v[0-9][A-Za-z0-9._-]*$ && "$revision" =~ ^[a-f0-9]{40}$ ]]
for platform in linux-x86_64 linux-aarch64 macos-x86_64 macos-aarch64; do
    [[ -s "$assets/aow-$platform.tar.gz" && -s "$assets/orbit-host-$version-$platform.tar.gz" ]]
done
for file in release.json host-release.json SHA256SUMS orbit-install.sh server-installer.sh host-installer.sh orbit-update aow-install.sh install.sh; do
    [[ -s "$assets/$file" ]]
done
(cd "$assets" && shasum -a 256 -c SHA256SUMS)
if existing=$(gh release view "$version" --json isDraft,targetCommitish 2>/dev/null); then
    node --input-type=module - "$existing" "$revision" <<'JS'
const [value, revision] = process.argv.slice(2);
const release = JSON.parse(value);
if (!release.isDraft || release.targetCommitish !== revision) throw new Error('Refusing to overwrite an immutable release or unrelated draft');
JS
else
    gh release create "$version" --draft --prerelease="$prerelease" --target "$revision" --title "Orbit $version" \
        --notes 'Server and Host packages built from the commits recorded in release.json. Install with orbit-install.sh --role server or --role host. Existing configuration and data are preserved.'
fi
gh release upload "$version" "$assets/"* --clobber
# Validate every uploaded asset while the release is still a draft.
verification=$(mktemp -d)
trap 'rm -rf -- "$verification"' EXIT
gh release download "$version" --dir "$verification"
(cd "$verification" && shasum -a 256 -c SHA256SUMS)
for file in "$assets/"*; do cmp "$file" "$verification/${file##*/}"; done
if [[ "$prerelease" == true ]]; then
    gh release edit "$version" --draft=false --prerelease --latest=false
else
    gh release edit "$version" --draft=false --prerelease=false --latest
fi
