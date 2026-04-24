import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn((_command: string, _args: string[], _options: any, cb: any) => {
  cb(null, "", "");
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

process.env.NODE_ENV = "test";

const { LibreOfficeClient, Logger, OcrClient } = await import("../server");

describe("Default exec runner", () => {
  it("uses the default runner for libreoffice and ocr", async () => {
    const logger = new Logger();
    const libreOffice = new LibreOfficeClient(logger);
    const ocr = new OcrClient(logger);

    const docxPath = await libreOffice.convert("/tmp/input.pdf", "/tmp", "docx", "req");
    const ocrPath = await ocr.run("/tmp/input.pdf", "/tmp/ocr.pdf", "req");

    expect(docxPath).toBe("/tmp/input.docx");
    expect(ocrPath).toBe("/tmp/ocr.pdf");
    expect(execFileMock).toHaveBeenCalled();
  });
});
