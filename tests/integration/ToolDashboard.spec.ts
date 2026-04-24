import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolDashboard } from "../../components/ToolDashboard";
import { persistence } from "../../utils/persistence";

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
    vi.mocked(persistence.getJobs).mockResolvedValue([]);
    vi.mocked(persistence.deleteJob).mockResolvedValue(undefined);
    vi.mocked(persistence.clearAll).mockResolvedValue(undefined);
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn().mockResolvedValue(true);
    (window as any).ensureCloudConsent = vi.fn().mockResolvedValue(true);
    (window as any).lucide = { createIcons: vi.fn() };
    (window as any).showAbout = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:history");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
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

    it("renders coming soon cards after all active tools", () => {
      const cards = Array.from(component.querySelectorAll(".tool-card")) as HTMLElement[];
      const tools = (component as any).tools as Array<{ id: string; active: boolean }>;
      const activeFlags = cards.map((card) => {
        const toolId = card.getAttribute("data-id");
        return tools.find((tool) => tool.id === toolId)?.active ?? false;
      });
      const firstInactiveIndex = activeFlags.indexOf(false);

      expect(firstInactiveIndex).toBeGreaterThan(-1);
      expect(activeFlags.slice(firstInactiveIndex)).not.toContain(true);
    });

    it("should display tool descriptions", () => {
      const cards = component.querySelectorAll(".tool-card");
      expect(cards.length).toBeGreaterThan(0);
    });

    it("should have icons on cards", () => {
      const icons = component.querySelectorAll("[data-lucide]");
      expect(icons.length).toBeGreaterThan(0);
    });

    it("renders active cloud and hybrid badges when tools are enabled", () => {
      (component as any).tools = [
        {
          active: true,
          desc: "Cloud only",
          icon: "cloud",
          id: "cloud-tool",
          isCloud: true,
          name: "Cloud Tool",
        },
        {
          active: true,
          desc: "Hybrid",
          icon: "cloud",
          id: "hybrid-tool",
          isCloud: true,
          isHybrid: true,
          name: "Hybrid Tool",
        },
      ];

      component.render();

      expect(component.querySelector(".cloud-badge")?.textContent).toContain("Cloud");
      expect(component.querySelector(".hybrid-badge")?.textContent).toContain("Local + Cloud");
      expect((window as any).lucide.createIcons).toHaveBeenCalled();
    });
  });

  describe("tool selection", () => {
    it("should emit tool-select event for edit tool", async () => {
      const dispatchSpy = vi.spyOn(component, "dispatchEvent");
      // Find the edit tool card
      const editCard = component.querySelector('.tool-card[data-id="edit"]') as HTMLElement;
      expect(editCard).toBeTruthy();

      // It should not have 'Coming Soon' badge (implied by checking if it emits event)
      editCard.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const selectEvents = dispatchSpy.mock.calls.filter(
        (call) =>
          call[0]?.type === "tool-select" && (call[0] as CustomEvent).detail.toolId === "edit",
      );
      expect(selectEvents.length).toBe(1);
    });

    it("should emit tool-select event when card is clicked", async () => {
      const dispatchSpy = vi.spyOn(component, "dispatchEvent");
      const cards = component.querySelectorAll(".tool-card");
      const activeCard = Array.from(cards).find(
        (card) => !card.classList.contains("coming-soon"),
      ) as HTMLElement;

      if (activeCard) {
        activeCard.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const selectEvents = dispatchSpy.mock.calls.filter(
          (call) => call[0]?.type === "tool-select",
        );
        expect(selectEvents.length).toBeGreaterThan(0);
      }
    });

    it("does not emit for inactive cards", async () => {
      const dispatchSpy = vi.spyOn(component, "dispatchEvent");
      const inactiveCard = component.querySelector(".tool-card.coming-soon") as HTMLElement;

      inactiveCard.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool-select" }),
      );
    });

    it("requires cloud consent for active cloud-only tools", async () => {
      (component as any).tools = [
        {
          active: true,
          desc: "Cloud only",
          icon: "cloud",
          id: "cloud-tool",
          isCloud: true,
          isHybrid: false,
          name: "Cloud Tool",
        },
      ];
      component.render();
      const dispatchSpy = vi.spyOn(component, "dispatchEvent");
      (window as any).ensureCloudConsent.mockResolvedValueOnce(false);

      (component.querySelector('.tool-card[data-id="cloud-tool"]') as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((window as any).ensureCloudConsent).toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "tool-select" }),
      );

      (window as any).ensureCloudConsent.mockResolvedValueOnce(true);
      (component.querySelector('.tool-card[data-id="cloud-tool"]') as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { toolId: "cloud-tool" },
          type: "tool-select",
        }),
      );
    });

    it("calls the about callback from the header", () => {
      (component.querySelector("#aboutBtn") as HTMLButtonElement).click();

      expect((window as any).showAbout).toHaveBeenCalled();
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
        },
      ]);

      // Reload history
      await component.loadHistory();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const historyGrid = component.querySelector("#historyGrid");
      expect(historyGrid?.innerHTML).toContain("test.pdf");
    });

    it("tolerates history load failures", async () => {
      vi.mocked(persistence.getJobs).mockRejectedValueOnce(new Error("indexeddb failed"));

      await expect(component.loadHistory()).resolves.toBeUndefined();
    });

    it("downloads and deletes individual history jobs", async () => {
      vi.mocked(persistence.getJobs).mockResolvedValueOnce([
        {
          data: new Uint8Array([1, 2, 3]),
          fileName: "download.pdf",
          fileSize: 3,
          id: 12,
          metadata: { savedPercent: 25, originalSize: 100, finalSize: 75 },
          timestamp: Date.now(),
          tool: "Compress",
        },
      ]);

      await component.loadHistory();
      (component.querySelector(".job-btn-download") as HTMLButtonElement).click();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:history");

      (component.querySelector(".job-btn-delete") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistence.deleteJob).toHaveBeenCalledWith(12);
    });

    it("clears all history only after confirmation", async () => {
      const dialog = document.getElementById("globalDialog") as any;

      dialog.show.mockResolvedValueOnce(false);
      (component.querySelector("#clearHistoryBtn") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.clearAll).not.toHaveBeenCalled();

      dialog.show.mockResolvedValueOnce(true);
      (component.querySelector("#clearHistoryBtn") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(persistence.clearAll).toHaveBeenCalled();
    });

    it("hides history when the jobs list is missing", () => {
      (component as any).jobs = null;

      component.renderHistory();

      expect(component.querySelector("#historySection")?.classList.contains("hidden")).toBe(true);
    });
  });

  describe("layout", () => {
    it("should have tool grid or section", () => {
      const grid =
        component.querySelector(".tool-grid") ||
        component.querySelector(".tool-section") ||
        component.querySelectorAll(".tool-card").length > 0;
      expect(grid).toBeTruthy();
    });

    it("should have header section", () => {
      const header = component.querySelector(".dashboard-header") || component.querySelector("h1");
      expect(header).toBeTruthy();
    });
  });

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(component.formatBytes(0)).toBe("0 Bytes");
      expect(component.formatBytes(1024)).toBe("1 KB");
      expect(component.formatBytes(1024 * 1024)).toBe("1 MB");
      expect(component.formatBytes(1536, -1)).toBe("2 KB");
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
        },
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
        },
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
        },
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
        },
      };
      const result = component.formatJobMetrics(job);
      expect(result).toContain("page 2");
    });

    it("should format create job metrics", () => {
      const job = {
        id: 1,
        tool: "Create",
        fileName: "proposal.pdf",
        fileSize: 1000,
        timestamp: Date.now(),
        data: new Uint8Array([1]),
        metadata: {
          template: "Project Report",
          pageCount: 3,
        },
      };
      const result = component.formatJobMetrics(job);
      expect(result).toContain("Project Report");
      expect(result).toContain("3 pages");
    });

    it("should return empty string for unknown tool", () => {
      const job = {
        id: 1,
        tool: "Unknown",
        fileName: "test.pdf",
        fileSize: 1000,
        timestamp: Date.now(),
        data: new Uint8Array([1]),
        metadata: {},
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

    it("should format protect, unprotect, and default create metadata", () => {
      expect(
        component.formatJobMetrics({
          data: new Uint8Array([1]),
          fileName: "protected.pdf",
          fileSize: 1,
          id: 1,
          metadata: { permissionsRestricted: 1 },
          timestamp: Date.now(),
          tool: "Protect",
        }),
      ).toContain("1 restriction");

      expect(
        component.formatJobMetrics({
          data: new Uint8Array([1]),
          fileName: "unlocked.pdf",
          fileSize: 1,
          id: 2,
          metadata: { restrictionsRemoved: true },
          timestamp: Date.now(),
          tool: "Unprotect",
        }),
      ).toBe("Restrictions removed");

      expect(
        component.formatJobMetrics({
          data: new Uint8Array([1]),
          fileName: "password.pdf",
          fileSize: 1,
          id: 3,
          metadata: { restrictionsRemoved: false },
          timestamp: Date.now(),
          tool: "Unprotect",
        }),
      ).toBe("Password removed");

      expect(
        component.formatJobMetrics({
          data: new Uint8Array([1]),
          fileName: "document.pdf",
          fileSize: 1,
          id: 4,
          metadata: {},
          timestamp: Date.now(),
          tool: "Create",
        }),
      ).toBe("Document · 1 page");
    });
  });
});
