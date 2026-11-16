import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState, User } from "../../utils/AuthStore.ts";

const { client, logger } = vi.hoisted(() => ({
  client: {
    isAvailable: true,
    getMe: vi.fn(),
    login: vi.fn(),
    signUp: vi.fn(),
    logout: vi.fn(),
    verifyEmail: vi.fn(),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../utils/AuthClient.ts", () => ({ authClient: client }));
vi.mock("../../utils/logger.ts", () => ({ logger }));

/** Stands in for BroadcastChannel so tests can play the part of another tab. */
class FakeChannel {
  static instances: FakeChannel[] = [];
  readonly posted: unknown[] = [];
  private readonly listeners: Array<(event: MessageEvent) => void> = [];

  constructor(readonly name: string) {
    FakeChannel.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.push(listener);
  }

  postMessage(data: unknown) {
    this.posted.push(data);
  }

  /** Delivers a message as if another tab had posted it. */
  deliver(data: unknown) {
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }
}

const alice: User = {
  id: "u1",
  email: "alice@example.com",
  emailVerified: false,
  createdAt: "2026-01-02T00:00:00.000Z",
};
const bob: User = {
  id: "u2",
  email: "bob@example.com",
  emailVerified: true,
  createdAt: "2026-02-03T00:00:00.000Z",
};
const signedOut: AuthState = { status: "unauthenticated", user: null, error: null };
const signedIn = (user: User): AuthState => ({ status: "authenticated", user, error: null });

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

/** Imports a fresh store, which (like a page load) starts its session check at once. */
async function loadStore() {
  vi.resetModules();
  const { authStore } = await import("../../utils/AuthStore.ts");
  return authStore;
}

/** A fresh store whose start-up check found no session. */
async function loadSignedOutStore() {
  client.getMe.mockRejectedValueOnce(new Error("No session"));
  const store = await loadStore();
  await flush();
  return store;
}

describe("AuthStore", () => {
  beforeEach(() => {
    client.isAvailable = true;
    for (const fn of [
      client.getMe,
      client.login,
      client.signUp,
      client.logout,
      client.verifyEmail,
    ]) {
      fn.mockReset();
    }
    logger.error.mockReset();
    FakeChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("start-up", () => {
    it("checks the session once and reports the signed-in user", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();

      expect(store.getState()).toEqual({ status: "loading", user: null, error: null });
      const seen: AuthState[] = [];
      store.subscribe((state) => seen.push(state));
      // Nothing to report until the check finishes.
      expect(seen).toEqual([]);

      session.resolve(alice);
      await flush();

      expect(seen).toEqual([signedIn(alice)]);
      expect(store.getUser()).toBe(alice);

      // A second init() after the check has settled must not hit the server again.
      await store.init();
      expect(client.getMe).toHaveBeenCalledTimes(1);
    });

    it("treats a failed session check as signed out, not as an error", async () => {
      const store = await loadSignedOutStore();

      expect(store.getState()).toEqual(signedOut);
      expect(store.getUser()).toBeNull();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("reports unavailable without contacting the server when auth is not configured", async () => {
      client.isAvailable = false;
      const store = await loadStore();
      await store.init();

      const listener = vi.fn();
      store.subscribe(listener);

      expect(listener).toHaveBeenCalledWith({ status: "unavailable", user: null, error: null });
      expect(client.getMe).not.toHaveBeenCalled();
      expect(FakeChannel.instances).toHaveLength(0);
    });

    it("shares one pending session check between overlapping init() calls", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();
      const seen: AuthState[] = [];
      store.subscribe((state) => seen.push(state));

      // Callers that init() again while the first check runs must not send
      // another /auth/me or announce "loading" a second time.
      const again = store.init();
      const andAgain = store.init();
      expect(client.getMe).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([]);

      session.resolve(alice);
      await Promise.all([again, andAgain]);

      expect(seen).toEqual([signedIn(alice)]);
      expect(client.getMe).toHaveBeenCalledTimes(1);
    });

    it("logs an unexpected start-up failure instead of leaving it unhandled", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();
      const failure = new Error("subscriber blew up");
      store.subscribe(() => {
        throw failure;
      });

      session.resolve(alice);
      await flush();

      expect(logger.error).toHaveBeenCalledWith("AuthStore init error", failure);
    });
  });

  describe("subscriptions", () => {
    it("gives late subscribers the current state and stops after unsubscribe", async () => {
      const store = await loadSignedOutStore();
      const listener = vi.fn();

      const unsubscribe = store.subscribe(listener);
      expect(listener).toHaveBeenCalledExactlyOnceWith(signedOut);

      unsubscribe();
      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("login and sign-up", () => {
    it("login signs the user in, notifies subscribers and tells other tabs", async () => {
      const store = await loadSignedOutStore();
      const listener = vi.fn();
      store.subscribe(listener);
      client.login.mockResolvedValueOnce(alice);

      const credentials = { email: alice.email, password: "pw" };
      await expect(store.login(credentials)).resolves.toBe(alice);

      expect(client.login).toHaveBeenCalledWith(credentials);
      expect(store.getState()).toEqual(signedIn(alice));
      expect(listener).toHaveBeenLastCalledWith(signedIn(alice));
      expect(FakeChannel.instances[0].name).toBe("kyte_auth");
      expect(FakeChannel.instances[0].posted).toEqual([{ type: "login", user: alice }]);
    });

    it("a failed login leaves the state alone and tells no one", async () => {
      const store = await loadSignedOutStore();
      const listener = vi.fn();
      store.subscribe(listener);
      client.login.mockRejectedValueOnce(new Error("Invalid credentials"));

      await expect(store.login({ email: alice.email, password: "bad" })).rejects.toThrow(
        "Invalid credentials",
      );

      expect(store.getState()).toEqual(signedOut);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(FakeChannel.instances[0].posted).toEqual([]);
    });

    it("sign-up signs the new user in and tells other tabs", async () => {
      const store = await loadSignedOutStore();
      client.signUp.mockResolvedValueOnce(bob);

      const credentials = { email: bob.email, password: "longenough" };
      await expect(store.signUp(credentials)).resolves.toBe(bob);

      expect(client.signUp).toHaveBeenCalledWith(credentials);
      expect(store.getState()).toEqual(signedIn(bob));
      expect(FakeChannel.instances[0].posted).toEqual([{ type: "login", user: bob }]);
    });

    it("a login that lands while the start-up check is pending is not overwritten by it", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();
      const listener = vi.fn();
      store.subscribe(listener);

      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });
      // The slow start-up check now fails (it went out before the login cookie existed).
      session.reject(new Error("401"));
      await flush();

      expect(store.getState()).toEqual(signedIn(alice));
      expect(listener).toHaveBeenCalledExactlyOnceWith(signedIn(alice));
    });
  });

  describe("logout", () => {
    it("signs out, notifies subscribers and tells other tabs", async () => {
      const store = await loadSignedOutStore();
      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });
      const listener = vi.fn();
      store.subscribe(listener);
      client.logout.mockResolvedValueOnce(undefined);

      await store.logout();

      expect(store.getState()).toEqual(signedOut);
      expect(listener).toHaveBeenLastCalledWith(signedOut);
      expect(FakeChannel.instances[0].posted.at(-1)).toEqual({ type: "logout" });
    });

    it("stays signed in when the server call fails", async () => {
      const store = await loadSignedOutStore();
      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });
      client.logout.mockRejectedValueOnce(new Error("Failed to fetch"));

      await expect(store.logout()).rejects.toThrow("Failed to fetch");

      expect(store.getState()).toEqual(signedIn(alice));
      expect(FakeChannel.instances[0].posted).toEqual([{ type: "login", user: alice }]);
    });
  });

  describe("markSignedOut", () => {
    it("signs out locally and tells other tabs, without a server call", async () => {
      const store = await loadSignedOutStore();
      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });
      const listener = vi.fn();
      store.subscribe(listener);

      store.markSignedOut();

      expect(store.getState()).toEqual(signedOut);
      expect(listener).toHaveBeenLastCalledWith(signedOut);
      expect(FakeChannel.instances[0].posted.at(-1)).toEqual({ type: "logout" });
      expect(client.logout).not.toHaveBeenCalled();
    });

    it("wins over a start-up check still in flight", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();

      store.markSignedOut();
      session.resolve(alice);
      await flush();

      expect(store.getState()).toEqual(signedOut);
    });
  });

  describe("verifyEmail", () => {
    async function loadAliceStore() {
      const store = await loadSignedOutStore();
      client.login.mockResolvedValueOnce(alice);
      await store.login({ email: alice.email, password: "pw" });
      return store;
    }

    it("reloads the signed-in user so the verified flag is current", async () => {
      const store = await loadAliceStore();
      const verifiedAlice = { ...alice, emailVerified: true };
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      client.getMe.mockResolvedValueOnce(verifiedAlice);
      const listener = vi.fn();
      store.subscribe(listener);

      await expect(store.verifyEmail("tok-123")).resolves.toEqual({ verified: true });

      expect(client.verifyEmail).toHaveBeenCalledWith("tok-123");
      expect(store.getUser()).toEqual(verifiedAlice);
      expect(listener).toHaveBeenLastCalledWith(signedIn(verifiedAlice));
      expect(FakeChannel.instances[0].posted.at(-1)).toEqual({
        type: "login",
        user: verifiedAlice,
      });
    });

    it("still succeeds when reloading the user fails", async () => {
      const store = await loadAliceStore();
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      client.getMe.mockRejectedValueOnce(new Error("Failed to fetch"));

      await expect(store.verifyEmail("tok-123")).resolves.toEqual({ verified: true });

      expect(store.getState()).toEqual(signedIn(alice));
    });

    it("does not reload a user when nobody is signed in", async () => {
      const store = await loadSignedOutStore();
      client.verifyEmail.mockResolvedValueOnce({ verified: true });

      await store.verifyEmail("tok-123");

      // Only the start-up check called getMe.
      expect(client.getMe).toHaveBeenCalledTimes(1);
      expect(store.getState()).toEqual(signedOut);
    });

    it.each([
      ["a sign-out", { type: "logout" }, signedOut],
      ["a different sign-in", { type: "login", user: bob }, signedIn(bob)],
    ])("does not let a slow reload undo %s from another tab", async (_label, message, expected) => {
      const store = await loadAliceStore();
      const reload = deferred<User>();
      client.verifyEmail.mockResolvedValueOnce({ verified: true });
      client.getMe.mockReturnValueOnce(reload.promise);

      const verifying = store.verifyEmail("tok-123");
      await flush();
      FakeChannel.instances[0].deliver(message);
      reload.resolve({ ...alice, emailVerified: true });

      await expect(verifying).resolves.toEqual({ verified: true });
      expect(store.getState()).toEqual(expected);
      // Only the original login was announced; the stale reload stayed quiet.
      expect(FakeChannel.instances[0].posted).toEqual([{ type: "login", user: alice }]);
    });

    it("passes verification failures to the caller", async () => {
      const store = await loadAliceStore();
      client.verifyEmail.mockRejectedValueOnce(new Error("Token expired"));

      await expect(store.verifyEmail("tok-123")).rejects.toThrow("Token expired");
      expect(store.getState()).toEqual(signedIn(alice));
    });
  });

  describe("cross-tab sync", () => {
    it("follows sign-in and sign-out in other tabs", async () => {
      const store = await loadSignedOutStore();
      const listener = vi.fn();
      store.subscribe(listener);
      const channel = FakeChannel.instances[0];

      channel.deliver({ type: "login", user: bob });
      expect(store.getState()).toEqual(signedIn(bob));
      expect(listener).toHaveBeenLastCalledWith(signedIn(bob));

      channel.deliver({ type: "logout" });
      expect(store.getState()).toEqual(signedOut);
      expect(listener).toHaveBeenLastCalledWith(signedOut);
      // Messages from other tabs are not echoed back.
      expect(channel.posted).toEqual([]);
    });

    it("a message from another tab wins over a pending start-up check", async () => {
      const session = deferred<User>();
      client.getMe.mockReturnValueOnce(session.promise);
      const store = await loadStore();

      FakeChannel.instances[0].deliver({ type: "logout" });
      // The store is settled now, so new subscribers hear the state at once.
      const listener = vi.fn();
      store.subscribe(listener);
      expect(listener).toHaveBeenCalledExactlyOnceWith(signedOut);

      session.resolve(alice);
      await flush();

      expect(store.getState()).toEqual(signedOut);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("still works where BroadcastChannel does not exist", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const store = await loadSignedOutStore();
      client.login.mockResolvedValueOnce(alice);

      await expect(store.login({ email: alice.email, password: "pw" })).resolves.toBe(alice);
      expect(store.getState()).toEqual(signedIn(alice));
      expect(FakeChannel.instances).toHaveLength(0);
    });
  });
});
