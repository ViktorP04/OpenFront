# Deploying this fork with Komodo

This deployment includes **standalone username/password accounts and private
lobbies**, not the upstream account platform. Google sign-in, email recovery,
payments, persistent profiles/stats, ranked matchmaking, and the friends directory
are not implemented. Share private-lobby invite links instead. No separate
`api.openfront.viktorp04.com` service is required. See [account details](../docs/LocalAccounts.md).

## Preserve the existing stack

`compose.yaml` is based on the supplied Komodo configuration. It preserves
`127.0.0.1:8080 → container:80`, the existing environment options, and two workers
in the example cluster. Your existing HTTPS proxy should keep forwarding to
`http://127.0.0.1:8080`, including WebSockets. Backend ports 3000–3002 are not published.

Keep the **current Komodo Compose project name** when switching to repo-based
deployment. Do not deploy a second stack alongside it. If you already have an
account database, migrate/back it up before switching volumes; the supplied YAML
did not include an account volume.

## One-time Komodo settings

1. After committing and pushing these files, change the stack source from files
   on host to the repository `ViktorP04/OpenFront`, branch `main`, file `compose.yaml`.
   Keep the existing Git provider/account if the fork is hosted on Forgejo.
2. Enable `run_build`. Disable pulling a prebuilt image for this locally built service.
3. Keep existing Stack Environment values and add the relevant values from
   [`.env.example`](../.env.example). This is a template, not a file containing secrets.
4. Set **Pre Deploy**, working directory repository root, to:

   ```sh
   sh deploy/prepare.sh
   ```

   This requires a clean tracked checkout and records its revision in the ignored
   `deploy/revision.txt`. The Docker build uses it when `GIT_COMMIT` is unset or
   `unknown`. Remove any stale manually set `GIT_COMMIT` value from Stack Environment.
   A full SHA build argument remains supported for external builders.

5. Set **Post Deploy**, working directory repository root, to:

   ```sh
   sh deploy/check.sh YOUR_EXISTING_COMPOSE_PROJECT
   ```

   Replace the argument with the current project name shown by `docker compose ls`.
   The script finds that project's single app container and runs a read-only check
   using its bundled Node. The host needs Docker, Git, and a POSIX shell, not Node.

6. Configure your Git webhook to deploy the stack on pushes to `main` if desired.
   A repo-based stack pulls the latest source on deploy; enabling it alone does
   not schedule a deployment for every push.

These settings follow Komodo's [Compose stack](https://komo.do/docs/deploy/compose)
and [webhook](https://komo.do/docs/automate/webhooks) workflows. This repository does
not change the running Komodo stack automatically.

## Account configuration and storage

The Compose file enables `LOCAL_ACCOUNTS=true` at build time and runtime. The
startup script refuses a mismatched account mode or explicitly overridden revision.

```dotenv
DOMAIN=openfront.viktorp04.com
LOCAL_ACCOUNT_ORIGIN=https://openfront.viktorp04.com
CLUSTER_JSON={"a":{"host":"openfront.viktorp04.com","color":"blue","numWorkers":2}}
OPENFRONT_ACCOUNTS_VOLUME=openfront-accounts
```

Set `LOCAL_ACCOUNT_REGISTRATION_CODE` to a long random private value in Komodo
to restrict registration to friends. Keep `.env` and registration codes out of
Git. The test Turnstile key is only a bootstrap placeholder: account mode does
not perform Turnstile verification, and multiplayer requires valid accounts.

The named volume `openfront-accounts` is mounted at `/data/accounts`; its stable
name avoids replacing accounts when a checkout path changes. Keep **one replica**.
Startup gives the Node user access to the directory and database files. Password
hashes, sessions, and signing keys survive rebuilding/recreating the container.
Back up the volume with the app stopped or with a SQLite-aware backup. Do not use
`docker compose down -v` unless you intend to delete accounts. `.dockerignore`
excludes the default account directory and SQLite files from build contexts.

## Maps, release verification, and rollback

The Docker build runs `npm run verify:maps`, checking every registered map's
metadata, translations, binary sizes, and thumbnail. It explicitly requires Viktor
and TPG. **It does not generate maps.** Run the Go generator locally after edits
and commit source files, generated `resources/maps` files, `Maps.gen.ts`, and
translations together. The existing CI map-generation job checks regeneration drift.

The post-deploy check verifies worker health, the exact Git revision, the built
account mode, the account API and public keys, and checksums/dimensions for all
Viktor/TPG map binaries and thumbnails. It retries briefly during startup and exits
nonzero on failure; it never creates accounts or lobbies. It checks the public
HTTPS URL from inside the container, so that route must be reachable there.

For a manual check from a machine with Node:

```sh
npm run smoke:deploy -- https://openfront.viktorp04.com --expect-commit FULL_COMMIT_SHA --attempts 12
```

Before rebuilding, let active games finish: deployments restart their in-memory
lobbies. If verification fails, inspect the logs and redeploy the previous known
good revision using the same account volume. Do not automatically restore an old
database over new accounts; future schema migrations need a separate rollback plan.

## Local validation

```sh
docker compose --env-file .env.example config --quiet
npm run verify:maps
npx vitest run tests/server/LocalAccounts.test.ts tests/DeploySmoke.test.ts
```

The self-hosting CI workflow also builds and starts the production container,
checking that a fresh account volume is writable and the packaged assets are served.
