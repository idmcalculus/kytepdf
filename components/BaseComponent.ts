import { mapError } from "../utils/errorMapper.ts";
import { logger } from "../utils/logger.ts";
import { persistence } from "../utils/persistence.ts";

export interface DialogOptions {
	title: string;
	message: string;
	type?: "info" | "success" | "warning" | "error";
	confirmText?: string;
	cancelText?: string;
	showCancel?: boolean;
}

export class BaseComponent extends HTMLElement {
	protected selectedFile: File | null = null;
	protected currentPdfDoc: any = null;
	protected currentPageNum: number = 1;
	protected files: File[] = [];

	connectedCallback() {
		if ((this as any).render) (this as any).render();
		if ((this as any).setupEventListeners) (this as any).setupEventListeners();
	}

	// Standardize Back Button HTML
	getBackButton() {
		return `
      <div class="view-header">
        <button class="back-btn" id="backToDash">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back to Dashboard
        </button>
        <div class="user-account-header">
          <button id="aboutBtn" class="header-link">About</button>
          <button id="userAccountBtn" class="account-pill">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Account</span>
          </button>
        </div>
      </div>
    `;
	}

	// Standardize Drop Zone HTML
	getDropZone(title = "your PDF", icon = "file-up", multiple = false) {
		const icons: Record<string, string> = {
			"file-up":
				'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="M15 15l-3-3-3 3"/>',
			"plus-square":
				'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="12" x2="12" y1="8" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/>',
			scissors:
				'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/>',
			"pen-tool":
				'<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 5 2.5"/><path d="m16 14.5 5 2.5"/>',
		};

		return `
      <div id="dropZone" class="drop-zone">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide" style="margin: 0 auto 1rem; color: var(--primary);">
          ${icons[icon] || icons["file-up"]}
        </svg>
        <p>Drag & drop ${title} or <span style="color: var(--primary); font-weight: 600;">browse</span></p>
        <input type="file" id="fileInput" class="hidden" accept="application/pdf" ${multiple ? "multiple" : ""} />
        
        <div id="resumeContainer" class="hidden" style="margin-top: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; width: 100%;">
          <div style="height: 1px; width: 40%; background: linear-gradient(90deg, transparent, var(--glass-border), transparent); margin-bottom: 0.5rem;"></div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Found unsaved progress:</p>
          <button id="resumeBtn" class="btn btn-secondary btn-sm" style="background: var(--primary-glow); border-color: var(--primary); color: white;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Resume Session
          </button>
        </div>
      </div>

      <div id="recentFilesContainer" class="hidden" style="margin-top: 1.5rem; text-align: center;">
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Reuse a recent file:
        </p>
        <div id="recentFilesList" style="display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem;"></div>
      </div>

      <div id="storageWarning" class="warning hidden" style="margin-top: 2rem; border-color: var(--primary-glow); background: rgba(6, 182, 212, 0.05); color: var(--text-muted);">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Your session is automatically saved. To clear local data for this tool, <a href="#" id="clearStorageLink" style="color: var(--primary); text-decoration: underline;">click here</a>.</span>
      </div>
    `;
	}

	// Standardize Progress Section HTML
	getProgressSection(status = "Processing...") {
		return `
      <div id="progressSection" class="progress-container hidden">
        <div class="progress-bar">
          <div id="progressFill" class="progress-fill"></div>
        </div>
        <div class="progress-status">
          <span id="statusText">${status}</span>
          <span id="percentText">0%</span>
        </div>
      </div>
    `;
	}

	// Utility: Format bytes to human readable
	formatBytes(bytes: number, decimals = 2): string {
		if (bytes === 0) return "0 Bytes";
		const k = 1024,
			dm = decimals < 0 ? 0 : decimals,
			sizes = ["Bytes", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
	}

	// Setup shared listeners
	setupBaseListeners(dropZoneId = "#dropZone", fileInputId = "#fileInput") {
		const backBtn = this.querySelector("#backToDash");
		if (backBtn) {
			backBtn.addEventListener("click", () => {
				logger.debug("Navigating back to dashboard");
				this.dispatchEvent(new CustomEvent("back-to-dashboard", { bubbles: true }));
			});
		}

		const dropZone = this.querySelector(dropZoneId) as HTMLElement | null;
		const fileInput = this.querySelector(fileInputId) as HTMLInputElement | null;

		if (dropZone && fileInput) {
			dropZone.addEventListener("click", (e) => {
				// Don't trigger if a button inside the dropzone was clicked
				if ((e.target as HTMLElement).closest("button")) return;

				logger.debug("Drop zone clicked, triggering file input");
				fileInput.click();
			});

			dropZone.addEventListener("dragover", (e) => {
				e.preventDefault();
				dropZone.classList.add("drag-over");
			});

			dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));

			dropZone.addEventListener("drop", (e) => {
				e.preventDefault();
				dropZone.classList.remove("drag-over");
				if (e.dataTransfer?.files) {
					logger.info("Files dropped", { count: e.dataTransfer.files.length });
					if ((this as any).handleFiles) (this as any).handleFiles(e.dataTransfer.files);
				}
			});

			fileInput.addEventListener("change", (e) => {
				const files = (e.target as HTMLInputElement).files;
				if (files) {
					logger.info("Files selected via input", { count: files.length });
					if ((this as any).handleFiles) (this as any).handleFiles(files);
				}
			});

			// Check storage usage
			this.checkStorageUsage();
			this.renderRecentFiles();

			const clearLink = this.querySelector("#clearStorageLink") as HTMLElement | null;
			if (clearLink) {
				clearLink.onclick = async (e) => {
					e.preventDefault();
					const confirmed = await this.showConfirmDialog(
						"Clear unsaved progress for this tool? (This will NOT delete your history)",
					);
					if (confirmed) {
						await this.clearFullStorage((this as any).toolKey || "");
					}
				};
			}

			const accountBtn = this.querySelector("#userAccountBtn") as HTMLElement | null;
			if (accountBtn) {
				accountBtn.onclick = () => {
					this.showDialog({
						title: "User Account",
						message:
							"User accounts, cloud sync, and cross-device history are coming soon! For now, all your data stays safely on this browser.",
						type: "info",
						confirmText: "Get Notified",
					});
				};
			}

			const aboutBtn = this.querySelector("#aboutBtn") as HTMLElement | null;
			if (aboutBtn) {
				aboutBtn.onclick = () => {
					if ((window as any).showAbout) (window as any).showAbout();
				};
			}
		}
	}

	async clearFullStorage(toolKey?: string) {
		if (toolKey) {
			await persistence.delete(toolKey);
		} else {
			await persistence.clearSessions();
		}

		const storageWarning = this.querySelector("#storageWarning");
		if (storageWarning) storageWarning.classList.add("hidden");

		// Reset local component state
		this.files = [];
		this.selectedFile = null;

		// If the component has a specific reset behavior, use it
		if ((this as any).resetState) {
			(this as any).resetState();
		} else {
			// Basic refresh of current view
			if ((this as any).render) (this as any).render();
			if ((this as any).setupEventListeners) (this as any).setupEventListeners();
		}

		logger.info("Storage cleared and UI updated", { toolKey });
	}

	async renderRecentFiles() {
		const list = this.querySelector("#recentFilesList") as HTMLElement | null;
		const container = this.querySelector("#recentFilesContainer") as HTMLElement | null;
		if (!list || !container) return;

		try {
			const jobs = await persistence.getJobs();
			if (jobs.length === 0) {
				container.classList.add("hidden");
				return;
			}

			// Get last 3 unique files
			const recentJobs = jobs.slice(0, 3);
			container.classList.remove("hidden");
			list.innerHTML = recentJobs
				.map(
					(job) => `
        <button class="recent-file-chip" data-id="${job.id}" title="${job.fileName}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${job.fileName}</span>
        </button>
      `,
				)
				.join("");

			list.querySelectorAll(".recent-file-chip").forEach((btn) => {
				btn.addEventListener("click", async () => {
					const jobId = (btn as HTMLElement).dataset.id;
					const job = jobs.find((j) => String(j.id) === jobId);
					if (job) {
						logger.info("Reusing recent file from history", { name: job.fileName });
						// Convert job data back to a File
						const file = new File([job.data], job.fileName, { type: "application/pdf" });
						if ((this as any).handleFiles) {
							(this as any).handleFiles([file] as unknown as FileList);
						}
					}
				});
			});
		} catch (err) {
			logger.error("Failed to render recent files", err);
		}
	}

	async checkStorageUsage() {
		try {
			// Use our custom estimation for the session store specifically
			const usage = await persistence.estimateUsage();
			const storageWarning = this.querySelector("#storageWarning") as HTMLElement | null;

			if (storageWarning) {
				if (usage > 0) {
					storageWarning.classList.remove("hidden");
					const usageMB = usage >= 1024 * 1024 ? (usage / (1024 * 1024)).toFixed(1) : "0.1";
					const span = storageWarning.querySelector("span");
					if (span) {
						span.innerHTML = `Session auto-saved (${usageMB}MB used). <a href="#" id="clearStorageLink" style="color: var(--primary); text-decoration: underline; cursor: pointer;">Clear storage</a>`;

						// Re-bind clear link since we just innerHTML'd it
						const clearLink = storageWarning.querySelector(
							"#clearStorageLink",
						) as HTMLElement | null;
						if (clearLink) {
							clearLink.onclick = async (e) => {
								e.preventDefault();
								const confirmed = await this.showConfirmDialog(
									"Clear unsaved progress for this tool?",
								);
								if (confirmed) {
									await this.clearFullStorage((this as any).toolKey || "");
								}
							};
						}
					}
				} else {
					storageWarning.classList.add("hidden");
				}
			}

			// Check global quota for safety
			const { usage: globalUsage, quota } = await persistence.getStorageUsage();
			if (globalUsage! > quota! * 0.8) {
				logger.warn("Browser storage is almost full", { globalUsage, quota });
				this.showErrorDialog(
					"Browser storage is almost full. Please clear your saved files to ensure proper operation.",
				);
			}
		} catch (err) {
			logger.warn("Could not check storage usage", err);
		}
	}

	/**
	 * Validates a file based on type and size.
	 * @param file
	 * @param options
	 * @returns
	 */
	validateFile(
		file: File,
		options: { maxSizeMB?: number; allowedTypes?: string[] } = {
			maxSizeMB: 100,
			allowedTypes: ["application/pdf"],
		},
	) {
		if (!file) {
			logger.warn("File validation failed: No file provided");
			return false;
		}

		if (options.allowedTypes && !options.allowedTypes.includes(file.type)) {
			const msg = `Invalid file type: ${file.type}. Expected: ${options.allowedTypes.join(", ")}`;
			logger.error(msg);
			this.showErrorDialog(msg);
			return false;
		}

		if (options.maxSizeMB && file.size > options.maxSizeMB * 1024 * 1024) {
			const msg = `File is too large (${this.formatBytes(file.size)}). Max allowed: ${options.maxSizeMB}MB`;
			logger.error(msg);
			this.showErrorDialog(msg);
			return false;
		}

		return true;
	}

	/**
	 * Basic input sanitization to prevent XSS.
	 * @param str
	 * @returns
	 */
	sanitize(str: string): string {
		if (typeof str !== "string") return "";
		return str.replace(
			/[&<>"']/g,
			(m) =>
				(
					({
						"&": "&amp;",
						"<": "&lt;",
						">": "&gt;",
						'"': "&quot;",
						"'": "&#39;",
					}) as Record<string, string>
				)[m],
		);
	}

	// Update progress bar
	updateProgress(percent: number, status?: string) {
		const fill = this.querySelector("#progressFill") as HTMLElement | null;
		const text = this.querySelector("#percentText");
		const statusEl = this.querySelector("#statusText");
		if (fill) fill.style.width = `${percent}%`;
		if (text) text.textContent = `${Math.round(percent)}%`;
		if (statusEl && status) statusEl.textContent = status;
	}

	// Standard PDF Saving Logic
	async savePdf(pdfBytes: Uint8Array | null, originalName: string, suffix = "_modified") {
		try {
			const suggestedName = (originalName || "document.pdf").replace(".pdf", `${suffix}.pdf`);
			logger.info("Attempting to save PDF", { suggestedName, size: pdfBytes?.length });

			if (!pdfBytes || pdfBytes.length === 0) {
				throw new Error("No PDF content to save");
			}

			if ("showSaveFilePicker" in window) {
				try {
					const handle = await (window as any).showSaveFilePicker({
						suggestedName,
						types: [{ description: "PDF Document", accept: { "application/pdf": [".pdf"] } }],
					});
					const writable = await handle.createWritable();
					await writable.write(pdfBytes);
					await writable.close();
					logger.info("File saved successfully via File System Access API");
					return true;
				} catch (err: any) {
					if (err.name === "AbortError") {
						logger.info("Save operation aborted by user");
						return false;
					}
					throw err;
				}
			} else {
				const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = suggestedName;
				link.click();
				setTimeout(() => URL.revokeObjectURL(url), 100);
				logger.info("File download triggered via anchor link");
				return true;
			}
		} catch (err: any) {
			logger.error("Save error:", err);
			this.showErrorDialog(`Failed to save PDF: ${err.message}`);
			return false;
		}
	}

	// Show success and bind download
	showSuccess(pdfBytes: Uint8Array | null, originalName: string, suffix: string) {
		const successMsg = this.querySelector("#successMessage");
		const downloadLink = this.querySelector("#downloadLink") as HTMLElement | null;
		if (successMsg) successMsg.classList.remove("hidden");
		if (downloadLink && pdfBytes) {
			downloadLink.onclick = async (e) => {
				e.preventDefault();
				await this.savePdf(pdfBytes, originalName, suffix);
			};
		}
	}

	// Reusable Dialog Methods
	get dialog(): any {
		return document.getElementById("globalDialog");
	}

	async showDialog(config: DialogOptions) {
		return await this.dialog.show(config);
	}

	async showSuccessDialog(message: string, title = "Success!") {
		return await this.showDialog({ title, message, type: "success" });
	}

	async showErrorDialog(error: any, title = "Error") {
		const mappedMessage = mapError(error);
		logger.error(`Showing error dialog: ${mappedMessage}`, { original: error });
		return await this.showDialog({ title, message: mappedMessage, type: "error" });
	}

	async showConfirmDialog(message: string, title = "Confirm") {
		return await this.showDialog({
			title,
			message,
			type: "warning",
			showCancel: true,
			confirmText: "Yes",
			cancelText: "No",
		});
	}

	/**
	 * Records a completed job to IndexedDB history
	 */
	async recordJob(
		toolName: string,
		fileName: string,
		pdfBytes: Uint8Array,
		metadata?: Record<string, any>,
	) {
		try {
			const job = {
				tool: toolName,
				fileName: fileName,
				data: pdfBytes,
				fileSize: pdfBytes.length,
				metadata: metadata,
			};
			await persistence.addJob(job);
			logger.info("Job recorded to history", { toolName, fileName, metadata });
			this.checkStorageUsage();
		} catch (err) {
			logger.error("Failed to record job", err);
		}
	}
}
