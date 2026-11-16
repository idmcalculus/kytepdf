import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundParticle,
  bootstrapKytePdf,
  createBackgroundAnimator,
  DASHBOARD_MARKUP,
  installBackground,
  installErrorHandlers,
  installGlobalActions,
  installRouter,
  installServiceWorkerRegistration,
  routeTool,
  setMainMarkup,
  showDashboard,
  TOOL_ROUTES,
} from "../../utils/appBootstrap";

const createLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
});

describe("appBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <canvas id="bg-canvas"></canvas>
      <div id="main-container"></div>
      <div id="globalDialog"></div>
      <div id="aboutModal"></div>
    `;
    (document.getElementById("globalDialog") as any).show = vi.fn();
    (document.getElementById("aboutModal") as any).show = vi.fn();
    sessionStorage.clear();
  });

  it("sets dashboard and tool route markup", () => {
    const main = document.getElementById("main-container") as HTMLElement;

    showDashboard(main);
    expect(main.innerHTML).toBe(DASHBOARD_MARKUP);

    for (const route of TOOL_ROUTES) {
      routeTool(main, route.toolId);
      expect(main.innerHTML).toBe(route.markup);
    }

    setMainMarkup(null, "<pdf-merge></pdf-merge>");
    routeTool(main, "unknown-tool");
    expect(main.innerHTML).toBe(TOOL_ROUTES.at(-1)?.markup);
  });

  it("installs global about action", () => {
    installGlobalActions();

    (window as any).showAbout();
    expect((document.getElementById("aboutModal") as any).show).toHaveBeenCalled();
    expect((window as any).ensureCloudConsent).toBeUndefined();
  });

  it("installs runtime and promise rejection error handlers", () => {
    const logger = createLogger();
    installErrorHandlers({ logger });
    const dialog = document.getElementById("globalDialog") as any;

    const result = window.onerror?.("boom", "main.ts", 10, 2, new Error("password incorrect"));
    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "Unhandled runtime error",
      expect.objectContaining({ message: "boom" }),
    );
    expect(dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Something went wrong",
        type: "error",
        message: expect.stringContaining("password is incorrect"),
      }),
    );

    window.onunhandledrejection?.({ reason: new Error("async failed") } as PromiseRejectionEvent);
    expect(logger.error).toHaveBeenCalledWith("Unhandled Promise Rejection", {
      reason: expect.any(Error),
    });
    expect(dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Operation Failed", type: "error" }),
    );
  });

  it("routes tool selection and dashboard events", () => {
    const logger = createLogger();
    installRouter({ logger });
    const main = document.getElementById("main-container") as HTMLElement;

    expect(main.innerHTML).toBe(DASHBOARD_MARKUP);

    window.dispatchEvent(new CustomEvent("tool-select", { detail: { toolId: "protect" } }));
    expect(main.innerHTML).toBe('<pdf-security mode="protect"></pdf-security>');

    window.dispatchEvent(new CustomEvent("back-to-dashboard"));
    expect(main.innerHTML).toBe(DASHBOARD_MARKUP);
    expect(logger.info).toHaveBeenCalledWith("Tool selected", { toolId: "protect" });
  });

  it("registers and refreshes the production service worker", async () => {
    const logger = createLogger();
    const loadCallbacks: Array<() => void> = [];
    const controllerCallbacks: Array<() => void> = [];
    const waiting = { postMessage: vi.fn() };
    const installing = {
      state: "installed",
      addEventListener: vi.fn((_event: string, cb: () => void) => cb()),
      postMessage: vi.fn(),
    };
    const registration = {
      addEventListener: vi.fn((_event: string, cb: () => void) => cb()),
      installing,
      update: vi.fn(),
      waiting,
    };
    const appNavigator = {
      serviceWorker: {
        addEventListener: vi.fn((_event: string, cb: () => void) => controllerCallbacks.push(cb)),
        controller: {},
        register: vi.fn().mockResolvedValue(registration),
      },
    } as unknown as Navigator;
    const dialogMock = {
      show: vi.fn().mockResolvedValue(true),
    };
    const doc = {
      getElementById: vi.fn((id: string) => (id === "globalDialog" ? dialogMock : null)),
    };
    const win = {
      addEventListener: vi.fn((_event: string, cb: () => void) => loadCallbacks.push(cb)),
      location: { reload: vi.fn() },
      document: doc,
    } as unknown as Window;

    installServiceWorkerRegistration({ logger, navigator: appNavigator, prod: true, window: win });
    loadCallbacks[0]();
    await Promise.resolve();

    expect(appNavigator.serviceWorker.register).toHaveBeenCalledWith("/sw.js");
    expect(registration.update).toHaveBeenCalled();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    controllerCallbacks[0]();
    await Promise.resolve(); // Wait for the dialog promise
    expect(dialogMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("offline workspace"),
        title: "Refreshing Offline Tools",
      }),
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    // Try again with rejected dialog
    dialogMock.show.mockResolvedValueOnce(false);
    controllerCallbacks[0](); // Note: hasRefreshedForServiceWorker is true now so it returns early
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("does not show update prompts during first-time service worker installation", async () => {
    const logger = createLogger();
    const loadCallbacks: Array<() => void> = [];
    const controllerCallbacks: Array<() => void> = [];
    const waiting = { postMessage: vi.fn() };
    const registration = {
      addEventListener: vi.fn(),
      update: vi.fn(),
      waiting,
    };
    const appNavigator = {
      serviceWorker: {
        addEventListener: vi.fn((_event: string, cb: () => void) => controllerCallbacks.push(cb)),
        controller: null,
        register: vi.fn().mockResolvedValue(registration),
      },
    } as unknown as Navigator;
    const dialogMock = {
      show: vi.fn().mockResolvedValue(true),
    };
    const win = {
      addEventListener: vi.fn((_event: string, cb: () => void) => loadCallbacks.push(cb)),
      location: { reload: vi.fn() },
      document: {
        getElementById: vi.fn((id: string) => (id === "globalDialog" ? dialogMock : null)),
      },
    } as unknown as Window;

    installServiceWorkerRegistration({ logger, navigator: appNavigator, prod: true, window: win });
    loadCallbacks[0]();
    await Promise.resolve();

    expect(waiting.postMessage).not.toHaveBeenCalled();

    controllerCallbacks[0]();
    await Promise.resolve();

    expect(dialogMock.show).not.toHaveBeenCalled();
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it("skips service worker registration outside production or unsupported browsers", () => {
    const appNavigator = {} as Navigator;
    const win = { addEventListener: vi.fn() } as unknown as Window;

    installServiceWorkerRegistration({ navigator: appNavigator, prod: false, window: win });
    installServiceWorkerRegistration({ navigator: appNavigator, prod: true, window: win });

    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it("reloads immediately on service worker update if globalDialog is missing", async () => {
    const logger = createLogger();
    const controllerCallbacks: Array<() => void> = [];
    const appNavigator = {
      serviceWorker: {
        addEventListener: vi.fn((_event: string, cb: () => void) => controllerCallbacks.push(cb)),
        controller: {},
        register: vi.fn().mockResolvedValue({ addEventListener: vi.fn(), update: vi.fn() }),
      },
    } as unknown as Navigator;
    const doc = {
      getElementById: vi.fn(() => null),
    };
    const win = {
      addEventListener: vi.fn(),
      location: { reload: vi.fn() },
      document: doc,
    } as unknown as Window;

    installServiceWorkerRegistration({ logger, navigator: appNavigator, prod: true, window: win });

    // Trigger update
    controllerCallbacks[0]();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("logs service worker registration failures", async () => {
    const logger = createLogger();
    const loadCallbacks: Array<() => void> = [];
    const error = new Error("nope");
    const appNavigator = {
      serviceWorker: {
        addEventListener: vi.fn(),
        register: vi.fn().mockRejectedValue(error),
      },
    } as unknown as Navigator;
    const win = {
      addEventListener: vi.fn((_event: string, cb: () => void) => loadCallbacks.push(cb)),
      location: { reload: vi.fn() },
    } as unknown as Window;

    installServiceWorkerRegistration({ logger, navigator: appNavigator, prod: true, window: win });
    loadCallbacks[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith("Service worker registration failed", error);
  });

  it("updates and draws background particles", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const mouse = { x: null as number | null, y: null as number | null };
    const particle = new BackgroundParticle(canvas, mouse, () => 0.5);
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    particle.x = 10;
    particle.y = 10;
    particle.speedX = 500;
    particle.speedY = -500;
    particle.update();
    expect(particle.x).toBe(0);
    expect(particle.y).toBe(100);

    particle.x = 10;
    particle.y = 10;
    particle.speedX = 0;
    particle.speedY = 0;
    mouse.x = 20;
    mouse.y = 20;
    particle.update();
    expect(particle.x).toBeLessThan(10);

    particle.draw(ctx);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("creates a controllable background animator", () => {
    const canvas = document.createElement("canvas");
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
      lineTo: vi.fn(),
      lineWidth: 0,
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;
    canvas.getContext = vi.fn(() => ctx) as any;
    const requestFrame = vi.fn(() => 1);

    const animator = createBackgroundAnimator({
      canvas,
      particleCount: 2,
      random: () => 0.5,
      requestAnimationFrame: requestFrame,
      window,
    });

    animator.start();
    expect(canvas.width).toBe(window.innerWidth);
    expect(canvas.height).toBe(window.innerHeight);
    expect(animator.particles).toHaveLength(2);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 42, clientY: 24 }));
    expect(animator.mouse).toEqual({ x: 42, y: 24 });
  });

  it("returns null when no background canvas is present", () => {
    document.getElementById("bg-canvas")?.remove();
    expect(installBackground()).toBeNull();
  });

  it("bootstraps the application by calling all installers", () => {
    const logger = createLogger();
    const appNavigator = {
      serviceWorker: {
        addEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue({ addEventListener: vi.fn(), update: vi.fn() }),
      },
    } as unknown as Navigator;
    const doc = {
      getElementById: vi.fn(() => null),
    };
    const win = {
      addEventListener: vi.fn(),
      location: { href: "http://localhost/", reload: vi.fn() },
      history: { replaceState: vi.fn() },
      document: doc,
    } as unknown as Window;

    const result = bootstrapKytePdf({
      prod: true,
      document: doc as unknown as Document,
      logger,
      navigator: appNavigator,
      window: win,
    });

    expect(logger.info).toHaveBeenCalledWith("KytePDF Application Starting");
    expect(result).toBeNull(); // Because getElementById("bg-canvas") returns null
  });

  describe("service worker update prompts", () => {
    it("keeps the page when the user declines the reload or a worker is still installing", async () => {
      const controllerCallbacks: Array<() => void> = [];
      const loadCallbacks: Array<() => void> = [];
      const installing = {
        state: "installing",
        addEventListener: vi.fn((_event: string, cb: () => void) => cb()),
        postMessage: vi.fn(),
      };
      const appNavigator = {
        serviceWorker: {
          addEventListener: vi.fn((_event: string, cb: () => void) => controllerCallbacks.push(cb)),
          controller: {},
          register: vi.fn().mockResolvedValue({
            addEventListener: vi.fn((_event: string, cb: () => void) => cb()),
            installing,
            update: vi.fn(),
          }),
        },
      } as unknown as Navigator;
      const dialog = { show: vi.fn().mockResolvedValue(false) };
      const win = {
        addEventListener: vi.fn((_event: string, cb: () => void) => loadCallbacks.push(cb)),
        location: { reload: vi.fn() },
        document: { getElementById: vi.fn(() => dialog) },
      } as unknown as Window;

      installServiceWorkerRegistration({
        logger: createLogger(),
        navigator: appNavigator,
        prod: true,
        window: win,
      });
      loadCallbacks[0]();
      await Promise.resolve();
      expect(installing.postMessage).not.toHaveBeenCalled();

      controllerCallbacks[0]();
      await Promise.resolve();
      await Promise.resolve();
      expect(dialog.show).toHaveBeenCalledTimes(1);
      expect(win.location.reload).not.toHaveBeenCalled();
    });
  });

  describe("account deep links", () => {
    const fakeWindow = (href: string) => ({ location: { href } }) as unknown as Window;

    it.each([
      ["/verify-email", "verify-email"],
      ["/reset-password", "reset-password"],
    ])("opens the account modal for %s links that carry a token", (path, view) => {
      const accountModal = { show: vi.fn() };
      const doc = {
        getElementById: vi.fn((id: string) => (id === "accountModal" ? accountModal : null)),
      } as unknown as Document;

      installGlobalActions({
        document: doc,
        window: fakeWindow(`https://kyte.test${path}?token=abc`),
      });

      expect(accountModal.show).toHaveBeenCalledWith({ view, token: "abc" });
    });

    it("ignores account links without a token and other paths", () => {
      const accountModal = { show: vi.fn() };
      const doc = { getElementById: vi.fn(() => accountModal) } as unknown as Document;

      installGlobalActions({ document: doc, window: fakeWindow("https://kyte.test/verify-email") });
      installGlobalActions({ document: doc, window: fakeWindow("https://kyte.test/?token=abc") });

      expect(accountModal.show).not.toHaveBeenCalled();
    });

    it("does nothing when the about or account modal is missing", () => {
      const win = fakeWindow("https://kyte.test/");
      const doc = { getElementById: vi.fn(() => null) } as unknown as Document;
      installGlobalActions({ document: doc, window: win });

      expect(() => (win as any).showAbout()).not.toThrow();
      expect(() => (win as any).showAccountModal({ view: "login" })).not.toThrow();
    });
  });

  describe("error handler fallbacks", () => {
    it("maps the message when no error object is given and skips a missing dialog", () => {
      const logger = createLogger();
      const dialog = document.getElementById("globalDialog") as any;
      installErrorHandlers({ logger });

      window.onerror?.("Script error.", "", 0, 0, undefined);
      expect(logger.error).toHaveBeenCalledWith(
        "Unhandled runtime error",
        expect.objectContaining({ message: "Script error.", error: undefined }),
      );
      expect(dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Something went wrong", type: "error" }),
      );

      dialog.remove();
      dialog.show.mockClear();
      expect(window.onerror?.("boom", "", 0, 0, new Error("boom"))).toBe(false);
      window.onunhandledrejection?.({ reason: "nope" } as PromiseRejectionEvent);
      expect(dialog.show).not.toHaveBeenCalled();
    });
  });

  describe("background", () => {
    it("wraps particles that leave the left or top edge", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 100;
      const particle = new BackgroundParticle(canvas, { x: null, y: null }, () => 0.5);

      particle.x = 1;
      particle.y = 1;
      particle.speedX = -5;
      particle.speedY = -5;
      particle.update();

      expect(particle.x).toBe(200);
      expect(particle.y).toBe(100);

      particle.speedX = 0;
      particle.speedY = 5;
      particle.update();
      expect(particle.y).toBe(0);
    });

    it("leaves particles alone when the mouse is far away", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 1000;
      const particle = new BackgroundParticle(canvas, { x: 900, y: 900 }, () => 0.5);
      particle.x = 10;
      particle.y = 10;
      particle.speedX = 0;
      particle.speedY = 0;

      particle.update();

      expect(particle).toMatchObject({ x: 10, y: 10 });
    });

    it("skips drawing when the canvas has no 2D context", () => {
      const canvas = document.createElement("canvas");
      canvas.getContext = vi.fn(() => null) as any;
      const requestFrame = vi.fn(() => 1);

      createBackgroundAnimator({ canvas, requestAnimationFrame: requestFrame, window }).start();

      expect(requestFrame).not.toHaveBeenCalled();
    });

    it("starts the animator on the page's background canvas", () => {
      const canvas = document.getElementById("bg-canvas") as HTMLCanvasElement;
      const ctx = {
        arc: vi.fn(),
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        fill: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        stroke: vi.fn(),
      };
      canvas.getContext = vi.fn(() => ctx) as any;
      const requestFrame = vi.fn(() => 1);

      const animator = installBackground({ requestAnimationFrame: requestFrame });

      expect(animator?.particles).toHaveLength(80);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
      expect(requestFrame).toHaveBeenCalledWith(animator?.animate);
    });
  });
});
