#!/usr/bin/env bash
set -euo pipefail
umask 077

DEFAULT_REPOSITORY=yorkart/orbit-release
DEFAULT_VERSION=''
DEFAULT_ROLE=''
stage=
trap '[[ -z "$stage" ]] || rm -rf -- "$stage"' EXIT
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
download() {
    curl --fail --show-error --location --retry 3 --connect-timeout 15 \
        --proto '=https' --proto-redir '=https' --output "$2" "$1"
}
verify() {
    local name=$1 checksum
    checksum=$(awk -v name="$name" '$2 == name {print $1}' "$stage/SHA256SUMS")
    [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || fail "missing or duplicate checksum: $name"
    printf '%s  %s\n' "$checksum" "$name" > "$stage/selected.sha256"
    if command -v sha256sum >/dev/null; then (cd "$stage" && sha256sum -c selected.sha256)
    else (cd "$stage" && shasum -a 256 -c selected.sha256); fi
}
main() {
    local repository=${ORBIT_RELEASE_REPOSITORY:-$DEFAULT_REPOSITORY} version='' role=$DEFAULT_ROLE
    local resolved prefix installer status=0
    local -a options=()
    while (( $# )); do
        case "$1" in
            --role|--repo|--version)
                (( $# >= 2 )) && [[ -n "$2" ]] || fail "$1 requires a value"
                case "$1" in --role) role=$2 ;; --repo) repository=$2 ;; --version) version=$2 ;; esac
                shift 2 ;;
            --no-start|--skip-host) options+=("$1"); shift ;;
            --state-dir|--listen)
                (( $# >= 2 )) && [[ -n "$2" ]] || fail "$1 requires a value"
                options+=("$1" "$2"); shift 2 ;;
            -h|--help)
                printf '%s\n' 'Usage: install.sh --role server|host [--version TAG] [--repo OWNER/REPO]' \
                    'Host options: --no-start, --state-dir DIR, --listen 127.0.0.1:PORT.' \
                    'Installs one role using its own installer; preserves configuration and data.' \
                    'Local development: continue using just package and just install in the source repository.'
                return ;;
            *) fail "unknown argument: $1" ;;
        esac
    done
    [[ "$role" == server || "$role" == host ]] || fail '--role must be server or host'
    [[ "$repository" =~ ^[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$ ]] || fail 'invalid repository'
    if [[ -z "$version" && "$repository" == "$DEFAULT_REPOSITORY" ]]; then version=$DEFAULT_VERSION; fi
    if [[ -z "$version" ]]; then
        resolved=$(curl --fail --silent --show-error --location --head --retry 3 --connect-timeout 15 \
            --proto '=https' --proto-redir '=https' --output /dev/null --write-out '%{url_effective}' "https://github.com/$repository/releases/latest")
        prefix=https://github.com/$repository/releases/tag/
        [[ "$resolved" == "$prefix"* ]] || fail 'could not resolve latest release'
        version=${resolved#"$prefix"}
    fi
    [[ "$version" =~ ^v[0-9][A-Za-z0-9._-]*$ ]] || fail 'invalid release version'
    local url=https://github.com/$repository/releases/download/$version
    stage=$(mktemp -d)
    installer=$role-installer.sh
    download "$url/SHA256SUMS" "$stage/SHA256SUMS"
    for asset in "$installer" orbit-update; do
        download "$url/$asset" "$stage/$asset"
        verify "$asset"
        bash -n "$stage/$asset"
    done
    export ORBIT_RELEASE_REPOSITORY=$repository
    bash "$stage/$installer" --repo "$repository" --version "$version" ${options[@]+"${options[@]}"} || status=$?
    [[ "$status" == 0 || "$status" == 78 ]] || return "$status"
    local tools=${HOME:?HOME must be set}/.local/lib/orbit-release/bin
    mkdir -p -- "$tools"
    local pending
    pending=$(mktemp "$tools/.update.XXXXXX")
    cp -- "$stage/orbit-update" "$pending"
    chmod 0755 "$pending"
    mv -f -- "$pending" "$tools/orbit-update"
    return "$status"
}
main "$@"
