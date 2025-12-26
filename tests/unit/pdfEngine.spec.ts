import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependency modules before importing they are used
vi.mock("../../utils/logger", () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// Mock pdfConfig
vi.mock("../../utils/pdfConfig", () => {
	return {
		pdfjsLib: {
			getDocument: vi.fn().mockReturnValue({
				promise: Promise.resolve({
					numPages: 1,
					getPage: vi.fn().mockResolvedValue({
						getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
						render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
					}),
				}),
			}),
		},
		PDFDocument: {
			create: vi.fn().mockResolvedValue({
				embedJpg: vi.fn().mockResolvedValue({}),
				addPage: vi.fn().mockReturnValue({
					drawImage: vi.fn(),
				}),
				save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			}),
		},
	};
});

import { compressPdf } from "../../utils/pdfEngine";

describe("pdfEngine", () => {
	const originalCreateElement = document.createElement.bind(document);

	beforeEach(() => {
		vi.clearAllMocks();

		// Polyfill File/Blob.arrayBuffer for jsdom
		if (!File.prototype.arrayBuffer) {
			File.prototype.arrayBuffer = function () {
				return Promise.resolve(new ArrayBuffer(0));
			};
		}
		if (!Blob.prototype.arrayBuffer) {
			Blob.prototype.arrayBuffer = function () {
				return Promise.resolve(new ArrayBuffer(0));
			};
		}

		// Mock canvas methods - store original to avoid recursion
		vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
			if (tagName === "canvas") {
				return {
					width: 0,
					height: 0,
					getContext: vi.fn().mockReturnValue({}),
					toBlob: vi.fn((cb) => cb(new Blob([""], { type: "image/jpeg" }))),
				} as any;
			}
			return originalCreateElement(tagName);
		});
	});

	it("should compress a PDF successfully", async () => {
		const mockFile = new File([""], "test.pdf", { type: "application/pdf" });
		const onProgress = vi.fn();

		const result = await compressPdf(mockFile, 100, onProgress);

		expect(result).toBeInstanceOf(Uint8Array);
		expect(onProgress).toHaveBeenCalledWith(100, "Finalizing...");
	});

	it("should handle compression failure", async () => {
		const { PDFDocument } = await import("../../utils/pdfConfig");
		(PDFDocument.create as any).mockRejectedValueOnce(new Error("Failed to create PDF"));

		const mockFile = new File([""], "test.pdf", { type: "application/pdf" });
		const onProgress = vi.fn();

		await expect(compressPdf(mockFile, 100, onProgress)).rejects.toThrow("Failed to create PDF");
	});
});
