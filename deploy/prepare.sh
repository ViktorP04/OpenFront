#!/bin/sh
# Komodo pre-deploy command (working directory: repository root).
set -eu
cd "$(dirname "$0")/.."
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Commit or discard tracked changes before preparing a deployment." >&2
    exit 1
fi
# Only a revision is written. Credentials and .git never enter the build context.
git rev-parse --verify HEAD > deploy/revision.txt
echo "Deployment revision recorded."
