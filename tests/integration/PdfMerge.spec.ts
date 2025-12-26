import { describe, it, expect, vi, beforeEach } from "vitest";
import { PdfMerge } from "../../components/PdfMerge";

vi.mock("../../utils/persistence", () => ({
	persistence: {
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn(),
		delete: vi.fn(),
		addJob: vi.fn().mockResolvedValue(1),
		getJobs: vi.fn().mockResolvedValue([]),
		estimateUsage: vi.fn().mockResolvedValue(0),
		getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
	},
}));

vi.mock("../../utils/pdfConfig", () => ({
	PDFDocument: {
		create: vi.fn().mockResolvedValue({
			copyPages: vi.fn().mockResolvedValue([{}]),
			addPage: vi.fn(),
			save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			getPageCount: vi.fn().mockReturnValue(2),
		}),
		load: vi.fn().mockResolvedValue({
			getPageIndices: vi.fn().mockReturnValue([0]),
		}),
	},
	pdfjsLib: {
		getDocument: vi.fn().mockReturnValue({
			promise: Promise.resolve({ numPages: 1 }),
		}),
	}
}));

describe("PdfMerge", () => {
	let component: PdfMerge;

	beforeEach(async () => {
		vi.clearAllMocks();
		document.body.innerHTML = '<div id="globalDialog"></div>';
		(document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
		component = new PdfMerge();
		document.body.appendChild(component);
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	it("should render the merge component", async () => {
		expect(component.querySelector("h1")?.textContent).toBe("Merge PDF");
	});

	it("should handle file selection", async () => {
		const files = [
			new File(["f1"], "f1.pdf", { type: "application/pdf" }),
			new File(["f2"], "f2.pdf", { type: "application/pdf" }),
		];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(component.querySelectorAll(".file-list-item").length).toBe(2);
	});

	it("should disable merge button with less than 2 files", async () => {
		const files = [new File(["f1"], "f1.pdf", { type: "application/pdf" })];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		const mergeBtn = component.querySelector("#mergeBtn") as HTMLButtonElement;
		expect(mergeBtn.disabled).toBe(true);
	});

	it("should enable merge button with 2+ files", async () => {
		const files = [
			new File(["f1"], "f1.pdf", { type: "application/pdf" }),
			new File(["f2"], "f2.pdf", { type: "application/pdf" }),
		];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		const mergeBtn = component.querySelector("#mergeBtn") as HTMLButtonElement;
		expect(mergeBtn.disabled).toBe(false);
	});

	it("should move files up/down in list", async () => {
		const files = [
			new File(["f1"], "first.pdf", { type: "application/pdf" }),
			new File(["f2"], "second.pdf", { type: "application/pdf" }),
		];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		// Move first file down
		component.moveFile(0, 1);
		await new Promise(resolve => setTimeout(resolve, 0));

		const fileNames = Array.from(component.querySelectorAll(".file-name")).map(el => el.textContent);
		expect(fileNames[0]).toBe("second.pdf");
		expect(fileNames[1]).toBe("first.pdf");
	});

	it("should remove files from list", async () => {
		const files = [
			new File(["f1"], "f1.pdf", { type: "application/pdf" }),
			new File(["f2"], "f2.pdf", { type: "application/pdf" }),
		];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		component.removeFile(0);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(component.querySelectorAll(".file-list-item").length).toBe(1);
	});

	it("should swap files", async () => {
		const files = [
			new File(["f1"], "a.pdf", { type: "application/pdf" }),
			new File(["f2"], "b.pdf", { type: "application/pdf" }),
			new File(["f3"], "c.pdf", { type: "application/pdf" }),
		];
		await component.handleFiles(files as unknown as FileList);
		await new Promise(resolve => setTimeout(resolve, 0));

		component.swapFiles(0, 2);
		await new Promise(resolve => setTimeout(resolve, 0));

		const fileNames = Array.from(component.querySelectorAll(".file-name")).map(el => el.textContent);
		expect(fileNames[0]).toBe("b.pdf");
		expect(fileNames[1]).toBe("c.pdf");
		expect(fileNames[2]).toBe("a.pdf");
	});

	describe("session management", () => {
		it("should check for existing session on load", async () => {
			const { persistence } = await import("../../utils/persistence");
			expect(persistence.get).toHaveBeenCalled();
		});

		it("should save session when files are added", async () => {
			const { persistence } = await import("../../utils/persistence");
			const files = [
				new File(["f1"], "f1.pdf", { type: "application/pdf" }),
			];
			await component.handleFiles(files as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(persistence.set).toHaveBeenCalled();
		});

		it("should call persistence.delete when all files removed", async () => {
			const { persistence } = await import("../../utils/persistence");
			const files = [new File(["f1"], "f1.pdf", { type: "application/pdf" })];
			await component.handleFiles(files as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 0));

			component.removeFile(0);
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(persistence.delete).toHaveBeenCalledWith("pdf-merge");
		});

		it("should restore session when files are present", async () => {
			const { persistence } = await import("../../utils/persistence");
			const mockFiles = [
				new File(["test"], "restored.pdf", { type: "application/pdf" }),
			];
			(persistence.get as any).mockResolvedValueOnce(mockFiles);

			await component.restoreSession();
			await new Promise(resolve => setTimeout(resolve, 0));

			// Should have restored the file
			expect(component.querySelectorAll(".file-list-item").length).toBe(1);
		});
	});

	describe("startMerge", () => {
		it("should call PDFDocument methods when merging", async () => {
			const { PDFDocument } = await import("../../utils/pdfConfig");
			const files = [
				new File(["f1"], "f1.pdf", { type: "application/pdf" }),
				new File(["f2"], "f2.pdf", { type: "application/pdf" }),
			];
			await component.handleFiles(files as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 0));

			await component.startMerge();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(PDFDocument.create).toHaveBeenCalled();
			expect(PDFDocument.load).toHaveBeenCalled();
		});

		it("should record job after successful merge", async () => {
			const { persistence } = await import("../../utils/persistence");
			const files = [
				new File(["f1"], "f1.pdf", { type: "application/pdf" }),
				new File(["f2"], "f2.pdf", { type: "application/pdf" }),
			];
			await component.handleFiles(files as unknown as FileList);
			await new Promise(resolve => setTimeout(resolve, 0));

			await component.startMerge();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(persistence.addJob).toHaveBeenCalled();
		});
	});
});
