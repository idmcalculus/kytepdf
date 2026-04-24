import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";

const { FilePolicy, GatewayConfig, HttpError, MultipartParser, TempStorage } = await import(
  "../server"
);

const createParser = (maxFileSizeMb = "5", storage?: InstanceType<typeof TempStorage>) => {
  const config = new GatewayConfig({
    PORT: "0",
    MAX_FILE_SIZE_MB: maxFileSizeMb,
    CLOUD_GATEWAY_API_KEY: "",
    CORS_ORIGIN: "*",
  } as NodeJS.ProcessEnv);
  const policy = new FilePolicy();
  const parser = new MultipartParser(config, storage ?? new TempStorage(), policy);
  return { parser, policy };
};

const buildForm = (
  fields: Record<string, string>,
  files: Array<{ name: string; field: string }>,
) => {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    form.append(key, value);
  });
  files.forEach((file) => {
    form.append(file.field, new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }), file.name);
  });
  return form;
};

describe("MultipartParser", () => {
  it("rejects non-multipart requests", async () => {
    const { parser } = createParser();
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: "plain text",
      headers: { "content-type": "text/plain" },
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("rejects requests without a content-type header", async () => {
    const { parser } = createParser();
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: "plain text",
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("rejects missing bodies", async () => {
    const { parser } = createParser();
    const request = new Request("http://localhost/convert", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=missing" },
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("rejects oversized payloads from content-length", async () => {
    const { parser } = createParser("1");
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: new Blob(["x".repeat(10)]),
      headers: {
        "content-type": "multipart/form-data; boundary=oversize",
        "content-length": "99999999",
      },
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("rejects unsupported file extensions", async () => {
    const { parser } = createParser();
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "evil.exe", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("rejects when no file field is provided", async () => {
    const { parser } = createParser();
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "ignored" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toThrow(HttpError);
  });

  it("parses a valid multipart request", async () => {
    const { parser } = createParser();
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    const payload = await parser.parse(request, "req");
    expect(payload.fields.targetFormat).toBe("docx");
    expect(payload.file.originalName).toBe("sample.pdf");
    await fs.rm(payload.tempDir, { recursive: true, force: true });
  });

  it("rejects multiple files", async () => {
    const { parser } = createParser();
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "first.pdf", field: "file" },
      { name: "second.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });

  it("rejects files that exceed the configured limit", async () => {
    const { parser } = createParser("0");
    const form = new FormData();
    form.append("targetFormat", "docx");
    form.append("ocr", "false");
    form.append("file", new Blob(["1234567890"], { type: "application/pdf" }), "sample.pdf");

    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("runs the Bun stream path when bun is detected", async () => {
    const original = (process as any).versions?.bun;
    (process as any).versions.bun = "1.0.0";

    const { parser } = createParser();
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    const payload = await parser.parse(request, "req");
    expect(payload.file.originalName).toBe("sample.pdf");
    await fs.rm(payload.tempDir, { recursive: true, force: true });

    if (original === undefined) {
      delete (process as any).versions.bun;
    } else {
      (process as any).versions.bun = original;
    }
  });

  it("throws when toNodeStream receives a request without a body", async () => {
    const { parser } = createParser();
    const request = new Request("http://localhost/convert", { method: "POST" });

    await expect((parser as any).toNodeStream(request)).rejects.toMatchObject({
      code: "MISSING_BODY",
    });
  });

  it("wraps toNodeStream failures as upload errors", async () => {
    const { parser } = createParser();
    (parser as any).toNodeStream = () => Promise.reject(new Error("boom"));
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });

  it("rejects upload if temp dir creation fails", async () => {
    class FailingStorage extends TempStorage {
      async createTempDir(): Promise<string> {
        throw new Error("no temp");
      }
    }

    const storage = new FailingStorage();
    const { parser } = createParser("5", storage);
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });

  it("rejects upload if temp dir creation fails with a non-error", async () => {
    class FailingStorage extends TempStorage {
      async createTempDir(): Promise<string> {
        throw "no temp";
      }
    }

    const storage = new FailingStorage();
    const { parser } = createParser("5", storage);
    const form = buildForm({ targetFormat: "docx", ocr: "false" }, [
      { name: "sample.pdf", field: "file" },
    ]);
    const request = new Request("http://localhost/convert", {
      method: "POST",
      body: form,
    });

    await expect(parser.parse(request, "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });
});
