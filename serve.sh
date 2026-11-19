#!/usr/bin/env bash
# Serve this repository at /hackathon/janus/, which is the path its service
# worker scope, web app manifest and root-relative links all assume.
#
# A throwaway symlink tree in the system temp directory is used, so nothing
# inside the repository is copied, moved, rewritten or left behind.
set -euo pipefail

PORT="${1:-4321}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TREE="$(mktemp -d "${TMPDIR:-/tmp}/janus-serve.XXXXXX")"
trap 'rm -rf "$TREE"' EXIT

mkdir -p "$TREE/hackathon"
ln -s "$ROOT" "$TREE/hackathon/janus"

echo "JANUS  ->  http://localhost:$PORT/hackathon/janus/"
echo "app    ->  http://localhost:$PORT/hackathon/janus/app/"
echo "docs   ->  http://localhost:$PORT/hackathon/janus/docs/"
echo "Ctrl-C to stop."
echo
python3 -m http.server "$PORT" --directory "$TREE"
