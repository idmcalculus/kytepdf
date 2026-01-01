/**
 * Pure utility functions for PDF operations
 * Extracted from component classes for better testability
 */

/**
 * Swap two items in an array by index
 */
export function swapArrayItems<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
	const result = [...arr];
	const [removed] = result.splice(fromIndex, 1);
	result.splice(toIndex, 0, removed);
	return result;
}

/**
 * Move an item in an array by offset
 */
export function moveArrayItem<T>(arr: T[], index: number, direction: number): T[] {
	const newIndex = index + direction;
	if (newIndex < 0 || newIndex >= arr.length) {
		return arr;
	}
	const result = [...arr];
	const temp = result[index];
	result[index] = result[newIndex];
	result[newIndex] = temp;
	return result;
}

/**
 * Parse a page range string into an array of page numbers
 * Supports formats like "1-5", "1,3,5", "1-3,5,7-9"
 */
export function parsePageRange(input: string, maxPages: number): number[] {
	const pages: Set<number> = new Set();
	const parts = input.split(',').map(p => p.trim());

	for (const part of parts) {
		if (part.includes('-')) {
			const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
			if (!isNaN(start) && !isNaN(end)) {
				for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
					pages.add(i);
				}
			}
		} else {
			const num = parseInt(part, 10);
			if (!isNaN(num) && num >= 1 && num <= maxPages) {
				pages.add(num);
			}
		}
	}

	return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Format selection info text
 */
export function formatSelectionInfo(count: number): string {
	return `${count} page${count === 1 ? "" : "s"} selected`;
}

/**
 * Calculate signature placement coordinates
 */
export function calculateSignaturePlacement(
	clickX: number,
	clickY: number,
	containerWidth: number,
	containerHeight: number,
	sigWidth: number,
	sigHeight: number
): { x: number; y: number; w: number; h: number } {
	return {
		x: (clickX - sigWidth / 2) / containerWidth,
		y: (clickY - sigHeight / 2) / containerHeight,
		w: sigWidth / containerWidth,
		h: sigHeight / containerHeight,
	};
}

/**
 * Generate output filename with suffix and optional custom extension
 */
export function generateOutputFilename(originalName: string, suffix: string, extension = ".pdf"): string {
        return originalName.replace(/\.pdf$/i, "") + suffix + extension;
}
/**
 * Calculate compression savings percentage
 */
export function calculateSavingsPercent(originalSize: number, finalSize: number): number {
	return Math.max(0, Math.round((1 - finalSize / originalSize) * 100));
}

/**
 * Job type for sorting
 */
export interface JobData {
	id: number;
	timestamp: number;
	tool?: string;
	fileName?: string;
	fileSize?: number;
}

/**
 * Sort jobs by timestamp (newest first)
 */
export function sortJobsByTimestamp<T extends { timestamp: number }>(jobs: T[]): T[] {
	return [...jobs].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Filter valid PDF files from a FileList
 */
export function filterValidFiles(
	files: FileList | File[],
	maxSizeMB: number = 100
): File[] {
	return Array.from(files).filter((file) => {
		const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
		const isUnderLimit = file.size <= maxSizeMB * 1024 * 1024;
		return isPdf && isUnderLimit;
	});
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
	if (bytes === 0) return "0 Bytes";
	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format timestamp to relative or absolute time
 */
export function formatTimestamp(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 7) {
		return new Date(timestamp).toLocaleDateString();
	} else if (days > 0) {
		return `${days} day${days === 1 ? "" : "s"} ago`;
	} else if (hours > 0) {
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	} else if (minutes > 0) {
		return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
	} else {
		return "Just now";
	}
}

/**
 * Build HTML for a single file list item (used in PdfMerge)
 */
export function buildFileListItemHTML(
	file: { name: string; size: number },
	index: number,
	totalFiles: number
): string {
	return `
		<div class="file-list-item" draggable="true" data-index="${index}">
			<div class="file-info">
				<span class="file-name">${file.name}</span>
				<span class="file-size">${formatFileSize(file.size)}</span>
			</div>
			<div class="file-actions">
				<button class="move-up" data-index="${index}" ${index === 0 ? "disabled" : ""} title="Move up">↑</button>
				<button class="move-down" data-index="${index}" ${index === totalFiles - 1 ? "disabled" : ""} title="Move down">↓</button>
				<button class="remove" data-index="${index}" title="Remove">×</button>
			</div>
		</div>
	`;
}

/**
 * Build HTML for job card (used in ToolDashboard)
 */
export function buildJobCardHTML(job: JobData & { tool?: string; fileName?: string; fileSize?: number }): string {
	const toolName = job.tool || "PDF";
	const fileName = job.fileName || "Document";
	const fileSize = job.fileSize ? formatFileSize(job.fileSize) : "";
	const timestamp = formatTimestamp(job.timestamp);

	return `
		<div class="job-card" data-id="${job.id}">
			<div class="job-info">
				<span class="job-tool">${toolName}</span>
				<span class="job-file">${fileName}</span>
				${fileSize ? `<span class="job-size">${fileSize}</span>` : ""}
			</div>
			<div class="job-meta">
				<span class="job-time">${timestamp}</span>
			</div>
		</div>
	`;
}
