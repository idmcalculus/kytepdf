import { beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// Polyfill/Mock localStorage and sessionStorage for environments (like Bun or Node v24+)
// where native Web Storage might conflict with jsdom/happy-dom or be incomplete.
const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => {
      return key in store ? store[key] : null;
    },
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    key: (index: number): string | null => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
    get length(): number {
      return Object.keys(store).length;
    },
  };
};

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: sessionStorageMock,
    writable: true,
    configurable: true,
  });
}

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

// Polyfill for DOMMatrix (needed by pdfjs-dist in jsdom)
if (typeof window !== "undefined" && !window.DOMMatrix) {
  (window as any).DOMMatrix = class DOMMatrix {
    multiply() {
      return this;
    }
    inverse() {
      return this;
    }
    translate() {
      return this;
    }
    scale() {
      return this;
    }
    rotate() {
      return this;
    }
  };
}

// Global mocks
(window as any).lucide = {
  createIcons: vi.fn(),
};

// Mock global dialog - only when document.body exists
beforeEach(() => {
  if (typeof document !== "undefined" && document.body) {
    document.body.innerHTML = '<div id="globalDialog"></div>';
    const dialog = document.getElementById("globalDialog") as any;
    if (dialog) {
      dialog.show = vi.fn().mockResolvedValue(true);
    }
  }
});

// Mock canvas - only if HTMLCanvasElement exists
if (typeof HTMLCanvasElement !== "undefined") {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: any,
  ) {
    if (contextId === "2d") {
      return {
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn().mockReturnValue({ width: 0 }),
      } as any;
    }
    return originalGetContext?.call(this, contextId, options);
  } as any;
  HTMLCanvasElement.prototype.toDataURL = vi
    .fn()
    .mockReturnValue("data:image/png;base64,abc") as any;
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb) =>
    cb(new Blob([""], { type: "image/jpeg" })),
  ) as any;
}
