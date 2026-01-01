import { vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";

// Polyfill File/Blob.arrayBuffer for jsdom
if (typeof File !== "undefined" && !File.prototype.arrayBuffer) {
	File.prototype.arrayBuffer = function () {
		return Promise.resolve(new ArrayBuffer(0));
	};
}
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
	Blob.prototype.arrayBuffer = function () {
		return Promise.resolve(new ArrayBuffer(0));
	};
}

// Polyfill for DOMMatrix (needed by pdfjs-dist in jsdom)
if (typeof window !== "undefined" && !window.DOMMatrix) {
	(window as any).DOMMatrix = class DOMMatrix {
		constructor() { }
		multiply() { return this; }
		inverse() { return this; }
		translate() { return this; }
		scale() { return this; }
		rotate() { return this; }
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
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, options?: any) {
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
	HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue("data:image/png;base64,abc") as any;
	HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(new Blob([""], { type: "image/jpeg" }))) as any;
}
