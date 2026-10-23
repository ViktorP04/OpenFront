import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import type { UserMeError } from "./Authentication";
export { getUserMe, verifyClientToken } from "./Authentication";

// How a join closes when /users/@me fails. A 401/403 is the API rejecting the
// session itself: retrying with the same token cannot succeed, so close with a
// terminal code and let the client send the player back to log in. Anything
// else (5xx, network, bad body) may be transient and stays retryable.
export function userMeFailureClose(error: UserMeError): {
  code: CloseCode;
  reason: CloseReason;
} {
  if (error.status === 401 || error.status === 403) {
    return { code: CloseCode.Unauthorized, reason: CloseReason.InvalidToken };
  }
  return {
    code: CloseCode.InternalError,
    reason: CloseReason.AccountLookupFailed,
  };
}
