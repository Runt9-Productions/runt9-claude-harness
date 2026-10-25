#!/usr/bin/env bash
# Installs betterleaks into the directory given. The SHA-256 is copied from the release's checksums.txt, so a
# replaced release asset fails here.
set -Eeuo pipefail

version=1.9.0
tarball=betterleaks_${version}_linux_x64.tar.gz
expected=f8b185a39ffcece2a1ca82bf3a4e7435cd81963ffd16b7a9128daf75f35f6de7
bin=$1

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/$tarball" "https://github.com/betterleaks/betterleaks/releases/download/v$version/$tarball"
echo "$expected  $work/$tarball" | sha256sum -c -
mkdir -p "$bin"
tar -xzf "$work/$tarball" -C "$bin" betterleaks
"$bin/betterleaks" version
