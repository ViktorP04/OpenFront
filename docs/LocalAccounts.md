# Accounts for private games

This fork includes standalone username/password accounts. No Google application,
email provider, or OpenFront account API is needed. Node.js 22.13 or newer is
required (the store uses Node's built-in SQLite).

## Run locally

Stop any existing dev server, then run from the project root:

```powershell
npm run dev:accounts
```

Open **http://localhost:9000**, select **Sign in → Create an account**, and choose
a username and password. Usernames are case-insensitive, 3–24 letters, numbers,
or underscores; passwords are 12–128 characters. Save your password: email
verification, Google login, and forgotten-password recovery are not included.

Create a private lobby and use its existing copy-invite button. Friends need an
account on this same server. Opening an invite while signed out leads to sign-in;
after signing in or registering, the client returns to the invited lobby.
Single-player still works without an account. In account mode, hosting and joining
multiplayer require a signed-in account, including during development.

Account settings offer password changes, sign-out, and sign-out on all devices.
Passwords and sessions survive server restarts. The default store is
`.local-accounts/accounts.sqlite`, excluded from Git. It contains password hashes,
hashed session tokens, and the signing key. Keep the directory private and back
it up with the server stopped (or use a SQLite-aware backup). Containers need a
persistent volume for this directory. Never put it under `resources` or `static`.

`npm run dev` keeps the original upstream mode. Use `dev:accounts`, or put
`LOCAL_ACCOUNTS=true` in your local `.env`, to enable standalone accounts.

## Invite friends over the internet

`localhost` only reaches the computer opening the link. Use a reachable **HTTPS**
address through your HTTPS reverse proxy or tunnel, with WebSocket forwarding.
For a small temporary test, forward it to port 9000 and set the exact public
origin in `.env` before starting:

```dotenv
LOCAL_ACCOUNT_ORIGIN=https://your-game.example.com
LOCAL_ACCOUNT_REGISTRATION_CODE=replace-with-a-long-private-code
```

Then run `npm run dev:accounts:host`. Share the registration code privately with
friends, and open the game at that HTTPS address yourself before creating the
lobby. Vite allows the configured hostname; do not disable its host checks.
All participants must use that same origin. HTTP is accepted only on loopback,
so sending account passwords over plain HTTP on a LAN is intentionally refused.
Only expose your HTTPS entry point; keep the backend ports 3000–3002 private.

For persistent hosting, use `npm run build:accounts`, set `LOCAL_ACCOUNTS=true`
and the same origin in the server environment, and follow the repository's
normal production deployment setup. The supplied nginx configuration routes
`/api/accounts/` to the master without caching. Build and runtime must agree on
whether standalone accounts are enabled. This feature has not been deployed
by the assistant; a reachable HTTPS address must still be supplied by the host.

## Docker / Komodo configuration

Use the repository's [deployment guide](../deploy/README.md) for the complete
Compose file, revision hook, persistent-volume setup, and post-deploy checks.

When building this repository's Dockerfile, pass the build argument
`LOCAL_ACCOUNTS=true`. Also set `LOCAL_ACCOUNTS=true` in the running container:
runtime variables alone cannot enable the compiled sign-in UI.

Set `LOCAL_ACCOUNT_ORIGIN` to the exact public HTTPS origin and optionally set
`LOCAL_ACCOUNT_REGISTRATION_CODE` as a private runtime variable. Set
`LOCAL_ACCOUNT_DATA_DIR=/data/accounts` and mount a persistent named volume or
host directory at `/data/accounts`. Keep that same volume across auto-deploys.
Use one application replica. Preserve the deployment's existing domain, proxy,
and other server configuration. Rebuild the image and redeploy after enabling
the build argument; restarting an old image is insufficient.

## Security and scope

- Passwords use random salts and scrypt (N=32768, r=8, p=3); comparisons use
  `timingSafeEqual`. Concurrent hashing and request rates are bounded.
- Sessions use random 256-bit tokens, stored hashed in SQLite. Cookies are
  HTTP-only, SameSite=Lax, and Secure on HTTPS. Sessions expire after seven days.
- Mutating account routes require the configured Origin, protecting against
  cross-site login, registration, logout, and password-change requests.
- Ten-minute Ed25519 JWTs integrate with the game's identity checks. The server
  checks that the session is still active when admitting a player or authorizing
  lobby operations. Logout and password changes revoke that access immediately.
  Already-admitted game sockets are not forcibly disconnected by logout.
- IP limits use the socket address, ignoring spoofable forwarded headers. Behind
  a proxy the limit is shared by the group (40 credential requests per 15 minutes).
- This is a single-master account service. Do not run multiple independent
  masters against the same store. External account features such as ranked
  matchmaking, purchases, persistent game statistics, and the friends directory
  are not implemented; invite links use the existing private-lobby system.

The password hashing uses [Node's crypto API](https://nodejs.org/api/crypto.html).
Cookie and session handling follows the relevant recommendations in the
[OWASP session management guide](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Checks

```powershell
npx vitest run tests/server/LocalAccounts.test.ts tests/client/LocalAccountPanel.test.ts
```

An opt-in integration test creates test accounts and a private lobby. Run a dev
server with `LOCAL_ACCOUNT_DATA_DIR` pointing to a disposable test directory, then
in another terminal:

```powershell
$env:LOCAL_ACCOUNT_SMOKE_TEST = 'true'
npx vitest run tests/server/LocalAccountLobby.test.ts
```

This test targets localhost:9000 with two workers and registration codes disabled.
