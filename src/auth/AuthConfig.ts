/** Shared configuration and policy boundary for upstream and standalone accounts. */
export function localAccountsEnabled(): boolean {
  return process.env.LOCAL_ACCOUNTS === "true";
}

export function authPolicy(local = localAccountsEnabled()) {
  return {
    localAccounts: local,
    requireAccountToHost: local,
    allowPrivateGuests: local,
    verifySessionOnline: local,
    useUpstreamServices: !local,
  };
}

export function requiresAccountForJoin(
  multiplayer: boolean,
  source?: string,
  local = localAccountsEnabled(),
): boolean {
  return authPolicy(local).localAccounts && multiplayer && source !== "private";
}

export function apiUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "Account API URLs must use HTTPS (HTTP is allowed on loopback only), without credentials, query or fragment.",
    );
  }
  return url.href.replace(/\/$/, "");
}

export function accountEndpoints(options: {
  local: boolean;
  audience: string;
  localOrigin: string;
  apiOrigin?: string;
  issuer?: string;
}) {
  const apiBase = apiUrl(
    (options.apiOrigin?.trim() ? options.apiOrigin.trim() : undefined) ??
      (options.local
        ? `${options.localOrigin}/api/accounts`
        : options.audience === "localhost"
          ? "http://localhost:8787"
          : `https://api.${options.audience}`),
  );
  return {
    apiBase,
    issuer: apiUrl(
      (options.issuer?.trim() ? options.issuer.trim() : undefined) ?? apiBase,
    ),
  };
}
