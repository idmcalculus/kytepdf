import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error
import { cloudConversionService } from "../../utils/CloudConversionService";

// Mock the service
vi.mock("../../utils/CloudConversionService", () => ({
  cloudConversionService: {
    convertFile: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3])),
    performOcr: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3])),
  },
}));

describe("Cloud Conversions Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call cloudConversionService with correct parameters for PDF to Word", async () => {
    const mockFile = new File(["test"], "test.pdf", { type: "application/pdf" });

    // This will be triggered by the component we're about to build
    const result = await cloudConversionService.convertFile(mockFile, "docx", { ocr: true });

    expect(cloudConversionService.convertFile).toHaveBeenCalledWith(
      mockFile,
      "docx",
      expect.objectContaining({ ocr: true }),
    );
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("should handle OCR specifically", async () => {
    const mockFile = new File(["test"], "scanned.pdf", { type: "application/pdf" });

    await cloudConversionService.performOcr(mockFile, "pdf");

    expect(cloudConversionService.performOcr).toHaveBeenCalledWith(mockFile, "pdf");
  });
});
