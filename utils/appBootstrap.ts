import { mapError } from "./errorMapper.ts";
import { logger } from "./logger.ts";

type AppLogger = Pick<typeof logger, "debug" | "error" | "info">;

export interface BootstrapOptions {
  prod: boolean;
  document?: Document;
  logger?: AppLogger;
  navigator?: Navigator;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  sessionStorage?: Storage;
  window?: Window;
}

type ToolRoute = {
  toolId: string;
  markup: string;
};

export const TOOL_ROUTES: ToolRoute[] = [
  { toolId: "compress", markup: "<pdf-compressor></pdf-compressor>" },
  { toolId: "merge", markup: "<pdf-merge></pdf-merge>" },
  { toolId: "split", markup: "<pdf-split></pdf-split>" },
  { toolId: "sign", markup: "<pdf-sign></pdf-sign>" },
  { toolId: "pdf-to-img", markup: "<pdf-to-image></pdf-to-image>" },
  { toolId: "img-to-pdf", markup: "<image-to-pdf></image-to-pdf>" },
  { toolId: "pdf-to-word", markup: '<pdf-to-office format="docx"></pdf-to-office>' },
  { toolId: "pdf-to-pp", markup: '<pdf-to-office format="pptx"></pdf-to-office>' },
  { toolId: "pdf-to-excel", markup: '<pdf-to-office format="xlsx"></pdf-to-office>' },
  { toolId: "word-to-pdf", markup: "<office-to-pdf></office-to-pdf>" },
  { toolId: "protect", markup: '<pdf-security mode="protect"></pdf-security>' },
  { toolId: "unprotect", markup: '<pdf-security mode="unprotect"></pdf-security>' },
  { toolId: "create-pdf", markup: "<pdf-creator></pdf-creator>" },
  { toolId: "edit", markup: "<pdf-editor></pdf-editor>" },
];

export const DASHBOARD_MARKUP = "<tool-dashboard></tool-dashboard>";

export function setMainMarkup(mainContainer: HTMLElement | null, markup: string) {
  if (mainContainer) {
    mainContainer.innerHTML = markup;
  }
}

export function routeTool(mainContainer: HTMLElement | null, toolId: string) {
  const route = TOOL_ROUTES.find((entry) => entry.toolId === toolId);
  if (route) {
    setMainMarkup(mainContainer, route.markup);
  }
}

export function showDashboard(mainContainer: HTMLElement | null) {
  setMainMarkup(mainContainer, DASHBOARD_MARKUP);
}

export function installGlobalActions({
  document: doc = document,
  sessionStorage: storage = sessionStorage,
  window: win = window,
}: Pick<BootstrapOptions, "document" | "sessionStorage" | "window"> = {}) {
  (win as any).showAbout = () => {
    const aboutModal = doc.getElementById("aboutModal") as any;
    if (aboutModal) aboutModal.show();
  };

  (win as any).ensureCloudConsent = async () => {
    const hasConsent = storage.getItem("kyte_cloud_consent") === "true";
    if (hasConsent) return true;

    const modal = doc.getElementById("cloudConsentModal") as any;
    if (!modal) return false;

    const confirmed = await modal.show();
    if (confirmed) {
      storage.setItem("kyte_cloud_consent", "true");
    }
    return confirmed;
  };
}

export function installErrorHandlers({
  document: doc = document,
  logger: appLogger = logger,
  window: win = window,
}: Pick<BootstrapOptions, "document" | "logger" | "window"> = {}) {
  win.onerror = (message, source, lineno, colno, error) => {
    appLogger.error("Unhandled runtime error", {
      message,
      source,
      lineno,
      colno,
      error: error?.stack,
    });
    const dialog = doc.getElementById("globalDialog") as any;
    if (dialog) {
      dialog.show({
        title: "Something went wrong",
        message: mapError(
          error || (message as string),
          "An unexpected application error occurred. We have logged the issue and are looking into it.",
        ),
        type: "error",
      });
    }
    return false;
  };

  win.onunhandledrejection = (event) => {
    appLogger.error("Unhandled Promise Rejection", { reason: event.reason });
    const dialog = doc.getElementById("globalDialog") as any;
    if (dialog) {
      dialog.show({
        title: "Operation Failed",
        message: mapError(
          event.reason,
          "An asynchronous operation failed unexpectedly. Please refresh and try again.",
        ),
        type: "error",
      });
    }
  };
}

export function installRouter({
  document: doc = document,
  logger: appLogger = logger,
  window: win = window,
}: Pick<BootstrapOptions, "document" | "logger" | "window"> = {}) {
  const mainContainer = doc.getElementById("main-container") as HTMLElement | null;

  win.addEventListener("tool-select", (event) => {
    const toolId = (event as CustomEvent<{ toolId: string }>).detail?.toolId;
    appLogger.info("Tool selected", { toolId });
    routeTool(mainContainer, toolId);
  });

  win.addEventListener("back-to-dashboard", () => {
    showDashboard(mainContainer);
  });

  showDashboard(mainContainer);
}

export function installServiceWorkerRegistration({
  logger: appLogger = logger,
  navigator: appNavigator = navigator,
  prod,
  window: win = window,
}: Pick<BootstrapOptions, "logger" | "navigator" | "prod" | "window">) {
  if (!prod || !("serviceWorker" in appNavigator)) return;

  win.addEventListener("load", () => {
    appNavigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        appLogger.info("Service worker registered");
        registration.update();

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        registration.addEventListener("updatefound", () => {
          const nextWorker = registration.installing;
          nextWorker?.addEventListener("statechange", () => {
            if (nextWorker.state === "installed" && appNavigator.serviceWorker.controller) {
              nextWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => appLogger.error("Service worker registration failed", err));
  });

  let hasRefreshedForServiceWorker = false;
  appNavigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasRefreshedForServiceWorker) return;
    hasRefreshedForServiceWorker = true;
    win.location.reload();
  });
}

export class BackgroundParticle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mouse: { x: number | null; y: number | null },
    random: () => number = Math.random,
  ) {
    this.x = random() * canvas.width;
    this.y = random() * canvas.height;
    this.size = random() * 2 + 1;
    this.speedX = random() * 1 - 0.5;
    this.speedY = random() * 1 - 0.5;
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;

    if (this.x > this.canvas.width) this.x = 0;
    if (this.x < 0) this.x = this.canvas.width;
    if (this.y > this.canvas.height) this.y = 0;
    if (this.y < 0) this.y = this.canvas.height;

    if (this.mouse.x && this.mouse.y) {
      const dx = this.mouse.x - this.x;
      const dy = this.mouse.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 100) {
        this.x -= dx / 20;
        this.y -= dy / 20;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "rgba(6, 182, 212, 0.4)";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createBackgroundAnimator({
  canvas,
  particleCount = 80,
  random = Math.random,
  requestAnimationFrame: requestFrame = requestAnimationFrame,
  window: win = window,
}: {
  canvas: HTMLCanvasElement;
  particleCount?: number;
  random?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  window?: Window;
}) {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  const mouse = { x: null as number | null, y: null as number | null };
  const particles: BackgroundParticle[] = [];

  const resize = () => {
    canvas.width = win.innerWidth;
    canvas.height = win.innerHeight;
  };

  const init = () => {
    particles.length = 0;
    for (let i = 0; i < particleCount; i++) {
      particles.push(new BackgroundParticle(canvas, mouse, random));
    }
  };

  const animate = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particles.length; i++) {
      particles[i].update();
      particles[i].draw(ctx);

      for (let j = i; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 150) {
          ctx.strokeStyle = `rgba(16, 185, 129, ${1 - distance / 150})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    requestFrame(animate);
  };

  const handleMouseMove = (event: MouseEvent) => {
    mouse.x = event.x;
    mouse.y = event.y;
  };

  win.addEventListener("mousemove", handleMouseMove);
  win.addEventListener("resize", resize);

  return {
    animate,
    init,
    mouse,
    particles,
    resize,
    start() {
      resize();
      init();
      animate();
    },
  };
}

export function installBackground({
  document: doc = document,
  requestAnimationFrame: requestFrame = requestAnimationFrame,
  window: win = window,
}: Pick<BootstrapOptions, "document" | "requestAnimationFrame" | "window"> = {}) {
  const canvas = doc.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (!canvas) return null;

  const animator = createBackgroundAnimator({
    canvas,
    requestAnimationFrame: requestFrame,
    window: win,
  });
  animator.start();
  return animator;
}

export function bootstrapKytePdf(options: BootstrapOptions) {
  logger.info("KytePDF Application Starting");
  installGlobalActions(options);
  installServiceWorkerRegistration(options);
  installErrorHandlers(options);
  installRouter(options);
  return installBackground(options);
}
