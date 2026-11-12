# Orbit release

Build and distribute [AoW Server](https://github.com/yorkart/aow) and
[Orbit Host](https://github.com/yorkart/orbit-host). Each source repository owns
its package format, installation scripts, services and local development commands.
This repository calls those capabilities and owns release orchestration,
the public installer and update policy.

## Install and update

After the first release is published:

```sh
curl -fsSL https://github.com/yorkart/orbit-release/releases/latest/download/orbit-install.sh -o orbit-install.sh
bash orbit-install.sh --role server
bash orbit-install.sh --role host
```

Use `--version TAG` to select a release and `--repo OWNER/REPO` for a fork.
Host also accepts `--state-dir DIR`, `--listen 127.0.0.1:PORT`, and `--no-start`.
Server keeps its existing account setup and macOS service registration behavior;
exit 78 means administrator registration is still required. Neither role installs
or restarts the other service. The installer needs Bash, curl, tar and a SHA-256
tool; Server additionally needs Git and the existing systemd/launchd prerequisites.
No system Node installation is required.

`aow update [--version TAG] [--repo OWNER/REPO]` and
`orbit-host update [TAG]` delegate to this repository's `orbit-update` tool,
installed at `~/.local/lib/orbit-release/bin/orbit-update`. Local-only installations
bootstrap the tool on their first update. `aow account` stays in AoW.
Saved custom repositories and Server command directories are retained. The legacy
default update sources `yorkart/aow` and `yorkart/orbit-host` migrate to this repository.
Explicit `--repo` overrides still work. A versioned update downloads its entry
script from that version, then pins every payload request to the same tag.

The release also contains `aow-install.sh` (defaults to Server) and `install.sh`
(defaults to Host) for existing command shapes. Historical assets in the old
repositories are immutable and are not rewritten: existing installations need
one installation from this new entry point or a local build containing the bridge.

## Local development and shared Node

`just package` and `just install` remain in both source repositories, require no
release checkout, and install the local archive. All entry points use the same
product directories, configuration and service identities, so local builds and
published releases can replace each other. Releases with the same ID remain
immutable; use a new version ID for changed content. Application data migrations
still determine whether a downgrade is compatible.

Packages remain self-contained, including Node/npm, so offline local installation
continues to work. Installation shares identical runtime files using hard links
in `~/.local/lib/orbit/node/<node-version>/`. The file keys include SHA-256 and
permissions. Both roles use one physical copy of identical Node/npm files;
archives still carry their own runtime and are downloaded independently.
Different runtime versions coexist, shared files are read-only, and uninstalling
Host leaves Server and the shared store intact. Product release directories and
the store must be on the same filesystem. Runtime garbage collection is not
automatic. Both source repositories carry the small standalone v1 storage helper;
changes to that contract must be coordinated.

## Build and publish

Run **Build and release Orbit** manually. Choose `server_ref` (initial default:
`feat/space-session-foundation`), `host_ref` (default: `main`) and optionally a
version starting with `v` followed by a digit. Branches/tags are resolved once to
full commit SHAs before any matrix jobs start. Both source pins must match
this repository's `.node-version`.

The workflow runs source lint, Linux/macOS tests, package/installer regressions,
native builds and smoke tests for Linux/macOS on x86_64/aarch64. It invokes each
repository's existing packaging and release validation scripts. All checks and
all eight packages must pass before release assembly. `release.json` records both
source commits, Node version and asset checksums; `SHA256SUMS` covers every asset.
Server's `host-release.json` remains its independent integration-test pin and is
not silently rewritten by a release.

By default, dispatch only validates and uploads the `orbit-release` workflow
artifact. Set `publish: true` on `main` to publish. Uploads are verified while the
GitHub Release is still a draft; an existing published version cannot be replaced.
Development repository merges do not trigger this workflow or wait for it.

Rollout order: land the source-repository bridge changes, select their commits in
a validation-only dispatch, then publish the first successful release. Existing
branch protection rules referencing removed build/release jobs must be adjusted
in the development repositories' settings. Source installation and release tests
remain available locally and run here during release validation.

## Validate tooling locally

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm test
shellcheck install.sh scripts/orbit-update scripts/publish-release.sh
actionlint
```

Use actionlint 1.7.12. Native package validation requires the platform-specific
toolchains documented by each source repository.
