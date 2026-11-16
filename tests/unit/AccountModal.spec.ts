import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountModal } from "../../components/AccountModal.ts";
import "../../components/AccountModal.ts";
import { type AuthState, authStore, type User } from "../../utils/AuthStore.ts";
import { config } from "../../utils/config.ts";

// The modal runs against the real AuthStore; only the network client is faked.
// BroadcastChannel is swapped before the store is built so tests can play
// the part of another browser tab.
const { client, channels, realBroadcastChannel } = vi.hoisted(() => {
  const channels: Array<{ deliver: (data: unknown) => void }> = [];
  class FakeChannel {
    private readonly listeners: Array<(event: MessageEvent) => void> = [];
    constructor() {
      channels.push(this);
    }
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.push(listener);
    }
    postMessage() {}
    deliver(data: unknown) {
      for (const listener of this.listeners) listener({ data } as MessageEvent);
    }
  }
  const realBroadcastChannel = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = FakeChannel;

  return {
    channels,
    realBroadcastChannel,
    client: {
      isAvailable: true,
      getMe: vi.fn((): Promise<User> => Promise.reject(new Error("No session"))),
      login: vi.fn(),
      signUp: vi.fn(),
      logout: vi.fn(),
      verifyEmail: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      openOAuth: vi.fn(),
    },
  };
});

vi.mock("../../utils/AuthClient.ts", () => ({ authClient: client }));

const alice: User = {
  id: "u1",
  email: "alice@example.com",
  emailVerified: true,
  createdAt: "2026-03-04T12:00:00.000Z",
};
const bob: User = {
  id: "u2",
  email: "bob@example.com",
  emailVerified: true,
  createdAt: "2026-05-06T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AccountModal", () => {
  let modal: AccountModal;
  let frames: FrameRequestCallback[];
  const configuredProviders = config.auth.oauthProviders;

  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    modal.querySelector<T>(selector);
  const heading = () => $("#accountModalTitle")?.textContent;
  const field = (name: string) => $<HTMLInputElement>(`[name="${name}"]`)!;
  const fill = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) field(name).value = value;
  };
  const submitButton = () => $<HTMLButtonElement>('button[type="submit"]')!;
  const submit = () => submitButton().click();
  const fieldError = (name: string) => $(`#${name}-error`)?.textContent;
  const alertText = (kind: "error" | "success" | "info") =>
    $(`.account-alert.${kind}`)?.textContent?.trim();
  const runFrames = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  const press = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    (document.activeElement ?? document).dispatchEvent(event);
    return event;
  };
  const otherTab = (message: unknown) => channels[0].deliver(message);
  const signIn = async (user: User) => {
    client.login.mockResolvedValueOnce(user);
    await authStore.login({ email: user.email, password: "pw" });
  };
  const summaryRow = (label: string) =>
    Array.from(modal.querySelectorAll(".account-info-row"))
      .find((row) => row.querySelector("span")?.textContent === label)
      ?.querySelector("strong")?.textContent;
  const page = (id: string) => document.getElementById(id)!;

  beforeEach(async () => {
    for (const fn of [
      client.getMe,
      client.login,
      client.signUp,
      client.logout,
      client.verifyEmail,
      client.requestPasswordReset,
      client.resetPassword,
      client.openOAuth,
    ]) {
      fn.mockReset();
    }
    client.isAvailable = true;
    // Every test starts signed out.
    client.logout.mockResolvedValueOnce(undefined);
    await authStore.logout();
    client.logout.mockClear();

    config.auth.oauthProviders = [];
    window.history.replaceState({}, "", "/");
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
      frames.push(frame);
      return frames.length;
    });

    document.body.innerHTML = `
      <button id="opener" type="button">Account</button>
      <main id="app"><button type="button">Merge PDFs</button></main>
      <aside id="preHidden" aria-hidden="true"></aside>
      <div id="preInert" inert></div>
    `;
    modal = document.createElement("account-modal") as AccountModal;
    document.body.appendChild(modal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    config.auth.oauthProviders = configuredProviders;
    document.body.style.overflow = "";
  });

  afterAll(() => {
    globalThis.BroadcastChannel = realBroadcastChannel;
  });

  describe("opening and closing", () => {
    it("is a hidden modal dialog until shown", () => {
      expect(modal.getAttribute("role")).toBe("dialog");
      expect(modal.getAttribute("aria-modal")).toBe("true");
      expect(modal.getAttribute("aria-labelledby")).toBe("accountModalTitle");
      expect(modal.getAttribute("aria-hidden")).toBe("true");
      expect(modal.classList.contains("is-open")).toBe(false);
      expect(heading()).toBe("Sign in to Kyte");
      expect($("#tabLogin")?.getAttribute("aria-selected")).toBe("true");
      expect($("#tabSignup")?.getAttribute("aria-selected")).toBe("false");
    });

    it("opens over an inert page and focuses the first field on the next frame", () => {
      page("opener").focus();
      modal.show();

      expect(modal.classList.contains("is-open")).toBe(true);
      expect(modal.getAttribute("aria-hidden")).toBe("false");
      expect(document.body.style.overflow).toBe("hidden");
      expect(page("opener").hasAttribute("inert")).toBe(true);
      expect(page("opener").getAttribute("aria-hidden")).toBe("true");
      expect(page("app").hasAttribute("inert")).toBe(true);
      expect(modal.hasAttribute("inert")).toBe(false);

      expect(document.activeElement).toBe(page("opener"));
      runFrames();
      expect(document.activeElement).toBe(field("email"));
    });

    it("puts the page back exactly as it found it and returns focus on close", () => {
      page("opener").focus();
      modal.show();
      runFrames();
      modal.close();

      expect(modal.classList.contains("is-open")).toBe(false);
      expect(modal.getAttribute("aria-hidden")).toBe("true");
      expect(document.body.style.overflow).toBe("");
      expect(page("opener").hasAttribute("inert")).toBe(false);
      expect(page("opener").hasAttribute("aria-hidden")).toBe(false);
      expect(page("app").hasAttribute("inert")).toBe(false);
      // Attributes the page set itself are left alone.
      expect(page("preHidden").getAttribute("aria-hidden")).toBe("true");
      expect(page("preHidden").hasAttribute("inert")).toBe(false);
      expect(page("preInert").hasAttribute("inert")).toBe(true);
      expect(document.activeElement).toBe(page("opener"));
    });

    it("keeps the original opener when show() runs again while open", () => {
      page("opener").focus();
      modal.show();
      runFrames();
      expect(document.activeElement).toBe(field("email"));

      // For example, a deep link reopening it on another view.
      modal.show({ view: "forgot" });
      modal.close();

      expect(document.activeElement).toBe(page("opener"));
    });

    it.each([
      ["the close button", () => $("#closeBtn")!.click()],
      ["the backdrop", () => $("[data-close-account]")!.click()],
      ["Escape", () => expect(press("Escape").defaultPrevented).toBe(true)],
    ])("closes from %s", (_label, dismiss) => {
      page("opener").focus();
      modal.show();
      runFrames();

      dismiss();

      expect(modal.classList.contains("is-open")).toBe(false);
      expect(document.activeElement).toBe(page("opener"));
    });

    it("stops handling keys once closed", () => {
      modal.show();
      modal.close();

      expect(press("Escape").defaultPrevented).toBe(false);
      expect(press("Tab").defaultPrevented).toBe(false);
    });

    it("keeps Tab and Shift+Tab focus inside the dialog", () => {
      modal.show();
      runFrames();
      const first = $("#closeBtn")!;
      const last = $("#forgotLink")!;

      last.focus();
      expect(press("Tab").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      expect(press("Tab", true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);

      // Between the ends, the browser moves focus as usual.
      field("email").focus();
      expect(press("Tab").defaultPrevented).toBe(false);
      expect(press("Tab", true).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(field("email"));
    });

    it("does not steal focus the user already moved into the dialog", () => {
      modal.show();
      $("#tabSignup")!.focus();
      runFrames();

      expect(document.activeElement).toBe($("#tabSignup"));
    });

    it("focuses the first control when the view has no text field", async () => {
      await signIn(alice);
      modal.show();
      runFrames();

      expect(document.activeElement).toBe($("#closeBtn"));
    });

    it("cleans up after itself if it is removed while open", async () => {
      modal.show();
      modal.remove();

      expect(document.body.style.overflow).toBe("");
      expect(page("opener").hasAttribute("inert")).toBe(false);
      expect(page("app").hasAttribute("aria-hidden")).toBe(false);
      expect(press("Escape").defaultPrevented).toBe(false);

      // It no longer follows the store.
      await signIn(alice);
      expect(heading()).toBe("Sign in to Kyte");
    });
  });

  describe("focus across redraws", () => {
    beforeEach(() => {
      modal.show();
      runFrames();
    });

    it("keeps focus on a tab a keyboard user just activated", () => {
      $("#tabSignup")!.focus();
      $("#tabSignup")!.click();

      expect(heading()).toBe("Create a Kyte account");
      expect(document.activeElement).toBe($("#tabSignup"));
    });

    it("moves focus to the first field when the focused control is gone", () => {
      $("#forgotLink")!.focus();
      $("#forgotLink")!.click();

      expect(heading()).toBe("Reset your password");
      expect(document.activeElement).toBe(field("email"));
    });

    it("returns focus to the password field after a failed login", async () => {
      client.login.mockRejectedValueOnce(new Error("Authentication failed."));
      fill({ email: alice.email, password: "wrong" });
      field("password").focus();
      submit();
      await flush();

      expect(alertText("error")).toBe("Authentication failed.");
      expect(document.activeElement).toBe(field("password"));
    });

    it("keeps focus inside when a store change redraws the dialog", () => {
      $("#closeBtn")!.focus();
      otherTab({ type: "login", user: bob });

      expect(heading()).toBe("Your Kyte account");
      expect(document.activeElement).toBe($("#closeBtn"));
    });

    it("does not take focus when a store change redraws it while closed", () => {
      modal.close();
      page("opener").focus();

      otherTab({ type: "login", user: bob });

      expect(document.activeElement).toBe(page("opener"));
    });
  });

  describe("login form validation", () => {
    beforeEach(() => {
      modal.show();
    });

    it("flags empty fields inline without calling the server", () => {
      submit();

      expect(fieldError("email")).toBe("Email is required.");
      expect(fieldError("password")).toBe("Password is required.");
      expect(field("email").getAttribute("aria-invalid")).toBe("true");
      expect(field("email").getAttribute("aria-describedby")).toBe("email-error");
      expect($("#email-error")?.getAttribute("role")).toBe("alert");
      expect(client.login).not.toHaveBeenCalled();
    });

    it.each([
      ["a malformed", "not-an-email", "Enter a valid email address."],
      ["an over-long", `${"a".repeat(250)}@example.com`, "Email is too long (max 254 characters)."],
      ["a control-character", "a\u0001b@example.com", "Email contains invalid characters."],
    ])("rejects %s email", (_label, email, message) => {
      fill({ email, password: "pw" });
      submit();

      expect(fieldError("email")).toBe(message);
      expect(fieldError("password")).toBeUndefined();
      expect(client.login).not.toHaveBeenCalled();
    });

    it("rejects a password containing control characters", () => {
      fill({ email: alice.email, password: "pass\u0007word" });
      submit();

      expect(fieldError("password")).toBe("Password contains invalid characters.");
      expect(client.login).not.toHaveBeenCalled();
    });

    it("clears stale errors once the input is fixed, and allows short passwords at login", () => {
      client.login.mockReturnValueOnce(new Promise(() => {}));
      submit();
      expect(modal.querySelectorAll(".field-error")).toHaveLength(2);

      // Length rules are for new passwords only; older accounts may have shorter ones.
      fill({ email: alice.email, password: "short" });
      submit();

      expect(modal.querySelectorAll(".field-error")).toHaveLength(0);
      expect(modal.querySelector("[aria-invalid]")).toBeNull();
      expect(client.login).toHaveBeenCalledWith({ email: alice.email, password: "short" });
    });
  });

  describe("logging in", () => {
    it("locks the form while the request runs and ignores repeat submits", async () => {
      const login = deferred<User>();
      client.login.mockReturnValueOnce(login.promise);
      modal.show();
      fill({ email: alice.email, password: "pw" });
      submit();

      expect(submitButton().disabled).toBe(true);
      expect(submitButton().textContent).toBe("Please wait…");

      // A store change mid-request must not wipe what the user typed.
      otherTab({ type: "login", user: bob });
      expect(field("email").value).toBe(alice.email);

      submit();
      expect(client.login).toHaveBeenCalledTimes(1);

      login.resolve(alice);
      await flush();
    });

    it("closes on success, returns focus and shows the account next time", async () => {
      client.login.mockResolvedValueOnce(alice);
      page("opener").focus();
      modal.show();
      fill({ email: alice.email, password: "pw" });
      submit();
      await flush();

      expect(client.login).toHaveBeenCalledWith({ email: alice.email, password: "pw" });
      expect(modal.classList.contains("is-open")).toBe(false);
      expect(document.activeElement).toBe(page("opener"));

      modal.show();
      expect(heading()).toBe("Your Kyte account");
      expect(summaryRow("Email")).toBe(alice.email);
      expect(summaryRow("Status")).toBe("Verified");
      expect(summaryRow("Member since")).toBe(new Date(alice.createdAt).toLocaleDateString());
      expect($("#authForm")).toBeNull();
    });

    it("shows the server's error and keeps the dialog open", async () => {
      client.login.mockRejectedValueOnce(
        new Error("Authentication failed. Please check your credentials."),
      );
      modal.show();
      fill({ email: alice.email, password: "wrong" });
      submit();
      await flush();

      expect(alertText("error")).toBe("Authentication failed. Please check your credentials.");
      expect($(".account-alert.error")?.getAttribute("role")).toBe("alert");
      expect(field("email").value).toBe(alice.email);
      expect(field("password").value).toBe("");
      expect(modal.classList.contains("is-open")).toBe(true);
      expect(heading()).toBe("Sign in to Kyte");
      expect(submitButton().disabled).toBe(false);
      expect(submitButton().textContent?.trim()).toBe("Log in");
    });

    it("escapes error text so a server message cannot inject markup", async () => {
      client.login.mockRejectedValueOnce(new Error('<img src=x onerror="alert(1)">'));
      modal.show();
      fill({ email: alice.email, password: "pw" });
      submit();
      await flush();

      expect(modal.querySelector("img")).toBeNull();
      expect(alertText("error")).toBe('<img src=x onerror="alert(1)">');
    });

    it("falls back to a generic message when the failure is not an Error", async () => {
      client.login.mockRejectedValueOnce("nope");
      modal.show();
      fill({ email: alice.email, password: "pw" });
      submit();
      await flush();

      expect(alertText("error")).toBe("The account request failed.");
    });

    it("clears an old error while the next attempt runs", async () => {
      client.login.mockRejectedValueOnce(new Error("Authentication failed."));
      modal.show();
      fill({ email: alice.email, password: "wrong" });
      submit();
      await flush();
      expect(alertText("error")).toBe("Authentication failed.");

      client.login.mockReturnValueOnce(new Promise(() => {}));
      fill({ email: alice.email, password: "right" });
      submit();

      expect($(".account-alert.error")?.style.display).toBe("none");
    });
  });

  describe("signing up", () => {
    beforeEach(() => {
      modal.show();
      $("#tabSignup")!.click();
    });

    it("switches between the sign-up and login tabs", () => {
      expect(heading()).toBe("Create a Kyte account");
      expect($("#tabSignup")?.getAttribute("aria-selected")).toBe("true");
      expect(submitButton().textContent?.trim()).toBe("Create account");
      expect(field("password").getAttribute("autocomplete")).toBe("new-password");
      expect($("#forgotLink")).toBeNull();

      $("#tabLogin")!.click();
      expect(heading()).toBe("Sign in to Kyte");
      expect(field("password").getAttribute("autocomplete")).toBe("current-password");
    });

    it.each([
      ["too short", "seven77", "Password must be at least 8 characters."],
      ["too long", "x".repeat(129), "Password is too long (max 128 characters)."],
    ])("rejects a new password that is %s", (_label, password, message) => {
      fill({ email: alice.email, password });
      submit();

      expect(fieldError("password")).toBe(message);
      expect(client.signUp).not.toHaveBeenCalled();
    });

    it("creates the account, confirms it and shows the new, unverified account", async () => {
      const newUser = { ...bob, emailVerified: false };
      client.signUp.mockResolvedValueOnce(newUser);
      fill({ email: newUser.email, password: "longenough" });
      submit();
      await flush();

      expect(client.signUp).toHaveBeenCalledWith({ email: newUser.email, password: "longenough" });
      expect(alertText("success")).toBe(
        "Account created. Check your email when you are ready to verify it.",
      );
      expect(heading()).toBe("Your Kyte account");
      expect(summaryRow("Status")).toBe("Email not verified");
      expect(modal.classList.contains("is-open")).toBe(true);
    });

    it("reports a failed sign-up and stays on the sign-up form", async () => {
      client.signUp.mockRejectedValueOnce(new Error("Unable to complete registration."));
      fill({ email: alice.email, password: "longenough" });
      submit();
      await flush();

      expect(alertText("error")).toBe("Unable to complete registration.");
      expect(heading()).toBe("Create a Kyte account");
      expect(field("email").value).toBe(alice.email);
    });
  });

  describe("forgot password", () => {
    beforeEach(() => {
      modal.show();
      $("#forgotLink")!.click();
    });

    it("asks only for an email and can go back to login", () => {
      expect(heading()).toBe("Reset your password");
      expect($("#tabLogin")).toBeNull();
      expect($('[name="password"]')).toBeNull();
      expect(submitButton().textContent?.trim()).toBe("Send reset link");

      $("#backToLoginLink")!.click();
      expect(heading()).toBe("Sign in to Kyte");
      expect($("#tabLogin")).not.toBeNull();
    });

    it("checks the email before asking for a link", () => {
      fill({ email: "nope" });
      submit();

      expect(fieldError("email")).toBe("Enter a valid email address.");
      expect(client.requestPasswordReset).not.toHaveBeenCalled();
    });

    it("sends the link with a reply that does not reveal whether the account exists", async () => {
      client.requestPasswordReset.mockResolvedValueOnce({ requested: true });
      fill({ email: alice.email });
      submit();
      await flush();

      expect(client.requestPasswordReset).toHaveBeenCalledWith(alice.email);
      expect(alertText("success")).toBe(
        "If an account exists, password reset instructions have been sent.",
      );
    });

    it("shows a failed request", async () => {
      client.requestPasswordReset.mockRejectedValueOnce(new Error("Too many requests"));
      fill({ email: alice.email });
      submit();
      await flush();

      expect(alertText("error")).toBe("Too many requests");
      expect(heading()).toBe("Reset your password");
      expect(field("email").value).toBe(alice.email);
    });
  });

  describe("reset-password link", () => {
    it("asks for a new password and applies the new-password rules", () => {
      modal.show({ view: "reset-password", token: "reset-tok" });

      expect(heading()).toBe("Choose a new password");
      expect($("#tabLogin")).toBeNull();
      expect(submitButton().textContent?.trim()).toBe("Reset password");

      fill({ newPassword: "short" });
      submit();

      expect(fieldError("newPassword")).toBe("Password must be at least 8 characters.");
      expect(client.resetPassword).not.toHaveBeenCalled();
    });

    it("resets the password, returns to login and drops the token from the address bar", async () => {
      window.history.replaceState({}, "", "/reset-password?token=reset-tok&ref=mail#top");
      client.resetPassword.mockResolvedValueOnce({ reset: true });
      modal.show({ view: "reset-password", token: "reset-tok" });
      fill({ newPassword: "brand-new-pass" });
      submit();
      await flush();

      expect(client.resetPassword).toHaveBeenCalledWith("reset-tok", "brand-new-pass");
      expect(heading()).toBe("Sign in to Kyte");
      expect(alertText("success")).toBe("Password reset. You can now log in.");
      const { pathname, search, hash } = window.location;
      expect(`${pathname}${search}${hash}`).toBe("/?ref=mail#top");
    });

    it("keeps the token after a failure so the user can try again", async () => {
      window.history.replaceState({}, "", "/reset-password?token=reset-tok");
      client.resetPassword
        .mockRejectedValueOnce(new Error("Password is too common"))
        .mockResolvedValueOnce({ reset: true });
      modal.show({ view: "reset-password", token: "reset-tok" });

      fill({ newPassword: "password123" });
      submit();
      await flush();

      expect(alertText("error")).toBe("Password is too common");
      expect(heading()).toBe("Choose a new password");
      expect(window.location.search).toBe("?token=reset-tok");

      fill({ newPassword: "a-better-passphrase" });
      submit();
      await flush();

      expect(client.resetPassword).toHaveBeenLastCalledWith("reset-tok", "a-better-passphrase");
      expect(heading()).toBe("Sign in to Kyte");
    });

    it.each([
      [
        "is missing",
        undefined,
        "This password reset link is missing its token. Request a new link.",
      ],
      ["is too long", "t".repeat(257), "The token is invalid."],
      ["has control characters", "abc\u0000def", "The token is invalid."],
    ])("shows an error when the token %s", (_label, token, message) => {
      modal.show({ view: "reset-password", token });
      fill({ newPassword: "brand-new-pass" });
      submit();

      expect(alertText("error")).toBe(message);
      expect(client.resetPassword).not.toHaveBeenCalled();
    });

    it("works for a user who is already signed in", async () => {
      await signIn(alice);
      client.resetPassword.mockResolvedValueOnce({ reset: true });
      modal.show({ view: "reset-password", token: "reset-tok" });

      expect(heading()).toBe("Choose a new password");
      fill({ newPassword: "brand-new-pass" });
      submit();
      await flush();

      expect(client.resetPassword).toHaveBeenCalledWith("reset-tok", "brand-new-pass");
      expect(alertText("success")).toBe("Password reset. You can now log in.");
      // The server ended every session on reset, so this tab must sign out too.
      expect(authStore.getState().status).toBe("unauthenticated");
      expect(heading()).toBe("Sign in to Kyte");
      expect($("#authForm")).not.toBeNull();
      expect(client.logout).not.toHaveBeenCalled();
    });

    it("can go back to the login form", () => {
      modal.show({ view: "reset-password", token: "reset-tok" });
      $("#backToLoginLink")!.click();

      expect(heading()).toBe("Sign in to Kyte");
    });
  });

  describe("verify-email link", () => {
    const verifyButton = () => $<HTMLButtonElement>("#verifyEmailBtn")!;

    it("verifies, confirms and drops the token from the address bar", async () => {
      window.history.replaceState({}, "", "/verify-email?token=v-tok");
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      modal.show({ view: "verify-email", token: "v-tok" });

      expect(heading()).toBe("Verify your email");
      expect($("#tabLogin")).toBeNull();
      verifyButton().click();
      await flush();

      expect(client.verifyEmail).toHaveBeenCalledWith("v-tok");
      expect(alertText("success")).toBe("Email verified. You can continue using your account.");
      expect(heading()).toBe("Sign in to Kyte");
      expect(`${window.location.pathname}${window.location.search}`).toBe("/");
    });

    it("leaves an address without a token alone", async () => {
      window.history.replaceState({}, "", "/somewhere?tab=tools");
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      modal.show({ view: "verify-email", token: "v-tok" });
      verifyButton().click();
      await flush();

      expect(`${window.location.pathname}${window.location.search}`).toBe("/somewhere?tab=tools");
    });

    it("locks the button while verifying so the link is not spent twice", async () => {
      const verification = deferred<unknown>();
      client.verifyEmail.mockReturnValueOnce(verification.promise);
      modal.show({ view: "verify-email", token: "v-tok" });

      verifyButton().click();
      expect(verifyButton().disabled).toBe(true);
      expect(verifyButton().textContent?.trim()).toBe("Verifying…");

      verifyButton().click();
      expect(client.verifyEmail).toHaveBeenCalledTimes(1);

      verification.resolve({ verified: true });
      await flush();
      expect(alertText("success")).toBe("Email verified. You can continue using your account.");
      expect(alertText("error")).toBeUndefined();
    });

    it.each([
      ["the server's reason", new Error("Token expired"), "Token expired"],
      ["a generic message for non-Error failures", "nope", "Email verification failed."],
    ])("shows %s and lets the user retry", async (_label, failure, message) => {
      client.verifyEmail.mockRejectedValueOnce(failure);
      modal.show({ view: "verify-email", token: "v-tok" });
      verifyButton().click();
      await flush();

      expect(alertText("error")).toBe(message);
      expect(heading()).toBe("Verify your email");
      expect(verifyButton().disabled).toBe(false);
    });

    it("offers a way back to the login form", () => {
      modal.show({ view: "verify-email", token: "v-tok" });
      $("#backToLoginLink")!.click();

      expect(heading()).toBe("Sign in to Kyte");
      expect($('[name="email"]')).not.toBeNull();
    });

    it("offers a signed-in user a way back to the account and Log out", async () => {
      await signIn(alice);
      modal.show({ view: "verify-email", token: "v-tok" });
      $("#backToLoginLink")!.click();

      expect(heading()).toBe("Your Kyte account");
      expect($("#logoutBtn")).not.toBeNull();
    });

    it("does not come back on a plain open after a failed link", async () => {
      await signIn(alice);
      client.verifyEmail.mockRejectedValueOnce(new Error("Verification link has expired."));
      modal.show({ view: "verify-email", token: "used-tok" });
      verifyButton().click();
      await flush();
      expect(alertText("error")).toBe("Verification link has expired.");
      modal.close();

      // The Account button opens with no options.
      modal.show();

      expect(heading()).toBe("Your Kyte account");
      expect($("#logoutBtn")).not.toBeNull();
      expect($("#verifyEmailBtn")).toBeNull();
    });

    it("does not call the server without a token", () => {
      modal.show({ view: "verify-email" });
      verifyButton().click();

      expect(alertText("error")).toBe("The verification link is missing its token.");
      expect(client.verifyEmail).not.toHaveBeenCalled();
    });

    it("lets a signed-in user verify and then shows the account as verified", async () => {
      // Sign-up signs the user in, so this is the usual way the link is opened.
      await signIn({ ...alice, emailVerified: false });
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      client.getMe.mockResolvedValueOnce(alice);
      modal.show({ view: "verify-email", token: "v-tok" });

      expect(heading()).toBe("Verify your email");
      verifyButton().click();
      await flush();

      expect(client.verifyEmail).toHaveBeenCalledWith("v-tok");
      expect(heading()).toBe("Your Kyte account");
      expect(summaryRow("Status")).toBe("Verified");
      expect(alertText("success")).toBe("Email verified. You can continue using your account.");
    });
  });

  describe("signed-in account", () => {
    const logoutButton = () => $<HTMLButtonElement>("#logoutBtn")!;

    it("drops an earlier success notice when logging out", async () => {
      client.signUp.mockResolvedValueOnce({ ...bob, emailVerified: false });
      client.logout.mockResolvedValueOnce(undefined);
      modal.show();
      $("#tabSignup")!.click();
      fill({ email: bob.email, password: "longenough" });
      submit();
      await flush();
      expect(alertText("success")).toContain("Account created.");

      $("#logoutBtn")!.click();
      await flush();

      expect(heading()).toBe("Create a Kyte account");
      expect(alertText("success")).toBeUndefined();
    });

    it("escapes the email address in the summary", async () => {
      await signIn({ ...alice, email: '"<b>x</b>"@example.com' });
      modal.show();

      expect(modal.querySelector(".account-summary b")).toBeNull();
      expect(summaryRow("Email")).toBe('"<b>x</b>"@example.com');
    });

    it("logs out, locking the button meanwhile, and returns to the login form", async () => {
      await signIn(alice);
      const logout = deferred<void>();
      client.logout.mockReturnValueOnce(logout.promise);
      modal.show();

      logoutButton().click();
      expect(logoutButton().disabled).toBe(true);
      expect(logoutButton().textContent?.trim()).toBe("Logging out…");
      logoutButton().click();
      expect(client.logout).toHaveBeenCalledTimes(1);

      logout.resolve();
      await flush();

      expect(heading()).toBe("Sign in to Kyte");
      expect($('[name="email"]')).not.toBeNull();
    });

    it.each([
      ["the server's reason", new Error("Failed to fetch"), "Failed to fetch"],
      ["a generic message for non-Error failures", "nope", "Logout failed."],
    ])("shows %s when logout fails and stays signed in", async (_label, failure, message) => {
      await signIn(alice);
      client.logout.mockRejectedValueOnce(failure);
      modal.show();
      logoutButton().click();
      await flush();

      expect(alertText("error")).toBe(message);
      expect(heading()).toBe("Your Kyte account");
      expect(logoutButton().disabled).toBe(false);
    });

    it("follows sign-in and sign-out in other tabs while open", () => {
      modal.show();

      otherTab({ type: "login", user: bob });
      expect(heading()).toBe("Your Kyte account");
      expect(summaryRow("Email")).toBe(bob.email);

      otherTab({ type: "logout" });
      expect(heading()).toBe("Sign in to Kyte");
    });

    it("does not wipe a half-typed form on a repeated signed-out notice", () => {
      modal.show();
      fill({ email: alice.email });

      otherTab({ type: "logout" });

      expect(field("email").value).toBe(alice.email);
    });
  });

  describe("service states", () => {
    const stubState = (state: AuthState) => vi.spyOn(authStore, "getState").mockReturnValue(state);

    it("shows a loading notice, not the form, while the session check runs", () => {
      stubState({ status: "loading", user: null, error: null });
      modal.show();

      expect($(".account-loading")?.textContent?.trim()).toBe("Loading account…");
      expect($("#authForm")).toBeNull();
    });

    it("explains that accounts are off in builds without an auth server", () => {
      config.auth.oauthProviders = ["google"];
      stubState({ status: "unavailable", user: null, error: null });
      modal.show();

      expect(alertText("info")).toContain("Account sign-in is not enabled in this build");
      expect($("#authForm")).toBeNull();
      expect($("#tabLogin")).toBeNull();
      expect($("#btnGoogle")).toBeNull();
    });

    it("disables the form if the client reports the service is unavailable", () => {
      config.auth.oauthProviders = ["google"];
      client.isAvailable = false;
      modal.show();

      expect(field("email").disabled).toBe(true);
      expect(field("password").disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect($("#btnGoogle")).toBeNull();
    });
  });

  describe("OAuth", () => {
    it("offers the configured providers and starts their sign-in", () => {
      config.auth.oauthProviders = ["google", "github"];
      modal.show();

      $("#btnGoogle")!.click();
      $("#btnGithub")!.click();

      expect(client.openOAuth.mock.calls).toEqual([["google"], ["github"]]);
    });

    it("shows only the providers that are configured", () => {
      config.auth.oauthProviders = ["github"];
      modal.show();

      expect($("#btnGoogle")).toBeNull();
      expect($("#btnGithub")).not.toBeNull();
    });

    it("hides the OAuth section when no provider is configured", () => {
      modal.show();

      expect($(".oauth-divider")).toBeNull();
      expect($(".oauth-actions")).toBeNull();
    });

    it("hides OAuth on the forgot-password view", () => {
      config.auth.oauthProviders = ["google"];
      modal.show();
      $("#forgotLink")!.click();

      expect($("#btnGoogle")).toBeNull();
    });
  });
});
