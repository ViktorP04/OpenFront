import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isValidGameID } from "../../core/Schemas";
import { getApiBase } from "../ApiBase";
import { ClientEnv } from "../ClientEnv";

@customElement("local-account-panel")
export class LocalAccountPanel extends LitElement {
  @property() username = "";
  @state() private register = false;
  @state() private busy = false;
  @state() private error = "";
  @state() private needsCode = false;
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    fetch(`${getApiBase()}/auth/config`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        this.needsCode = (await response.json()).registrationCodeRequired;
      })
      .catch(() => {
        this.error =
          "Account service is unavailable. Check that the game server is running.";
      });
  }
  private async submit(event: SubmitEvent, action: string) {
    event.preventDefault();
    if (this.busy) return;
    const form = event.currentTarget as HTMLFormElement;
    const body = Object.fromEntries(new FormData(form));
    this.busy = true;
    this.error = "";
    try {
      const response = await fetch(`${getApiBase()}/auth/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error ?? "Account request failed. Please try again.";
        return;
      }
      form.reset();
      const invite = sessionStorage.getItem("local-account-invite");
      if (
        (action === "login" || action === "register") &&
        invite &&
        isValidGameID(invite)
      ) {
        sessionStorage.removeItem("local-account-invite");
        window.location.href = ClientEnv.gamePath(invite);
        return;
      }
      // Keep the current URL, including any private-lobby invite, intact.
      window.location.reload();
    } catch {
      this.error = "Could not reach the account service. Please try again.";
    } finally {
      this.busy = false;
    }
  }
  render() {
    const inputClass =
      "w-full rounded-lg bg-white/10 border border-white/20 p-3 text-white";
    const buttonClass =
      "w-full rounded-lg bg-blue-600 hover:bg-blue-500 p-3 text-white disabled:opacity-50";
    return html`<section class="max-w-md mx-auto p-6 space-y-5 text-white">
      <h2 class="text-xl font-bold">
        ${this.username
          ? `Signed in as ${this.username}`
          : this.register
            ? "Create an account"
            : "Sign in"}
      </h2>
      <p class="text-white/60">
        Use your account to host and join private games with friends.
      </p>
      ${this.error
        ? html`<p role="alert" class="text-red-300">${this.error}</p>`
        : nothing}
      ${this.username
        ? html`
            <p class="text-sm text-white/70">
              Your account includes three free flags: Sunrise, Mountain, and
              Comet. Equip them in Inventory. Your selection is saved in this
              browser.
            </p>
            <a class=${buttonClass} href="#modal=inventory&tab=flags"
              >Open inventory</a
            >
            <form
              class="space-y-3"
              @submit=${(e: SubmitEvent) => this.submit(e, "password")}
            >
              <h3 class="font-bold">Change password</h3>
              <input
                type="hidden"
                name="username"
                autocomplete="username"
                .value=${this.username}
              />
              <label class="block"
                >Current password<input
                  class=${inputClass}
                  name="currentPassword"
                  type="password"
                  autocomplete="current-password"
                  required
                  maxlength="128"
              /></label>
              <label class="block"
                >New password<input
                  class=${inputClass}
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="12"
                  maxlength="128"
              /></label>
              <p class="text-sm text-white/60">
                At least 12 characters. Changing your password signs out all
                sessions.
              </p>
              <button class=${buttonClass} ?disabled=${this.busy}>
                Change password
              </button>
            </form>
            <form @submit=${(e: SubmitEvent) => this.submit(e, "logout")}>
              <button class=${buttonClass} ?disabled=${this.busy}>
                Sign out
              </button>
            </form>
            <form @submit=${(e: SubmitEvent) => this.submit(e, "revoke")}>
              <button class=${buttonClass} ?disabled=${this.busy}>
                Sign out all devices
              </button>
            </form>
          `
        : html`
            <form
              class="space-y-4"
              @submit=${(e: SubmitEvent) =>
                this.submit(e, this.register ? "register" : "login")}
            >
              <label class="block"
                >Username<input
                  class=${inputClass}
                  name="username"
                  autocomplete="username"
                  required
                  minlength="3"
                  maxlength="24"
                  pattern="[A-Za-z0-9_]+"
              /></label>
              <label class="block"
                >Password<input
                  class=${inputClass}
                  name="password"
                  type="password"
                  autocomplete=${this.register
                    ? "new-password"
                    : "current-password"}
                  required
                  minlength="12"
                  maxlength="128"
              /></label>
              ${this.register
                ? html`<p class="text-sm text-white/60">
                    Use 3–24 letters, numbers or underscores for your username
                    and at least 12 characters for your password. Save your
                    password: email recovery is not available.
                  </p>`
                : nothing}
              ${this.register && this.needsCode
                ? html`<label class="block"
                    >Registration code<input
                      class=${inputClass}
                      name="registrationCode"
                      type="password"
                      required
                      maxlength="256"
                      autocomplete="off"
                  /></label>`
                : nothing}
              <button class=${buttonClass} ?disabled=${this.busy}>
                ${this.busy
                  ? "Please wait…"
                  : this.register
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
            <button
              class="text-blue-300 underline"
              ?disabled=${this.busy}
              @click=${() => {
                this.register = !this.register;
                this.error = "";
              }}
            >
              ${this.register
                ? "Already have an account? Sign in"
                : "Create an account"}
            </button>
          `}
    </section>`;
  }
}
