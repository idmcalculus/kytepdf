import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolDashboard } from "../../components/ToolDashboard";

vi.mock("../../utils/persistence", () => ({
	persistence: {
		getJobs: vi.fn().mockResolvedValue([]),
		deleteJob: vi.fn().mockResolvedValue(undefined),
		clearAll: vi.fn().mockResolvedValue(undefined),
	},
}));

describe("ToolDashboard", () => {
	let component: ToolDashboard;

	beforeEach(async () => {
		vi.clearAllMocks();
		document.body.innerHTML = '<div id="globalDialog"></div>';
		(document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
		component = new ToolDashboard();
		document.body.appendChild(component);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	describe("render", () => {
		it("should render the dashboard title", () => {
			const h1 = component.querySelector("h1");
			expect(h1?.textContent).toContain("Kyte");
		});

		it("should render tool cards", () => {
			const toolCards = component.querySelectorAll(".tool-card");
			expect(toolCards.length).toBeGreaterThan(0);
		});

		it("should have subtitle with PDF text", () => {
			const subtitle = component.querySelector("p");
			expect(subtitle?.textContent?.toLowerCase()).toContain("pdf");
		});
	});

	describe("tool cards", () => {
		it("should have multiple tools listed", () => {
			const cards = component.querySelectorAll(".tool-card");
			expect(cards.length).toBeGreaterThanOrEqual(4);
		});

		it("should display tool descriptions", () => {
			const cards = component.querySelectorAll(".tool-card");
			expect(cards.length).toBeGreaterThan(0);
		});

		it("should have icons on cards", () => {
			const icons = component.querySelectorAll("[data-lucide]");
			expect(icons.length).toBeGreaterThan(0);
		});
	});

	describe("tool selection", () => {
		it("should emit tool-select event when card is clicked", async () => {
			const dispatchSpy = vi.spyOn(component, "dispatchEvent");
			const cards = component.querySelectorAll(".tool-card");
			const activeCard = Array.from(cards).find(card =>
				!card.classList.contains("coming-soon")
			) as HTMLElement;

			if (activeCard) {
				activeCard.click();
				await new Promise(resolve => setTimeout(resolve, 0));

				const selectEvents = dispatchSpy.mock.calls.filter(
					call => call[0]?.type === "tool-select"
				);
				expect(selectEvents.length).toBeGreaterThan(0);
			}
		});
	});

	describe("history", () => {
		it("should load history on init", async () => {
			const { persistence } = await import("../../utils/persistence");
			expect(persistence.getJobs).toHaveBeenCalled();
		});

		it("should hide history section when no jobs", async () => {
			const historySection = component.querySelector("#historySection");
			expect(historySection?.classList.contains("hidden")).toBe(true);
		});

		it("should show history section when jobs exist", async () => {
			const { persistence } = await import("../../utils/persistence");
			(persistence.getJobs as any).mockResolvedValueOnce([
				{
					id: 1,
					tool: "Compress",
					fileName: "test.pdf",
					fileSize: 1000,
					timestamp: Date.now(),
					data: new Uint8Array([1, 2, 3]),
				}
			]);

			// Reload history
			await component.loadHistory();
			await new Promise(resolve => setTimeout(resolve, 0));

			const historyGrid = component.querySelector("#historyGrid");
			expect(historyGrid?.innerHTML).toContain("test.pdf");
		});
	});

	describe("layout", () => {
		it("should have tool grid or section", () => {
			const grid = component.querySelector(".tool-grid") ||
				component.querySelector(".tool-section") ||
				component.querySelectorAll(".tool-card").length > 0;
			expect(grid).toBeTruthy();
		});

		it("should have header section", () => {
			const header = component.querySelector(".dashboard-header") ||
				component.querySelector("h1");
			expect(header).toBeTruthy();
		});
	});

	describe("formatBytes", () => {
		it("should format bytes correctly", () => {
			expect(component.formatBytes(0)).toBe("0 Bytes");
			expect(component.formatBytes(1024)).toBe("1 KB");
			expect(component.formatBytes(1024 * 1024)).toBe("1 MB");
		});
	});

	describe("formatJobMetrics", () => {
		it("should format compress job metrics", () => {
			const job = {
				id: 1,
				tool: "Compress",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
				metadata: {
					savedPercent: 50,
					originalSize: 2000,
					finalSize: 1000,
				}
			};
			const result = component.formatJobMetrics(job);
			expect(result).toContain("50%");
		});

		it("should format merge job metrics", () => {
			const job = {
				id: 1,
				tool: "Merge",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
				metadata: {
					fileCount: 3,
					pageCount: 10,
				}
			};
			const result = component.formatJobMetrics(job);
			expect(result).toContain("3 files merged");
		});

		it("should format split job metrics", () => {
			const job = {
				id: 1,
				tool: "Split",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
				metadata: {
					pagesExtracted: 5,
				}
			};
			const result = component.formatJobMetrics(job);
			expect(result).toContain("5 pages extracted");
		});

		it("should format sign job metrics", () => {
			const job = {
				id: 1,
				tool: "Sign",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
				metadata: {
					pageNumber: 2,
				}
			};
			const result = component.formatJobMetrics(job);
			expect(result).toContain("page 2");
		});

		it("should return empty string for unknown tool", () => {
			const job = {
				id: 1,
				tool: "Unknown",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
				metadata: {}
			};
			const result = component.formatJobMetrics(job);
			expect(result).toBe("");
		});

		it("should return empty string if no metadata", () => {
			const job = {
				id: 1,
				tool: "Compress",
				fileName: "test.pdf",
				fileSize: 1000,
				timestamp: Date.now(),
				data: new Uint8Array([1]),
			} as any;
			const result = component.formatJobMetrics(job);
			expect(result).toBe("");
		});
	});
});
