import { describe, it, expect, vi, beforeEach } from "vitest";
import { PdfSign } from "../../components/PdfSign";

vi.mock("../../utils/persistence", () => ({
	persistence: {
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn(),
		addJob: vi.fn().mockResolvedValue(1),
		getJobs: vi.fn().mockResolvedValue([]),
		estimateUsage: vi.fn().mockResolvedValue(0),
		getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
	},
}));

vi.mock("../../utils/pdfConfig", () => ({
	pdfjsLib: {
		getDocument: vi.fn().mockReturnValue({
			promise: Promise.resolve({
				numPages: 3,
				getPage: vi.fn().mockResolvedValue({
					getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
					render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
				}),
			}),
		}),
	},
	PDFDocument: {
		load: vi.fn().mockResolvedValue({
			embedPng: vi.fn().mockResolvedValue({}),
			getPages: vi.fn().mockReturnValue([{
				getSize: vi.fn().mockReturnValue({ width: 612, height: 792 }),
				drawImage: vi.fn(),
			}]),
			save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
		}),
	},
}));

describe("PdfSign", () => {
	let component: PdfSign;

	beforeEach(async () => {
		vi.clearAllMocks();
		document.body.innerHTML = '<div id="globalDialog"></div>';
		(document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
		component = new PdfSign();
		document.body.appendChild(component);
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	describe("render", () => {
		it("should render the sign component", async () => {
			expect(component.querySelector("h1")?.textContent).toBe("Sign PDF");
		});

		it("should render subtitle", () => {
			expect(component.querySelector(".subtitle")?.textContent).toContain("signature");
		});

		it("should have signature controls hidden initially", () => {
			expect(component.querySelector("#signLayout")?.classList.contains("hidden")).toBe(true);
		});

		it("should have drop zone visible", () => {
			expect(component.querySelector("#dropZone")).toBeTruthy();
		});
	});

	describe("finalize button", () => {
		it("should have finalize button disabled initially", () => {
			const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
			expect(finalizeBtn.disabled).toBe(true);
		});
	});

	describe("tab switching", () => {
		it("should switch to type tab", async () => {
			const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
			typeTab.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(component.querySelector("#typeSection")?.classList.contains("hidden")).toBe(false);
			expect(component.querySelector("#drawSection")?.classList.contains("hidden")).toBe(true);
		});

		it("should switch back to draw tab", async () => {
			const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
			const drawTab = component.querySelector('.tab-btn[data-tab="draw"]') as HTMLElement;

			typeTab.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			drawTab.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(component.querySelector("#drawSection")?.classList.contains("hidden")).toBe(false);
			expect(component.querySelector("#typeSection")?.classList.contains("hidden")).toBe(true);
		});

		it("should mark active tab correctly", async () => {
			const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
			typeTab.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(typeTab.classList.contains("active")).toBe(true);
		});
	});

	describe("signature actions", () => {
		it("should clear signature canvas and reset state", async () => {
			const clearBtn = component.querySelector("#clearSigBtn") as HTMLButtonElement;
			clearBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(component.querySelector("#signaturePreview")?.classList.contains("hidden")).toBe(true);
			expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
		});

		it("should save drawn signature", async () => {
			const saveSigBtn = component.querySelector("#saveSigBtn") as HTMLButtonElement;
			saveSigBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(false);
		});
	});

	describe("status indicators", () => {
		it("should have signature status hidden initially", () => {
			expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(true);
		});

		it("should have step badge visible", () => {
			expect(component.querySelector(".step-badge")?.textContent).toContain("Phase 1");
		});
	});

	describe("page navigation", () => {
		it("should have page navigation buttons", () => {
			expect(component.querySelector("#prevPage")).toBeTruthy();
			expect(component.querySelector("#nextPage")).toBeTruthy();
		});

		it("should show page indicator", () => {
			expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page");
		});
	});

	describe("type signature", () => {
		it("should have name input field", () => {
			const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
			expect(nameInput).toBeTruthy();
			expect(nameInput.placeholder).toContain("name");
		});

		it("should have font selector buttons", () => {
			const fontBtns = component.querySelectorAll(".font-btn");
			expect(fontBtns.length).toBe(4);
		});

		it("should switch active font on click", async () => {
			const fontBtns = component.querySelectorAll(".font-btn");
			const secondBtn = fontBtns[1] as HTMLElement;

			secondBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(secondBtn.classList.contains("active")).toBe(true);
		});

		it("should unmark previous active font", async () => {
			const fontBtns = component.querySelectorAll(".font-btn");
			const firstBtn = fontBtns[0] as HTMLElement;
			const secondBtn = fontBtns[1] as HTMLElement;

			secondBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(firstBtn.classList.contains("active")).toBe(false);
		});
	});

	describe("draw signature", () => {
		it("should have signature canvas", () => {
			const sigCanvas = component.querySelector("#sigCanvas") as HTMLCanvasElement;
			expect(sigCanvas).toBeTruthy();
		});

		it("should have save signature button", () => {
			expect(component.querySelector("#saveSigBtn")).toBeTruthy();
		});

		it("should have clear button", () => {
			expect(component.querySelector("#clearSigBtn")).toBeTruthy();
		});
	});

	describe("PDF preview", () => {
		it("should have pdf canvas", () => {
			expect(component.querySelector("#pdfCanvas")).toBeTruthy();
		});

		it("should have signature preview element", () => {
			expect(component.querySelector("#signaturePreview")).toBeTruthy();
		});
	});

	describe("controls card", () => {
		it("should have controls card", () => {
			expect(component.querySelector(".controls-card")).toBeTruthy();
		});

		it("should have signature tabs", () => {
			expect(component.querySelector(".signature-tabs")).toBeTruthy();
		});
	});

	describe("file handling", () => {
		it("should load PDF file and show sign layout", async () => {
			const file = new File(["test"], "test.pdf", { type: "application/pdf" });
			await component.handleFiles([file] as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 100));

			expect(component.querySelector("#dropZone")?.classList.contains("hidden")).toBe(true);
			expect(component.querySelector("#signLayout")?.classList.contains("hidden")).toBe(false);
		});

		it("should update page indicator when file loads", async () => {
			const file = new File(["test"], "test.pdf", { type: "application/pdf" });
			await component.handleFiles([file] as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 100));

			expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 1 of 3");
		});
	});

	describe("page navigation after file load", () => {
		it("should navigate to next page", async () => {
			const file = new File(["test"], "test.pdf", { type: "application/pdf" });
			await component.handleFiles([file] as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 100));

			const nextBtn = component.querySelector("#nextPage") as HTMLButtonElement;
			nextBtn.click();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 2 of 3");
		});

		it("should navigate to previous page", async () => {
			const file = new File(["test"], "test.pdf", { type: "application/pdf" });
			await component.handleFiles([file] as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 100));

			// Go to page 2 first
			const nextBtn = component.querySelector("#nextPage") as HTMLButtonElement;
			nextBtn.click();
			await new Promise(resolve => setTimeout(resolve, 50));

			// Then go back
			const prevBtn = component.querySelector("#prevPage") as HTMLButtonElement;
			prevBtn.click();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(component.querySelector("#pageIndicator")?.textContent).toContain("Page 1 of 3");
		});
	});

	describe("typed signature", () => {
		it("should update name input value", async () => {
			const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
			nameInput.value = "John Doe";
			nameInput.dispatchEvent(new Event("input"));
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(nameInput.value).toBe("John Doe");
		});

		it("should save typed signature when button clicked", async () => {
			// Switch to type tab first
			const typeTab = component.querySelector('.tab-btn[data-tab="type"]') as HTMLElement;
			typeTab.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			const nameInput = component.querySelector("#nameInput") as HTMLInputElement;
			nameInput.value = "Test Name";
			nameInput.dispatchEvent(new Event("input"));

			const saveBtn = component.querySelector("#saveTypedSigBtn") as HTMLButtonElement;
			saveBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(component.querySelector("#signStatus")?.classList.contains("hidden")).toBe(false);
		});
	});

	describe("startFinalize", () => {
		it("should call PDFDocument.load when finalizing", async () => {
			const { PDFDocument } = await import("../../utils/pdfConfig");
			const file = new File(["test"], "test.pdf", { type: "application/pdf" });
			await component.handleFiles([file] as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 100));

			// Create signature
			const saveSigBtn = component.querySelector("#saveSigBtn") as HTMLButtonElement;
			saveSigBtn.click();
			await new Promise(resolve => setTimeout(resolve, 0));

			// Place signature by calling placeSignature directly
			const canvas = component.querySelector("#pdfCanvas") as HTMLCanvasElement;
			const event = new MouseEvent("click", {
				clientX: 100,
				clientY: 100,
				bubbles: true,
			});
			canvas.dispatchEvent(event);
			await new Promise(resolve => setTimeout(resolve, 0));

			// Enable finalize button manually since we mocked placement
			const finalizeBtn = component.querySelector("#finalizeBtn") as HTMLButtonElement;
			finalizeBtn.disabled = false;

			await component.startFinalize();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(PDFDocument.load).toHaveBeenCalled();
		});
	});
});
