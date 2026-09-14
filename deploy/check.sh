#!/bin/sh
# Read-only Komodo post-deploy check. Pass the EXISTING Compose project name.
set -eu
cd "$(dirname "$0")/.."
project=${1:?Usage: sh deploy/check.sh COMPOSE_PROJECT [HTTPS_ORIGIN]}
origin=${2:-https://openfront.viktorp04.com}
containers=$(docker ps --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=openfront" --format '{{.ID}}')
count=$(printf '%s\n' "$containers" | grep -c '[a-f0-9]' || true)
if [ "$count" -ne 1 ]; then
    echo "Expected exactly one running openfront container in project $project; found $count." >&2
    exit 1
fi
revision=$(git rev-parse --verify HEAD)
docker exec "$containers" node scripts/deploySmoke.mjs "$origin" --expect-commit "$revision" --attempts 12
