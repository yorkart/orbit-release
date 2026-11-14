# Orbit release

Build and distribute [Orbit Server](https://github.com/yorkart/orbit) and
[Orbit Host](https://github.com/yorkart/orbit-host). Each source repository owns
its package format, installation scripts, services and local development commands.
This repository calls those capabilities and owns release orchestration,
the public installer and update policy.

## Install and update

After a stable release is published:

```sh
curl -fsSL https://github.com/yorkart/orbit-release/releases/latest/download/orbit-install.sh -o orbit-install.sh
bash orbit-install.sh --role server
bash orbit-install.sh --role host
```

For a release candidate, download `orbit-install.sh` from that release's assets
and pass `--version TAG`. Prereleases are excluded from the `latest` URL.

Use `--version TAG` to select a release and `--repo OWNER/REPO` for a fork.
Host also accepts `--state-dir DIR`, `--listen 127.0.0.1:PORT`, and `--no-start`.
Server keeps its existing account setup and macOS service registration behavior;
exit 78 means administrator registration is still required. Neither role installs
or restarts the other service. The installer needs Bash, curl, tar and a SHA-256
tool; Server additionally needs Git and the existing systemd/launchd prerequisites.
No system Node installation is required.

`orbit update [--version TAG] [--repo OWNER/REPO]` and
`orbit-host update [TAG]` delegate to this repository's `orbit-update` tool,
installed at `~/.local/lib/orbit-release/bin/orbit-update`. Local-only installations
bootstrap the tool on their first update. `orbit account` stays in Orbit.
Saved custom repositories and Server command directories are retained. The legacy
default update sources `yorkart/orbit` and `yorkart/orbit-host` migrate to this repository.
Explicit `--repo` overrides still work. A versioned update downloads its entry
script from that version, then pins every payload request to the same tag.

The public `orbit-install.sh` requires `--role server` or `--role host`. The release
also contains `install.sh`, which defaults to Host. Historical assets in the old
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
in `~/.local/lib/orbit-runtime/node/<node-version>/`. The file keys include SHA-256 and
permissions. Both roles use one physical copy of identical Node/npm files;
archives still carry their own runtime and are downloaded independently.
Different runtime versions coexist, shared files are read-only, and uninstalling
Host leaves Server and the shared store intact. Product release directories and
the store must be on the same filesystem. Runtime garbage collection is not
automatic. Both source repositories carry the small standalone v2 storage helper;
changes to that contract must be coordinated.

## Build and publish

`sources.json` records immutable Server and Host commit SHAs. Run **Build and
release Orbit** manually, optionally overriding `server_ref`, `host_ref` and a
version starting with `v` followed by a digit. Branches/tags are resolved once to
full commit SHAs before any matrix jobs start. Both sources must match this
repository's `.node-version`.

The workflow runs source lint, Linux/macOS tests, package/installer regressions,
native builds and smoke tests for Linux/macOS on x86_64/aarch64. It invokes each
repository's existing packaging and release validation scripts. All checks and
all eight packages must pass before release assembly. `release.json` records both
source commits, Node version and asset checksums; `SHA256SUMS` covers every asset.
Joint Server acceptance uses the Host package built from the selected commit in
this run via `ORBIT_HOST_BINARY`. A release also contains `host-release.json` with
all four Host checksums as distribution metadata. Neither product copies it back
into its source repository. Server packages contain no Host release pin.

By default, dispatch validates Linux x86_64 and ARM Mac production packages
and uploads `joint-integration` with integration.json, both exact source SHAs and
archive checksums. It creates no GitHub Release. Each validation run has its own
concurrency group so unrelated source pairs can be checked in parallel. Set `publish: true` on `main` to publish. Uploads are verified while the
GitHub Release is still a draft; an existing published version cannot be replaced.
Development repository merges do not publish. Integration-relevant PRs require
a successful source-pair proof, but this workflow can validate unmerged commits
and never waits for the product PR checks. Formal and RC publication always
select the full four-platform/eight-package matrix.

For a release candidate, update `sources.json`, then push a new tag matching
`v*-rc.*` (for example, `v2026.11.12-rc.1`). This runs the same complete matrix and
publishes a prerelease only after every check passes. Candidates never change
the stable `latest` release; install them with an explicit `--version`.

Alternatively, push the release commit to a new branch named
`release-candidates/v2026.11.12-rc.3`. This uses the same checks and creates the
matching immutable tag when publishing the prerelease. This entry also works
with clients that can update branches but cannot create tags or dispatch workflows.

Development order: push both product branches, validate their exact commits with
publish=false, merge the reviewed changes, then publish the selected source pair.
There is no post-publication source edit or reverse pin synchronization. Existing
branch protection rules referencing removed build/release jobs must be adjusted
in the development repositories' settings. Source installation and release tests
remain available locally and run here during release validation.

## Validate concurrent product branches

Dispatch Build and release Orbit with server_ref and host_ref selecting either
branch or full commit SHA, and leave publish=false. References resolve once before
building. An integration-validation/ branch is an equivalent unpublished trigger;
its sources.json chooses the pair. This entry works before product PR checks pass.

Product PR checks can dispatch this workflow automatically on `main` with their
exact head SHA, the other product's pinned SHA from `sources.json`, and
`publish: false`. Unpublished dispatches are named
`Validate Server SERVER_SHA + Host HOST_SHA`; product gates use this name to find
and reuse active runs, link to their progress and report failures immediately.
Keep this naming contract when changing the workflow. Deploy this workflow change
on `main` before enabling automatic dispatch in either product repository.

In both product repositories, configure the Actions secret `ORBIT_RELEASE_TOKEN`
with a fine-grained token scoped to this repository: Actions read/write and
Contents read. Their default `GITHUB_TOKEN` cannot dispatch here. For a coordinated
change, set the product repository's Actions variable `ORBIT_JOINT_PEER_REF` to
the other product's branch, tag or exact SHA; the gate resolves it before dispatch.
Remove that override after the coordinated change. Fork PRs receive no dispatch
secret and require manual validation followed by rerunning their product check.

After all independent checks, actual packages and Linux/macOS acceptance pass,
the workflow emits the successful job named Joint integration SERVER_SHA HOST_SHA.
Server and Host CI check this public Actions metadata for their exact PR heads;
they download no Host artifact. Their required test check aggregates independent
and joint checks. Keep that test check required in product branch protection.
Frontend/docs-only changes need no new joint proof; post-merge CI is independent.
New integration-relevant commits require a new pair validation, with no pin edit.
Only repository-authorized push/dispatch runs can supply a proof; fork PR runs and
incomplete/failed proofs cannot admit a merge.

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
