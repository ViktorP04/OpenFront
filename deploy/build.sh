#!/bin/sh
# Invoked inside the Docker build stage.
set -eu
if [ "${GIT_COMMIT:-unknown}" = unknown ] && [ -f deploy/revision.txt ]; then
    GIT_COMMIT=$(cat deploy/revision.txt)
fi
export GIT_COMMIT
if [ "${LOCAL_ACCOUNTS:-false}" = true ]; then
    node -e 'if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(process.env.GIT_COMMIT || "")) { console.error("Run sh deploy/prepare.sh before building, or supply a full GIT_COMMIT build argument."); process.exit(1); }'
fi
npm run verify:maps
npm run build-prod
printf '%s\n' "${GIT_COMMIT:-unknown}" > static/commit.txt
printf '%s\n' "${LOCAL_ACCOUNTS:-false}" > static/account-mode.txt
