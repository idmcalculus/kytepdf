import { authClient } from "../utils/AuthClient.ts";
import { type AuthState, type AuthStatus, authStore, type User } from "../utils/AuthStore.ts";
import { config } from "../utils/config.ts";
import { BaseComponent } from "./BaseComponent.ts";

type AccountView = "login" | "signup" | "forgot" | "reset-password" | "verify-email";

interface AccountModalOptions {
  view?: AccountView;
  token?: string;
}

// Focusable element selector used for focus-trap logic.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class AccountModal extends BaseComponent {
  private activeView: AccountView = "login";
  private unsubscribe: (() => void) | null = null;
  private isWorking = false;
  private errorMsg = "";
  private successMsg = "";
  private routeToken = "";
  /** Element that had focus before the modal opened — restored on close. */
  private openerElement: Element | null = null;
  /** Elements we set inert on — only these are restored on close. */
  private inertedElements: Set<Element> = new Set();
  /** Subset of inertedElements that did NOT already have aria-hidden. */
  private ariaHiddenAdded: Set<Element> = new Set();
  /** Tracks the last auth status we rendered to avoid no-op re-renders. */
  private lastRenderedStatus: AuthStatus | null = null;

  async connectedCallback() {
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-modal", "true");
    this.setAttribute("aria-labelledby", "accountModalTitle");
    this.setAttribute("aria-hidden", "true");

    this.unsubscribe = authStore.subscribe((_state: AuthState) => {
      // Never re-render while an async form action is in flight.
      if (this.isWorking) return;

      // If the modal is open and already showing the login/signup form, don't
      // wipe it on redundant unauthenticated notifications.
      if (this.classList.contains("is-open") && this.lastRenderedStatus !== null) {
        const next = _state.status;
        if (this.lastRenderedStatus === next && next === "unauthenticated") return;
      }

      this.render();
    });
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.removeKeyboardListeners();
    this.setBackgroundInert(false);
    this.restorePageScroll();
  }

  // ─── Keyboard handling ────────────────────────────────────────────────────

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === "Tab") {
      this.trapFocus(event);
    }
  };

  private trapFocus(event: KeyboardEvent) {
    const focusable = Array.from(this.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.closest("[aria-hidden='true']"),
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private addKeyboardListeners() {
    document.addEventListener("keydown", this.onKeyDown);
  }

  private removeKeyboardListeners() {
    document.removeEventListener("keydown", this.onKeyDown);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  public show(options: AccountModalOptions = {}) {
    // A repeat show() while open must not replace the real opener with a
    // control inside the modal.
    if (!this.classList.contains("is-open")) this.openerElement = document.activeElement;
    if (options.view) {
      this.activeView = options.view;
    } else if (this.activeView === "verify-email" || this.activeView === "reset-password") {
      // A plain open (the Account button) must not bring back a view left over
      // from an earlier emailed link, which would hide the summary and Log out.
      this.activeView = "login";
      this.routeToken = "";
    }
    if (options.token) this.routeToken = options.token;
    this.errorMsg = "";
    this.successMsg = "";
    this.classList.add("is-open");
    this.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    // Make background content inert so keyboard/AT users cannot reach it.
    this.setBackgroundInert(true);

    this.render();
    this.addKeyboardListeners();

    requestAnimationFrame(() => {
      if (document.activeElement && this.contains(document.activeElement)) return;
      const firstInput = this.querySelector<HTMLElement>("input:not([type='hidden'])");
      (firstInput ?? this.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    });
  }

  public close() {
    this.classList.remove("is-open");
    this.setAttribute("aria-hidden", "true");
    this.removeKeyboardListeners();
    this.setBackgroundInert(false);
    this.restorePageScroll();

    // Return focus to the element that opened the modal.
    if (this.openerElement instanceof HTMLElement) {
      this.openerElement.focus();
    }
    this.openerElement = null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private setBackgroundInert(inert: boolean) {
    if (inert) {
      for (const child of Array.from(document.body.children)) {
        if (child !== this && !child.hasAttribute("inert")) {
          child.setAttribute("inert", "");
          this.inertedElements.add(child);
          if (!child.hasAttribute("aria-hidden")) {
            child.setAttribute("aria-hidden", "true");
            this.ariaHiddenAdded.add(child);
          }
        }
      }
    } else {
      for (const child of this.inertedElements) {
        child.removeAttribute("inert");
      }
      for (const child of this.ariaHiddenAdded) {
        child.removeAttribute("aria-hidden");
      }
      this.inertedElements.clear();
      this.ariaHiddenAdded.clear();
    }
  }

  private restorePageScroll() {
    if (!document.querySelector("account-modal.is-open")) {
      document.body.style.overflow = "";
    }
  }

  /** Remove the token query param from the URL after a successful verify/reset flow. */
  private cleanRouteToken() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("token")) {
        url.searchParams.delete("token");
        // Navigate to root — the /verify-email or /reset-password path is no longer needed,
        // but preserve any remaining query params and hash.
        const remaining = url.search + url.hash;
        window.history.replaceState({}, "", `/${remaining}`);
      }
    } catch {
      // Non-critical — ignore URL cleanup failures.
    }
  }

  private switchView(view: AccountView) {
    this.activeView = view;
    this.errorMsg = "";
    this.successMsg = "";
    this.render();
  }

  // ─── Form handlers ────────────────────────────────────────────────────────

  /** Field-level validation errors keyed by input name. */
  private fieldErrors: Record<string, string> = {};

  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Returns true if the string contains ASCII control characters (0x00–0x1F or 0x7F). */
  private static hasControlChars(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
  }

  private validateEmail(email: string): string | null {
    const trimmed = email.trim();
    if (!trimmed) return "Email is required.";
    if (trimmed.length > 254) return "Email is too long (max 254 characters).";
    if (AccountModal.hasControlChars(trimmed)) return "Email contains invalid characters.";
    if (!AccountModal.EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
    return null;
  }

  private validatePassword(password: string, mode: "login" | "create"): string | null {
    if (!password) return "Password is required.";
    if (AccountModal.hasControlChars(password)) return "Password contains invalid characters.";
    if (mode === "create") {
      if (password.length < 8) return "Password must be at least 8 characters.";
      if (password.length > 128) return "Password is too long (max 128 characters).";
    }
    return null;
  }

  private validateToken(token: string, missingMessage: string): string | null {
    if (!token) return missingMessage;
    if (token.length > 256) return "The token is invalid.";
    if (AccountModal.hasControlChars(token)) return "The token is invalid.";
    return null;
  }

  /** Runs field validation without a full re-render. Returns true if valid. */
  private validateForm(email: string, password: string, newPassword: string): boolean {
    this.fieldErrors = {};

    if (this.activeView === "login") {
      const emailErr = this.validateEmail(email);
      if (emailErr) this.fieldErrors.email = emailErr;
      const pwErr = this.validatePassword(password, "login");
      if (pwErr) this.fieldErrors.password = pwErr;
    } else if (this.activeView === "signup") {
      const emailErr = this.validateEmail(email);
      if (emailErr) this.fieldErrors.email = emailErr;
      const pwErr = this.validatePassword(password, "create");
      if (pwErr) this.fieldErrors.password = pwErr;
    } else if (this.activeView === "forgot") {
      const emailErr = this.validateEmail(email);
      if (emailErr) this.fieldErrors.email = emailErr;
    } else if (this.activeView === "reset-password") {
      const tokenErr = this.validateToken(
        this.routeToken,
        "This password reset link is missing its token. Request a new link.",
      );
      if (tokenErr) {
        // Token errors are not user-fixable via the form — show as a modal-level error.
        // Re-render: the error alert only exists in the DOM once errorMsg is set.
        this.errorMsg = tokenErr;
        this.render();
        return false;
      }
      const pwErr = this.validatePassword(newPassword, "create");
      if (pwErr) this.fieldErrors.newPassword = pwErr;
    }

    const hasErrors = Object.keys(this.fieldErrors).length > 0;
    if (hasErrors) this.showFieldErrors();
    return !hasErrors;
  }

  /** Updates the DOM inline error elements without a full re-render. */
  private showFieldErrors() {
    for (const [name, msg] of Object.entries(this.fieldErrors)) {
      const input = this.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        const errorId = `${name}-error`;
        input.setAttribute("aria-describedby", errorId);
        // Insert or update error message element below the input
        let errorEl = this.querySelector<HTMLElement>(`#${errorId}`);
        if (!errorEl) {
          errorEl = document.createElement("span");
          errorEl.id = errorId;
          errorEl.className = "field-error";
          errorEl.setAttribute("role", "alert");
          input.parentElement?.appendChild(errorEl);
        }
        errorEl.textContent = msg;
      }
    }
  }

  /** Clears all inline validation state from the DOM. */
  private clearFieldErrors() {
    this.fieldErrors = {};
    for (const el of Array.from(this.querySelectorAll(".field-error"))) {
      el.remove();
    }
    for (const input of Array.from(this.querySelectorAll<HTMLInputElement>("[aria-invalid]"))) {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
  }

  private async handleFormSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const newPassword = String(formData.get("newPassword") || "");

    // Clear old field errors before re-validating.
    this.clearFieldErrors();

    // Frontend validation — bail without calling any API.
    if (!this.validateForm(email, password, newPassword)) return;

    this.isWorking = true;
    this.errorMsg = "";
    this.successMsg = "";
    this.updateWorkingState();

    try {
      if (this.activeView === "login") {
        await authStore.login({ email, password });
        this.close();
        return;
      } else if (this.activeView === "signup") {
        await authStore.signUp({ email, password });
        this.successMsg = "Account created. Check your email when you are ready to verify it.";
      } else if (this.activeView === "forgot") {
        await authClient.requestPasswordReset(email);
        this.successMsg = "If an account exists, password reset instructions have been sent.";
      } else if (this.activeView === "reset-password") {
        await authClient.resetPassword(this.routeToken, newPassword);
        // The server ends every session for the account on reset.
        authStore.markSignedOut();
        this.routeToken = "";
        this.activeView = "login";
        this.successMsg = "Password reset. You can now log in.";
        this.cleanRouteToken();
      }
    } catch (err) {
      this.errorMsg = err instanceof Error ? err.message : "The account request failed.";
    } finally {
      this.isWorking = false;
      this.render();
      // render() rebuilds the form; after a failure, give back the typed email
      // so the user only re-enters the password.
      if (this.errorMsg) {
        const emailInput = this.querySelector<HTMLInputElement>('input[name="email"]');
        if (emailInput) emailInput.value = email;
      }
    }
  }

  private async handleVerifyEmail() {
    const tokenErr = this.validateToken(
      this.routeToken,
      "The verification link is missing its token.",
    );
    if (tokenErr) {
      this.errorMsg = tokenErr;
      this.render();
      return;
    }

    this.isWorking = true;
    this.errorMsg = "";
    this.successMsg = "";
    // Re-render (no typed values to keep here) so the button shows as busy and disabled.
    this.render();

    try {
      await authStore.verifyEmail(this.routeToken);
      this.routeToken = "";
      this.activeView = "login";
      this.successMsg = "Email verified. You can continue using your account.";
      this.cleanRouteToken();
    } catch (err) {
      this.errorMsg = err instanceof Error ? err.message : "Email verification failed.";
    } finally {
      this.isWorking = false;
      this.render();
    }
  }

  private async handleLogout() {
    this.isWorking = true;
    this.errorMsg = "";
    this.successMsg = "";
    // Re-render (no typed values to keep here) so the button shows as busy and disabled.
    this.render();

    try {
      await authStore.logout();
    } catch (err) {
      this.errorMsg = err instanceof Error ? err.message : "Logout failed.";
    } finally {
      this.isWorking = false;
      this.render();
    }
  }

  /**
   * Update only the interactive elements' disabled state and button labels
   * without wiping the entire DOM (preserves typed form values mid-flight).
   */
  private updateWorkingState() {
    const submitBtn = this.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = this.isWorking;
      if (this.isWorking) submitBtn.textContent = "Please wait…";
    }

    const alertError = this.querySelector(".account-alert.error");
    const alertSuccess = this.querySelector(".account-alert.success");

    if (alertError) {
      alertError.textContent = this.errorMsg;
      (alertError as HTMLElement).style.display = this.errorMsg ? "" : "none";
    }
    if (alertSuccess) {
      alertSuccess.textContent = this.successMsg;
      (alertSuccess as HTMLElement).style.display = this.successMsg ? "" : "none";
    }
  }

  // ─── Render helpers ───────────────────────────────────────────────────────

  private renderUnavailable() {
    return `
      <div class="account-alert info" role="status">
        Account sign-in is not enabled in this build. You can keep using Kyte's local PDF tools without signing in.
      </div>
    `;
  }

  private renderUserSummary(user: User) {
    return `
      <section class="account-summary">
        <div class="account-info-row">
          <span>Email</span>
          <strong>${this.escapeHtml(user.email)}</strong>
        </div>
        <div class="account-info-row">
          <span>Status</span>
          <strong>${user.emailVerified ? "Verified" : "Email not verified"}</strong>
        </div>
        <div class="account-info-row">
          <span>Member since</span>
          <strong>${new Date(user.createdAt).toLocaleDateString()}</strong>
        </div>
        <button id="logoutBtn" class="btn btn-secondary" type="button" ${this.isWorking ? "disabled" : ""}>
          ${this.isWorking ? "Logging out…" : "Log out"}
        </button>
      </section>
    `;
  }

  private renderTabs() {
    if (
      this.activeView === "forgot" ||
      this.activeView === "reset-password" ||
      this.activeView === "verify-email"
    ) {
      return "";
    }

    return `
      <div class="auth-tabs" role="tablist" aria-label="Account actions">
        <button class="auth-tab ${this.activeView === "login" ? "active" : ""}" id="tabLogin" type="button" role="tab" aria-selected="${this.activeView === "login"}">Log in</button>
        <button class="auth-tab ${this.activeView === "signup" ? "active" : ""}" id="tabSignup" type="button" role="tab" aria-selected="${this.activeView === "signup"}">Sign up</button>
      </div>
    `;
  }

  private renderForm() {
    if (this.activeView === "verify-email") {
      return `
        <div class="account-route-panel">
          <p>Finish verifying your email address for this Kyte account.</p>
          <button id="verifyEmailBtn" class="btn btn-primary" type="button" ${this.isWorking ? "disabled" : ""}>
            ${this.isWorking ? "Verifying…" : "Verify email"}
          </button>
        </div>
        <button id="backToLoginLink" class="account-text-button" type="button">Back to log in</button>
      `;
    }

    if (this.activeView === "reset-password") {
      return `
        <form id="authForm" class="account-form" novalidate>
          <div class="form-group">
            <label for="newPassword">New password</label>
            <input type="password" id="newPassword" name="newPassword" required autocomplete="new-password" />
          </div>
          <button type="submit" class="btn btn-primary" ${this.isWorking ? "disabled" : ""}>
            ${this.isWorking ? "Resetting…" : "Reset password"}
          </button>
        </form>
        <button id="backToLoginLink" class="account-text-button" type="button">Back to log in</button>
      `;
    }

    const isUnavailable = !authClient.isAvailable;

    return `
      <form id="authForm" class="account-form" novalidate>
        <div class="form-group">
          <label for="accountEmail">Email address</label>
          <input type="email" id="accountEmail" name="email" required autocomplete="email" ${isUnavailable ? "disabled" : ""} />
        </div>
        ${
          this.activeView !== "forgot"
            ? `
        <div class="form-group">
          <label for="accountPassword">Password</label>
          <input type="password" id="accountPassword" name="password" required autocomplete="${this.activeView === "login" ? "current-password" : "new-password"}" ${isUnavailable ? "disabled" : ""} />
        </div>
        `
            : ""
        }
        <button type="submit" class="btn btn-primary" ${this.isWorking || isUnavailable ? "disabled" : ""}>
          ${this.isWorking ? "Please wait…" : this.activeView === "login" ? "Log in" : this.activeView === "signup" ? "Create account" : "Send reset link"}
        </button>
      </form>
      ${
        this.activeView === "login"
          ? `<button id="forgotLink" class="account-text-button" type="button">Forgot your password?</button>`
          : this.activeView === "forgot"
            ? `<button id="backToLoginLink" class="account-text-button" type="button">Back to log in</button>`
            : ""
      }
      ${
        this.activeView !== "forgot" && !isUnavailable && config.auth.oauthProviders.length > 0
          ? `
      <div class="oauth-divider">
        <span></span>
        <em>Or continue with</em>
        <span></span>
      </div>
      <div class="oauth-actions">
        ${config.auth.oauthProviders.includes("google") ? `<button id="btnGoogle" type="button" class="btn btn-secondary"><i data-lucide="chrome"></i> Google</button>` : ""}
        ${config.auth.oauthProviders.includes("github") ? `<button id="btnGithub" type="button" class="btn btn-secondary"><i data-lucide="github"></i> GitHub</button>` : ""}
      </div>
      `
          : ""
      }
    `;
  }

  private getHeading(user: User | null) {
    if (user) return "Your Kyte account";
    if (this.activeView === "signup") return "Create a Kyte account";
    if (this.activeView === "forgot") return "Reset your password";
    if (this.activeView === "reset-password") return "Choose a new password";
    if (this.activeView === "verify-email") return "Verify your email";
    return "Sign in to Kyte";
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  render() {
    const focusToRestore = this.captureFocus();
    const state = authStore.getState();
    this.lastRenderedStatus = state.status;
    // Emailed verify/reset links must work for signed-in users too (sign-up
    // signs the user in), so those views take precedence over the summary.
    const isLinkView = this.activeView === "verify-email" || this.activeView === "reset-password";
    const user = isLinkView ? null : state.user;

    let bodyContent: string;
    if (state.status === "unavailable") {
      bodyContent = this.renderUnavailable();
    } else if (state.status === "loading") {
      // Show a lightweight loading indicator instead of the form.
      // This prevents form fields from being rendered and then immediately
      // wiped when init completes (loading → unauthenticated).
      bodyContent = `<div class="account-loading" aria-live="polite"><p>Loading account…</p></div>`;
    } else if (user) {
      bodyContent = this.renderUserSummary(user);
    } else {
      bodyContent = `${this.renderTabs()}${this.renderForm()}`;
    }

    this.innerHTML = `
      <div class="account-modal-backdrop" data-close-account></div>
      <section class="account-modal-panel">
        <header class="account-modal-header">
          <div>
            <h2 id="accountModalTitle">${this.getHeading(user)}</h2>
            <p>Accounts are optional. Your PDFs stay local by default; sign in only for account access and future cross-device features.</p>
          </div>
          <button id="closeBtn" class="account-close-btn" type="button" aria-label="Close account modal">
            <i data-lucide="x"></i>
          </button>
        </header>

        ${this.errorMsg ? `<div class="account-alert error" role="alert">${this.escapeHtml(this.errorMsg)}</div>` : ""}
        ${this.successMsg ? `<div class="account-alert success" role="status">${this.escapeHtml(this.successMsg)}</div>` : ""}

        ${bodyContent}
      </section>
    `;

    this.querySelector("#closeBtn")?.addEventListener("click", () => this.close());
    this.querySelector("[data-close-account]")?.addEventListener("click", () => this.close());
    this.querySelector("#tabLogin")?.addEventListener("click", () => this.switchView("login"));
    this.querySelector("#tabSignup")?.addEventListener("click", () => this.switchView("signup"));
    this.querySelector("#forgotLink")?.addEventListener("click", () => this.switchView("forgot"));
    this.querySelector("#backToLoginLink")?.addEventListener("click", () =>
      this.switchView("login"),
    );
    this.querySelector("#authForm")?.addEventListener("submit", (event) =>
      this.handleFormSubmit(event),
    );
    this.querySelector("#verifyEmailBtn")?.addEventListener("click", () =>
      this.handleVerifyEmail(),
    );
    this.querySelector("#logoutBtn")?.addEventListener("click", () => this.handleLogout());
    this.querySelector("#btnGoogle")?.addEventListener("click", () =>
      authClient.openOAuth("google"),
    );
    this.querySelector("#btnGithub")?.addEventListener("click", () =>
      authClient.openOAuth("github"),
    );

    if ((window as any).lucide) {
      (window as any).lucide.createIcons();
    }

    this.restoreFocus(focusToRestore);
  }

  /**
   * While open, notes the id of the focused control so a redraw can give focus
   * back. Returns "" when focus has fallen to <body>, and null when focus is
   * elsewhere on the page or the modal is closed (then nothing is moved).
   */
  private captureFocus(): string | null {
    if (!this.classList.contains("is-open")) return null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.contains(active)) return active.id;
    return active === document.body ? "" : null;
  }

  /** Refocuses the same control after a redraw, or the first field, or Close. */
  private restoreFocus(id: string | null) {
    if (id === null) return;
    const same = id ? document.getElementById(id) : null;
    const usable =
      same && this.contains(same) && !(same as HTMLButtonElement).disabled ? same : null;
    (
      usable ??
      this.querySelector<HTMLElement>("input:not([type='hidden']):not([disabled])") ??
      this.querySelector<HTMLElement>("#closeBtn")
    )?.focus();
  }
}

if (!customElements.get("account-modal")) {
  customElements.define("account-modal", AccountModal);
}
