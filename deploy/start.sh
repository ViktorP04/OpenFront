#!/bin/sh
set -eu
cd /usr/src/app
built_commit=$(cat static/commit.txt)
if [ "${GIT_COMMIT:-unknown}" != unknown ] && [ "$GIT_COMMIT" != "$built_commit" ]; then
    echo "GIT_COMMIT differs from this image's built revision. Rebuild or remove the runtime override." >&2
    exit 1
fi
export GIT_COMMIT="$built_commit"
built_accounts=$(cat static/account-mode.txt)
if [ "${LOCAL_ACCOUNTS:-false}" != "$built_accounts" ]; then
    echo "LOCAL_ACCOUNTS must match the image's build argument. Rebuild with the matching account mode." >&2
    exit 1
fi
if [ "$built_accounts" = true ]; then
    account_dir=${LOCAL_ACCOUNT_DATA_DIR:-/data/accounts}
    case "$account_dir" in
        / | /usr/src/app | /usr/src/app/static* | /usr/src/app/resources* | '')
            echo "Choose a dedicated private account data directory." >&2
            exit 1
            ;;
        /*) ;;
        *)
            echo "LOCAL_ACCOUNT_DATA_DIR must be an absolute path." >&2
            exit 1
            ;;
    esac
    if [ -L "$account_dir" ]; then
        echo "Account data directory must not be a symlink." >&2
        exit 1
    fi
    # Supervisor runs Node as uid 1000. Named volumes start root-owned.
    install -d -m 700 -o node -g node "$account_dir"
    for filename in accounts.sqlite accounts.sqlite-wal accounts.sqlite-shm; do
        account_file="$account_dir/$filename"
        if [ -L "$account_file" ]; then
            echo "Account database files must not be symlinks." >&2
            exit 1
        fi
        if [ -f "$account_file" ]; then
            chown node:node "$account_file"
            chmod 600 "$account_file"
        fi
    done
    export LOCAL_ACCOUNT_DATA_DIR="$account_dir"
fi
/usr/local/bin/generate-nginx-upstream.sh
nginx -t
if [ "${DOMAIN:-}" = openfront.dev ] && [ "${SUBDOMAIN:-}" != main ]; then
    exec timeout 25h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
