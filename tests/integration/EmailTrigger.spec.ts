import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCollectionModal } from "../../components/EmailCollectionModal";
import { PdfCompressor } from "../../components/PdfCompressor";

if (!customElements.get("email-modal")) {
  customElements.define("email-modal", EmailCollectionModal);
}

// Mock persistence
vi.mock("../../utils/persistence", () => ({
  persistence: {
    get: vi.fn(),
    set: vi.fn(),
    addJob: vi.fn(),
    getJobs: vi.fn().mockResolvedValue([]),
    estimateUsage: vi.fn().mockResolvedValue(0),
    getStorageUsage: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
  },
}));

describe("Email Trigger Integration", () => {
  let compressor: PdfCompressor;
  let emailModal: EmailCollectionModal;

  beforeEach(() => {
    document.body.innerHTML = `
      <kyte-dialog id="globalDialog"></kyte-dialog>
      <email-modal id="emailModal"></email-modal>
      <div id="main-container"></div>
    `;
    compressor = new PdfCompressor();
    emailModal = document.getElementById("emailModal") as EmailCollectionModal;
    document.getElementById("main-container")?.appendChild(compressor);
  });

  it("should show email modal when download is clicked and email not collected", async () => {
    const showSpy = vi.spyOn(emailModal, "show");
    localStorage.removeItem("kyte_email_collected");

    // Setup success state manually to avoid full PDF processing
    const pdfBytes = new Uint8Array([1, 2, 3]);
    compressor.showSuccess(pdfBytes, "test.pdf", "_compressed");

    const downloadBtn = compressor.querySelector("#downloadLink") as HTMLElement;
    await downloadBtn.click();

    expect(showSpy).toHaveBeenCalled();
  });

  it("should not show email modal if already collected", async () => {
    const showSpy = vi.spyOn(emailModal, "show");
    localStorage.setItem("kyte_email_collected", "true");

    const pdfBytes = new Uint8Array([1, 2, 3]);
    compressor.showSuccess(pdfBytes, "test.pdf", "_compressed");

    const downloadBtn = compressor.querySelector("#downloadLink") as HTMLElement;

    // Mock savePdf to avoid File System Access API issues in test
    vi.spyOn(compressor, "savePdf" as any).mockResolvedValue(true);

    await downloadBtn.click();

    expect(showSpy).not.toHaveBeenCalled();
  });
});
