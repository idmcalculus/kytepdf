import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";

const {
  ConversionService,
  FilePolicy,
  GatewayConfig,
  HttpError,
  LibreOfficeClient,
  Logger,
  OcrClient,
  TempStorage,
} = await import("../server");

class FakeLibreOffice extends LibreOfficeClient {
  readonly calls: Array<{ inputPath: string; outDir: string; targetFormat: string }> = [];

  async convert(inputPath: string, outDir: string, targetFormat: string, requestId: string) {
    this.calls.push({ inputPath, outDir, targetFormat });
    return path.join(outDir, `converted-${requestId}.${targetFormat}`);
  }
}

class FakeOcr extends OcrClient {
  readonly calls: Array<{ inputPath: string; outputPath: string }> = [];

  async run(inputPath: string, outputPath: string, _requestId: string) {
    this.calls.push({ inputPath, outputPath });
    return outputPath;
  }
}

describe("Logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits logs for info, warn, and error", () => {
    const logger = new Logger();
    logger.info("info", { module: "test" });
    logger.warn("warn");
    logger.error("error", { detail: "boom" });

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("GatewayConfig", () => {
  it("parses environment defaults", () => {
    const config = new GatewayConfig({
      PORT: "9090",
      MAX_FILE_SIZE_MB: "42",
      CLOUD_GATEWAY_API_KEY: "secret",
      CORS_ORIGIN: "https://example.com, https://app.example.com",
      RATE_LIMIT_WINDOW_MS: "5000",
      RATE_LIMIT_MAX_REQUESTS: "7",
      MAX_CONCURRENT_CONVERSIONS: "3",
    } as NodeJS.ProcessEnv);

    expect(config.port).toBe(9090);
    expect(config.maxFileSizeMb).toBe(42);
    expect(config.maxFileBytes).toBe(42 * 1024 * 1024);
    expect(config.apiKey).toBe("secret");
    expect(config.corsOrigins).toEqual(["https://example.com", "https://app.example.com"]);
    expect(config.rateLimitWindowMs).toBe(5000);
    expect(config.rateLimitMaxRequests).toBe(7);
    expect(config.maxConcurrentConversions).toBe(3);
  });

  it("returns a single origin when configured", () => {
    const config = new GatewayConfig({
      PORT: "8080",
      MAX_FILE_SIZE_MB: "10",
      CLOUD_GATEWAY_API_KEY: "",
      CORS_ORIGIN: "https://example.com",
    } as NodeJS.ProcessEnv);

    expect(config.corsOrigins).toBe("https://example.com");
  });

  it("logs a warning when API key is missing outside production", () => {
    const logger = new Logger();
    const config = new GatewayConfig({ CLOUD_GATEWAY_API_KEY: "" } as NodeJS.ProcessEnv);
    vi.spyOn(logger, "warn");
    config.validate(logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("CLOUD_GATEWAY_API_KEY is empty"),
    );
  });

  it("throws when API key is missing in production", () => {
    const logger = new Logger();
    const config = new GatewayConfig({ CLOUD_GATEWAY_API_KEY: "" } as NodeJS.ProcessEnv);
    process.env.NODE_ENV = "production";
    expect(() => config.validate(logger)).toThrow(
      "CLOUD_GATEWAY_API_KEY is required in production.",
    );
    process.env.NODE_ENV = "test"; // Restore
  });

  it("throws when CORS origin is * in production", () => {
    const logger = new Logger();
    const config = new GatewayConfig({
      CLOUD_GATEWAY_API_KEY: "secret",
      CORS_ORIGIN: "*",
    } as NodeJS.ProcessEnv);
    process.env.NODE_ENV = "production";
    expect(() => config.validate(logger)).toThrow("CORS_ORIGIN must not be '*' in production.");
    process.env.NODE_ENV = "test"; // Restore
  });
});

describe("TempStorage", () => {
  it("reads regular files and rejects symlink outputs", async () => {
    const storage = new TempStorage();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kyte-storage-test-"));
    try {
      const regular = path.join(tempDir, "output.pdf");
      await fs.writeFile(regular, "ok");
      await expect(storage.readRegularFileInDir(regular, tempDir)).resolves.toEqual(
        Buffer.from("ok"),
      );

      const symlink = path.join(tempDir, "linked.pdf");
      await fs.symlink(regular, symlink);
      await expect(storage.readRegularFileInDir(symlink, tempDir)).rejects.toThrow(HttpError);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal output files", async () => {
    const storage = new TempStorage();
    await expect(storage.readRegularFileInDir("/tmp/evil/file.pdf", "/tmp/good")).rejects.toThrow(
      HttpError,
    );
  });

  it("handles non-file errors and generic fs errors", async () => {
    const storage = new TempStorage();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kyte-storage-test-"));
    const regular = path.join(tempDir, "output.pdf");

    // ELOOP
    const mockOpen = vi
      .spyOn(fs, "open")
      .mockRejectedValue(Object.assign(new Error("loop"), { code: "ELOOP" }));
    await expect(storage.readRegularFileInDir(regular, tempDir)).rejects.toThrow(
      "Conversion failed. Please try again.",
    );

    // Generic error
    mockOpen.mockRejectedValue(new Error("Random FS error"));
    await expect(storage.readRegularFileInDir(regular, tempDir)).rejects.toThrow("Random FS error");

    // Not a file
    mockOpen.mockResolvedValue({
      stat: async () => ({ isFile: () => false }),
      close: async () => {},
    } as unknown as fs.FileHandle);
    await expect(storage.readRegularFileInDir(regular, tempDir)).rejects.toThrow(
      "Conversion failed. Please try again.",
    );

    mockOpen.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe("FilePolicy", () => {
  it("sanitizes filenames", () => {
    const policy = new FilePolicy();
    expect(policy.sanitizeFilename("bad/../file.pdf")).toBe("bad_.._file.pdf");
  });

  it("prefixes filenames starting with a dash or dot", () => {
    const policy = new FilePolicy();
    expect(policy.sanitizeFilename("-flag.pdf")).toBe("input_-flag.pdf");
    expect(policy.sanitizeFilename(".hidden.pdf")).toBe("input_.hidden.pdf");
  });

  it("rejects unsupported input types", () => {
    const policy = new FilePolicy();
    expect(() => policy.validateInputFilename("evil.exe")).toThrow(HttpError);
  });

  it("accepts supported input types", () => {
    const policy = new FilePolicy();
    expect(() => policy.validateInputFilename("document.pdf")).not.toThrow();
  });

  it("rejects invalid target formats", () => {
    const policy = new FilePolicy();
    expect(() => policy.validateTargetFormat("exe")).toThrow(HttpError);
  });
});

describe("ConversionService", () => {
  it("converts directly when OCR is disabled", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "docx", ocr: "false" },
      file: {
        path: "/tmp/input.pdf",
        originalName: "input.pdf",
        mimeType: "application/pdf",
        size: 123,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-1");
    expect(result).toBe("/tmp/converted-req-1.docx");
    expect(libreOffice.calls).toHaveLength(1);
    expect(libreOffice.calls[0]?.inputPath).toBe("/tmp/input.pdf");
    expect(ocr.calls).toHaveLength(0);
  });

  it("runs OCR and returns OCR PDF for target pdf", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "pdf", ocr: "true" },
      file: {
        path: "/tmp/input.docx",
        originalName: "input.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 321,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-2");
    expect(libreOffice.calls).toHaveLength(1);
    expect(libreOffice.calls[0]?.targetFormat).toBe("pdf");
    expect(ocr.calls).toHaveLength(1);
    expect(ocr.calls[0]?.outputPath).toBe("/tmp/ocr.pdf");
    expect(result).toBe("/tmp/ocr.pdf");
  });

  it("returns the original PDF when no OCR is requested", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "pdf", ocr: "false" },
      file: {
        path: "/tmp/input.pdf",
        originalName: "input.pdf",
        mimeType: "application/pdf",
        size: 12,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-3");
    expect(result).toBe("/tmp/input.pdf");
    expect(libreOffice.calls).toHaveLength(0);
    expect(ocr.calls).toHaveLength(0);
  });

  it("defaults OCR to false when the field is missing", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "docx" },
      file: {
        path: "/tmp/input.pdf",
        originalName: "input.pdf",
        mimeType: "application/pdf",
        size: 12,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-ocr-default");
    expect(result).toBe("/tmp/converted-req-ocr-default.docx");
    expect(libreOffice.calls).toHaveLength(1);
    expect(ocr.calls).toHaveLength(0);
  });

  it("throws when target format is missing", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: {},
      file: {
        path: "/tmp/input.pdf",
        originalName: "input.pdf",
        mimeType: "application/pdf",
        size: 12,
      },
      tempDir: "/tmp",
    };

    await expect(service.convert(payload, "req-missing-format")).rejects.toThrow(HttpError);
  });

  it("runs OCR without pre-conversion when input is already PDF", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "docx", ocr: "true" },
      file: {
        path: "/tmp/input.pdf",
        originalName: "input.pdf",
        mimeType: "application/pdf",
        size: 12,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-ocr-pdf");
    expect(result).toBe("/tmp/converted-req-ocr-pdf.docx");
    expect(libreOffice.calls).toHaveLength(1);
    expect(libreOffice.calls[0]?.targetFormat).toBe("docx");
    expect(ocr.calls).toHaveLength(1);
  });

  it("converts to PDF when input is not a PDF and OCR is disabled", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "pdf", ocr: "false" },
      file: {
        path: "/tmp/input.docx",
        originalName: "input.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 12,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-pdf");
    expect(result).toBe("/tmp/converted-req-pdf.pdf");
    expect(libreOffice.calls).toHaveLength(1);
    expect(libreOffice.calls[0]?.targetFormat).toBe("pdf");
    expect(ocr.calls).toHaveLength(0);
  });

  it("runs OCR then converts when targeting docx", async () => {
    const logger = new Logger();
    const policy = new FilePolicy();
    const libreOffice = new FakeLibreOffice(logger);
    const ocr = new FakeOcr(logger);
    const service = new ConversionService(policy, libreOffice, ocr);

    const payload = {
      fields: { targetFormat: "docx", ocr: "true" },
      file: {
        path: "/tmp/input.pptx",
        originalName: "input.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: 12,
      },
      tempDir: "/tmp",
    };

    const result = await service.convert(payload, "req-4");
    expect(result).toBe("/tmp/converted-req-4.docx");
    expect(libreOffice.calls).toHaveLength(2);
    expect(libreOffice.calls[0]?.targetFormat).toBe("pdf");
    expect(ocr.calls).toHaveLength(1);
  });
});

describe("LibreOfficeClient", () => {
  it("rejects unsupported target formats", async () => {
    const logger = new Logger();
    const client = new LibreOfficeClient(logger, async () => undefined);

    await expect(client.convert("/tmp/input.pdf", "/tmp", "txt", "req")).rejects.toThrow(HttpError);
  });
});

describe("TempStorage", () => {
  it("creates and cleans temp dirs", async () => {
    const storage = new TempStorage();
    const dir = await storage.createTempDir();
    const stats = await fs.stat(dir);
    expect(stats.isDirectory()).toBe(true);
    await storage.cleanup([dir]);
    await expect(fs.stat(dir)).rejects.toBeTruthy();
  });
});
