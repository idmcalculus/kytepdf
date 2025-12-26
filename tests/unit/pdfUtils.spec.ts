import { describe, it, expect } from "vitest";
import {
	swapArrayItems,
	moveArrayItem,
	parsePageRange,
	formatSelectionInfo,
	calculateSignaturePlacement,
	generateOutputFilename,
	calculateSavingsPercent,
	sortJobsByTimestamp,
	filterValidFiles,
	formatFileSize,
	formatTimestamp,
	buildFileListItemHTML,
	buildJobCardHTML,
} from "../../utils/pdfUtils";

describe("pdfUtils", () => {
	describe("swapArrayItems", () => {
		it("should swap two items by index", () => {
			const arr = ["a", "b", "c", "d"];
			expect(swapArrayItems(arr, 0, 2)).toEqual(["b", "c", "a", "d"]);
		});

		it("should handle adjacent swaps", () => {
			const arr = [1, 2, 3];
			expect(swapArrayItems(arr, 0, 1)).toEqual([2, 1, 3]);
		});

		it("should not modify original array", () => {
			const arr = [1, 2, 3];
			swapArrayItems(arr, 0, 2);
			expect(arr).toEqual([1, 2, 3]);
		});
	});

	describe("moveArrayItem", () => {
		it("should move item forward", () => {
			const arr = ["a", "b", "c"];
			expect(moveArrayItem(arr, 0, 1)).toEqual(["b", "a", "c"]);
		});

		it("should move item backward", () => {
			const arr = ["a", "b", "c"];
			expect(moveArrayItem(arr, 2, -1)).toEqual(["a", "c", "b"]);
		});

		it("should return same array if move is out of bounds", () => {
			const arr = ["a", "b", "c"];
			expect(moveArrayItem(arr, 0, -1)).toEqual(["a", "b", "c"]);
			expect(moveArrayItem(arr, 2, 1)).toEqual(["a", "b", "c"]);
		});
	});

	describe("parsePageRange", () => {
		it("should parse single page numbers", () => {
			expect(parsePageRange("1,3,5", 10)).toEqual([1, 3, 5]);
		});

		it("should parse page ranges", () => {
			expect(parsePageRange("1-5", 10)).toEqual([1, 2, 3, 4, 5]);
		});

		it("should parse mixed format", () => {
			expect(parsePageRange("1-3,5,7-9", 10)).toEqual([1, 2, 3, 5, 7, 8, 9]);
		});

		it("should respect max pages limit", () => {
			expect(parsePageRange("1-100", 5)).toEqual([1, 2, 3, 4, 5]);
		});

		it("should handle invalid input gracefully", () => {
			expect(parsePageRange("abc", 10)).toEqual([]);
			expect(parsePageRange("", 10)).toEqual([]);
		});

		it("should deduplicate overlapping ranges", () => {
			expect(parsePageRange("1-3,2-4", 10)).toEqual([1, 2, 3, 4]);
		});
	});

	describe("formatSelectionInfo", () => {
		it("should format singular correctly", () => {
			expect(formatSelectionInfo(1)).toBe("1 page selected");
		});

		it("should format plural correctly", () => {
			expect(formatSelectionInfo(0)).toBe("0 pages selected");
			expect(formatSelectionInfo(5)).toBe("5 pages selected");
		});
	});

	describe("calculateSignaturePlacement", () => {
		it("should calculate relative placement", () => {
			const result = calculateSignaturePlacement(100, 100, 200, 200, 40, 20);
			expect(result.x).toBeCloseTo(0.4);
			expect(result.y).toBeCloseTo(0.45);
			expect(result.w).toBeCloseTo(0.2);
			expect(result.h).toBeCloseTo(0.1);
		});
	});

	describe("generateOutputFilename", () => {
		it("should add suffix before .pdf extension", () => {
			expect(generateOutputFilename("document.pdf", "_compressed")).toBe("document_compressed.pdf");
		});

		it("should handle uppercase extension", () => {
			expect(generateOutputFilename("document.PDF", "_split")).toBe("document_split.pdf");
		});
	});

	describe("calculateSavingsPercent", () => {
		it("should calculate percentage correctly", () => {
			expect(calculateSavingsPercent(1000, 500)).toBe(50);
			expect(calculateSavingsPercent(1000, 750)).toBe(25);
		});

		it("should never return negative", () => {
			expect(calculateSavingsPercent(500, 1000)).toBe(0);
		});
	});

	describe("sortJobsByTimestamp", () => {
		it("should sort jobs newest first", () => {
			const jobs = [
				{ id: 1, timestamp: 100 },
				{ id: 2, timestamp: 300 },
				{ id: 3, timestamp: 200 },
			];
			const sorted = sortJobsByTimestamp(jobs);
			expect(sorted[0].id).toBe(2);
			expect(sorted[1].id).toBe(3);
			expect(sorted[2].id).toBe(1);
		});

		it("should not mutate original array", () => {
			const jobs = [{ id: 1, timestamp: 100 }, { id: 2, timestamp: 200 }];
			sortJobsByTimestamp(jobs);
			expect(jobs[0].id).toBe(1);
		});

		it("should handle empty array", () => {
			expect(sortJobsByTimestamp([])).toEqual([]);
		});
	});

	describe("filterValidFiles", () => {
		it("should filter valid PDF files", () => {
			const files = [
				new File(["a"], "doc1.pdf", { type: "application/pdf" }),
				new File(["b"], "doc2.txt", { type: "text/plain" }),
				new File(["c"], "doc3.pdf", { type: "application/pdf" }),
			];
			const valid = filterValidFiles(files);
			expect(valid.length).toBe(2);
		});

		it("should accept .pdf extension even without mime type", () => {
			const files = [new File(["a"], "doc.pdf", { type: "" })];
			const valid = filterValidFiles(files);
			expect(valid.length).toBe(1);
		});

		it("should reject files over size limit", () => {
			const file = new File(["x"], "large.pdf", { type: "application/pdf" });
			Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
			const valid = filterValidFiles([file], 100);
			expect(valid.length).toBe(0);
		});

		it("should use default 100MB limit", () => {
			const file = new File(["x"], "ok.pdf", { type: "application/pdf" });
			Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 });
			const valid = filterValidFiles([file]);
			expect(valid.length).toBe(1);
		});
	});

	describe("formatFileSize", () => {
		it("should format bytes", () => {
			expect(formatFileSize(0)).toBe("0 Bytes");
			expect(formatFileSize(500)).toBe("500 Bytes");
		});

		it("should format kilobytes", () => {
			expect(formatFileSize(1024)).toBe("1 KB");
			expect(formatFileSize(1536)).toBe("1.5 KB");
		});

		it("should format megabytes", () => {
			expect(formatFileSize(1024 * 1024)).toBe("1 MB");
		});

		it("should format gigabytes", () => {
			expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
		});

		it("should respect decimal places", () => {
			expect(formatFileSize(1500, 1)).toBe("1.5 KB");
		});
	});

	describe("formatTimestamp", () => {
		it("should format recent timestamps as 'Just now'", () => {
			const now = Date.now();
			expect(formatTimestamp(now - 30 * 1000)).toBe("Just now");
		});

		it("should format minutes ago", () => {
			const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
			expect(formatTimestamp(fiveMinutesAgo)).toBe("5 mins ago");
		});

		it("should format hours ago", () => {
			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			expect(formatTimestamp(twoHoursAgo)).toBe("2 hours ago");
		});

		it("should format days ago", () => {
			const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
			expect(formatTimestamp(threeDaysAgo)).toBe("3 days ago");
		});

		it("should format old dates as locale string", () => {
			const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
			const result = formatTimestamp(twoWeeksAgo);
			expect(result).not.toContain("ago");
		});

		it("should handle singular forms", () => {
			const oneMinuteAgo = Date.now() - 60 * 1000;
			expect(formatTimestamp(oneMinuteAgo)).toBe("1 min ago");
		});
	});

	describe("buildFileListItemHTML", () => {
		it("should build file item HTML", () => {
			const html = buildFileListItemHTML({ name: "test.pdf", size: 1024 }, 0, 3);
			expect(html).toContain("test.pdf");
			expect(html).toContain("1 KB");
			expect(html).toContain('data-index="0"');
		});

		it("should disable up button for first item", () => {
			const html = buildFileListItemHTML({ name: "test.pdf", size: 1024 }, 0, 3);
			expect(html).toContain('class="move-up" data-index="0" disabled');
		});

		it("should disable down button for last item", () => {
			const html = buildFileListItemHTML({ name: "test.pdf", size: 1024 }, 2, 3);
			expect(html).toContain('class="move-down" data-index="2" disabled');
		});
	});

	describe("buildJobCardHTML", () => {
		it("should build job card HTML", () => {
			const job = {
				id: 1,
				timestamp: Date.now() - 60 * 1000,
				tool: "Compress",
				fileName: "doc.pdf",
				fileSize: 2048,
			};
			const html = buildJobCardHTML(job);
			expect(html).toContain("Compress");
			expect(html).toContain("doc.pdf");
			expect(html).toContain("2 KB");
			expect(html).toContain('data-id="1"');
		});

		it("should use defaults for missing fields", () => {
			const job = { id: 2, timestamp: Date.now() };
			const html = buildJobCardHTML(job);
			expect(html).toContain("PDF");
			expect(html).toContain("Document");
		});

		it("should omit size if not provided", () => {
			const job = { id: 3, timestamp: Date.now(), fileName: "test.pdf" };
			const html = buildJobCardHTML(job);
			expect(html).not.toContain("job-size");
		});
	});
});
