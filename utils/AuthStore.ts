import { authClient } from "./AuthClient.ts";
import { logger } from "./logger.ts";

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
}

type Subscriber = (state: AuthState) => void;

// BroadcastChannel message types for cross-tab sync
type SyncMessage = { type: "login"; user: User } | { type: "logout" };

class AuthStore {
  private state: AuthState = { status: "loading", user: null, error: null };
  private initialized = false;
  private subscribers: Set<Subscriber> = new Set();
  private channel: BroadcastChannel | null = null;
  /**
   * Monotonically increasing counter. Bumped when any action (login, signup,
   * logout, or cross-tab sync) definitively sets auth state. `init()` captures
   * this before its network call and discards its result if it changed.
   */
  private stateRevision = 0;
  /** The session check in flight, shared by overlapping init() calls. */
  private initPromise: Promise<void> | null = null;

  constructor() {
    if (!authClient.isAvailable) {
      this.state = { status: "unavailable", user: null, error: null };
      this.initialized = true;
      return;
    }

    // Cross-tab sync via BroadcastChannel
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("kyte_auth");
      this.channel.addEventListener("message", (event: MessageEvent<SyncMessage>) => {
        const msg = event.data;
        this.stateRevision++;
        this.initialized = true;
        if (msg.type === "login") {
          this.state = { status: "authenticated", user: msg.user, error: null };
        } else if (msg.type === "logout") {
          this.state = { status: "unauthenticated", user: null, error: null };
        }
        this.notify();
      });
    }
  }

  subscribe(callback: Subscriber) {
    this.subscribers.add(callback);
    if (this.initialized) {
      callback(this.state);
    }
    return () => this.subscribers.delete(callback);
  }

  private notify() {
    for (const callback of this.subscribers) {
      callback(this.state);
    }
  }

  private broadcast(msg: SyncMessage) {
    this.channel?.postMessage(msg);
  }

  init(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    // A second caller joins the pending check rather than starting another.
    this.initPromise ??= this.checkSession();
    return this.initPromise;
  }

  private async checkSession() {
    this.state = { status: "loading", user: null, error: null };
    this.notify();

    const revisionAtStart = this.stateRevision;

    try {
      const user = await authClient.getMe();
      // If any auth action occurred while we were fetching, discard this result.
      if (this.stateRevision !== revisionAtStart) return;
      this.state = { status: "authenticated", user, error: null };
    } catch {
      if (this.stateRevision !== revisionAtStart) return;
      // Not logged in — this is the normal unauthenticated case, not an error.
      this.state = { status: "unauthenticated", user: null, error: null };
    } finally {
      // Only mark initialized if we weren't preempted.
      if (this.stateRevision === revisionAtStart) {
        this.initialized = true;
        this.notify();
      }
    }
  }

  /** Current auth state snapshot. */
  getState(): AuthState {
    return this.state;
  }

  /** Convenience accessor — null when not authenticated. */
  getUser(): User | null {
    return this.state.user;
  }

  async login(credentials: Record<string, string>) {
    const user = await authClient.login(credentials);
    // Bump revision AFTER success so a failed login doesn't orphan the store.
    this.stateRevision++;
    this.state = { status: "authenticated", user, error: null };
    this.initialized = true;
    this.notify();
    this.broadcast({ type: "login", user });
    return user;
  }

  async signUp(credentials: Record<string, string>) {
    const user = await authClient.signUp(credentials);
    this.stateRevision++;
    this.state = { status: "authenticated", user, error: null };
    this.initialized = true;
    this.notify();
    this.broadcast({ type: "login", user });
    return user;
  }

  async logout() {
    await authClient.logout();
    this.stateRevision++;
    this.state = { status: "unauthenticated", user: null, error: null };
    this.initialized = true;
    this.notify();
    this.broadcast({ type: "logout" });
  }

  /** Sign out locally, without a server call, after the server has already ended the session (e.g. a password reset). */
  markSignedOut() {
    this.stateRevision++;
    this.state = { status: "unauthenticated", user: null, error: null };
    this.initialized = true;
    this.notify();
    this.broadcast({ type: "logout" });
  }

  async verifyEmail(token: string) {
    const res = await authClient.verifyEmail(token);
    // Reload user to pick up the updated emailVerified flag.
    if (this.state.user) {
      const revisionAtStart = this.stateRevision;
      try {
        const user = await authClient.getMe();
        // A login, logout or cross-tab sync happened during the reload; keep that state.
        if (this.stateRevision !== revisionAtStart) return res;
        this.stateRevision++;
        this.state = { status: "authenticated", user, error: null };
        this.notify();
        this.broadcast({ type: "login", user });
      } catch {
        // Non-fatal — verification succeeded even if the reload fails.
      }
    }
    return res;
  }
}

export const authStore = new AuthStore();

// Initialize on load; errors here are unexpected (network issues, etc.)
authStore.init().catch((err) => logger.error("AuthStore init error", err));
