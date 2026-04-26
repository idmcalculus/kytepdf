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
      <div id="cloudConsentModal"></div>
    `;
    (document.getElementById("globalDialog") as any).show = vi.fn();
    (document.getElementById("aboutModal") as any).show = vi.fn();
    (document.getElementById("cloudConsentModal") as any).show = vi.fn().mockResolvedValue(true);
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

  it("installs global about and cloud consent actions", async () => {
    installGlobalActions();

    (window as any).showAbout();
    expect((document.getElementById("aboutModal") as any).show).toHaveBeenCalled();

    await expect((window as any).ensureCloudConsent()).resolves.toBe(true);
    expect(sessionStorage.getItem("kyte_cloud_consent")).toBe("true");

    (document.getElementById("cloudConsentModal") as any).show.mockClear();
    await expect((window as any).ensureCloudConsent()).resolves.toBe(true);
    expect((document.getElementById("cloudConsentModal") as any).show).toHaveBeenCalled();

    sessionStorage.clear();
    document.getElementById("cloudConsentModal")?.remove();
    await expect((window as any).ensureCloudConsent()).resolves.toBe(false);
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
      expect.objectContaining({ title: "Update Available" }),
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);

    // Try again with rejected dialog
    dialogMock.show.mockResolvedValueOnce(false);
    controllerCallbacks[0](); // Note: hasRefreshedForServiceWorker is true now so it returns early
    expect(win.location.reload).toHaveBeenCalledTimes(1);
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
      location: { reload: vi.fn() },
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
});
