import { logger } from "../utils/logger.ts";
import { type Job, persistence } from "../utils/persistence.ts";

interface Tool {
  id: string;
  name: string;
  desc: string;
  icon: string;
  active: boolean;
  isCloud?: boolean;
}

export class ToolDashboard extends HTMLElement {
  private tools: Tool[];
  private jobs: Job[] = [];

  constructor() {
    super();
    this.tools = [
      {
        id: "compress",
        name: "Compress PDF",
        desc: "Shrink PDF file size while maintaining quality.",
        icon: "cloud-download",
        active: true,
      },
      {
        id: "merge",
        name: "Merge PDF",
        desc: "Combine multiple PDF files into one document.",
        icon: "plus-square",
        active: true,
      },
      {
        id: "split",
        name: "Split PDF",
        desc: "Separate one page or whole set into files.",
        icon: "scissors",
        active: true,
      },
      {
        id: "sign",
        name: "Sign PDF",
        desc: "Sign yourself or request signatures from others.",
        icon: "pen-tool",
        active: true,
      },
      {
        id: "edit",
        name: "Edit PDF",
        desc: "Add text, images, and shapes to your PDF.",
        icon: "edit-3",
        active: true,
      },
      {
        id: "pdf-to-img",
        name: "PDF to Image",
        desc: "Convert PDF pages into high-quality images.",
        icon: "image",
        active: true,
      },
      {
        id: "img-to-pdf",
        name: "Image to PDF",
        desc: "Convert JPG, PNG, and more into PDF files.",
        icon: "file-image",
        active: true,
      },
      {
        id: "pdf-to-word",
        name: "PDF to Word",
        desc: "Convert PDF documents into editable Word files.",
        icon: "file-text",
        active: true,
        isCloud: true,
      },
      {
        id: "word-to-pdf",
        name: "Word to PDF",
        desc: "Transform DOCX files into professional PDFs.",
        icon: "file-up",
        active: true,
        isCloud: true,
      },
      {
        id: "pdf-to-excel",
        name: "PDF to Sheets",
        desc: "Extract PDF tables into Excel or Google Sheets.",
        icon: "file-spreadsheet",
        active: true,
        isCloud: true,
      },
      {
        id: "pdf-to-pp",
        name: "PDF to PPT",
        desc: "Convert PDF pages into PowerPoint slides.",
        icon: "presentation",
        active: true,
        isCloud: true,
      },
      {
        id: "pdf-ai",
        name: "AI Analyzer",
        desc: "Chat with your PDF and extract insights using AI.",
        icon: "sparkles",
        active: false,
        isCloud: true,
      },
      {
        id: "create-pdf",
        name: "Create PDF",
        desc: "Create a new PDF from scratch or templates.",
        icon: "file-plus",
        active: false,
      },
      {
        id: "watermark",
        name: "Watermark",
        desc: "Add text or image watermarks to your document.",
        icon: "stamp",
        active: false,
      },
      {
        id: "protect",
        name: "Protect PDF",
        desc: "Encrypt your PDF with a password.",
        icon: "lock",
        active: false,
      },
    ];
  }

  async connectedCallback() {
    this.render();
    await this.loadHistory();
  }

  async loadHistory() {
    try {
      this.jobs = await persistence.getJobs();
      this.renderHistory();
    } catch (err) {
      logger.error("Failed to load job history", err);
    }
  }

  render() {
    this.innerHTML = `
      <div class="dashboard-container">
        <div class="view-header">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <img src="/logo-icon.svg" alt="Kyte logo" style="width: 50px; height: 50px;">
            <h1 style="text-align: left; font-size: 3rem; margin: 0; background: linear-gradient(135deg, #fff 0%, var(--primary) 50%, var(--secondary) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">Kyte</h1>
          </div>
          <div class="user-account-header">
            <button id="aboutBtn" class="header-link">About</button>
            <button id="userAccountBtn" class="account-pill">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>Account</span>
            </button>
          </div>
        </div>
        <p style="color: var(--text-muted); margin-bottom: 2rem; font-size: 1.1rem; padding-left: 0.25rem;">The ultimate lightweight & private PDF toolkit.</p>
        
        <div class="dashboard-grid">
          ${this.tools
            .map(
              (tool) => `
            <div class="tool-card" data-id="${tool.id}">
              ${
                !tool.active
                  ? '<span class="badge">Coming Soon</span>'
                  : tool.isCloud
                    ? `
                <span class="badge cloud-badge">
                  <i data-lucide="cloud" style="width: 12px; height: 12px;"></i>
                  Cloud
                </span>
              `
                    : ""
              }
              <div class="icon-wrapper">
                <i data-lucide="${tool.icon}"></i>
              </div>
              <h3>${tool.name}</h3>
              <p>${tool.desc}</p>
            </div>
          `,
            )
            .join("")}
        </div>

        <div id="historySection" class="history-section hidden">
          <div class="file-list-header">
            <h3>Recent Activity</h3>
            <button id="clearHistoryBtn" class="btn btn-secondary btn-sm">Clear All</button>
          </div>
          <div id="historyGrid" class="history-grid"></div>
        </div>
      </div>
    `;

    // Account btn logic
    const aboutBtn = this.querySelector("#aboutBtn") as HTMLElement;
    if (aboutBtn) {
      aboutBtn.onclick = () => {
        if ((window as any).showAbout) (window as any).showAbout();
      };
    }

    const accountBtn = this.querySelector("#userAccountBtn") as HTMLElement;
    accountBtn.onclick = () => {
      const dialog = document.getElementById("globalDialog") as any;
      dialog.show({
        title: "User Account",
        message:
          "Optional cloud sync and cross-device history are coming soon! Your documents always stay local by default, but you'll be able to opt-in for sync later.",
        type: "info",
        confirmText: "Get Notified",
      });
    };

    // Initialize Lucide icons
    if ((window as any).lucide) {
      (window as any).lucide.createIcons();
    }

    // Add click listeners
    this.querySelectorAll(".tool-card").forEach((card) => {
      card.addEventListener("click", async () => {
        const toolId = card.getAttribute("data-id");
        const tool = this.tools.find((t) => t.id === toolId);
        if (tool?.active) {
          // Check for cloud consent if necessary
          if (tool.isCloud) {
            const consented = await (window as any).ensureCloudConsent();
            if (!consented) return;
          }

          this.dispatchEvent(
            new CustomEvent("tool-select", {
              detail: { toolId },
              bubbles: true,
            }),
          );
        }
      });
    });

    const clearBtn = this.querySelector("#clearHistoryBtn") as HTMLElement;
    if (clearBtn) {
      clearBtn.onclick = async () => {
        const dialog = document.getElementById("globalDialog") as any;
        const confirmed = await dialog.show({
          title: "Clear History",
          message: "Are you sure you want to clear your local job history? This cannot be undone.",
          type: "warning",
          showCancel: true,
        });
        if (confirmed) {
          await persistence.clearAll();
          this.loadHistory();
        }
      };
    }
  }

  renderHistory() {
    const historySection = this.querySelector("#historySection") as HTMLElement;
    const historyGrid = this.querySelector("#historyGrid") as HTMLElement;

    if (!this.jobs || this.jobs.length === 0) {
      historySection.classList.add("hidden");
      return;
    }

    historySection.classList.remove("hidden");
    historyGrid.innerHTML = this.jobs
      .map(
        (job) => `
      <div class="job-card" data-id="${job.id}">
        <div class="job-header">
          <span class="job-tool-badge">${job.tool}</span>
          <span class="job-time">${new Date(job.timestamp).toLocaleDateString()}</span>
        </div>
        <div class="job-filename" title="${job.fileName}">${job.fileName}</div>
        <div class="job-metrics">${this.formatJobMetrics(job)}</div>
        <div class="job-actions">
          <button class="job-btn job-btn-download" data-id="${job.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Download
          </button>
          <button class="job-btn job-btn-delete" data-id="${job.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `,
      )
      .join("");

    // Bind actions
    historyGrid.querySelectorAll<HTMLElement>(".job-btn-download").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const job = this.jobs.find((j) => String(j.id) === String(btn.dataset.id));
        if (job) this.downloadJob(job);
      };
    });

    historyGrid.querySelectorAll<HTMLElement>(".job-btn-delete").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        await persistence.deleteJob(parseInt(btn.dataset.id as string, 10));
        this.loadHistory();
      };
    });
  }

  downloadJob(job: Job) {
    const blob = new Blob([job.data], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = job.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  formatJobMetrics(job: Job): string {
    if (!job.metadata) return "";
    const m = job.metadata;

    switch (job.tool) {
      case "Compress":
        return `Reduced by ${m.savedPercent}% (${this.formatBytes(m.originalSize)} → ${this.formatBytes(m.finalSize)})`;
      case "Merge":
        return `${m.fileCount} files merged (${m.pageCount} pages total)`;
      case "Split":
        return `${m.pagesExtracted} pages extracted`;
      case "Sign":
        return `Signed on page ${m.pageNumber}`;
      default:
        return "";
    }
  }

  formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
  }
}

customElements.define("tool-dashboard", ToolDashboard);
