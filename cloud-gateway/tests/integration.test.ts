import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";

const {
  FilePolicy,
  GatewayConfig,
  GatewayServer,
  HttpError,
  Logger,
  MultipartParser,
  SecurityPolicy,
  TempStorage,
} = await import("../server");

class StubConversionService {
  constructor(
    private readonly policy: InstanceType<typeof FilePolicy>,
    private readonly validate = true,
  ) {}

  async convert(payload: { fields: Record<string, string>; tempDir: string }, requestId: string) {
    const targetFormat = String(payload.fields.targetFormat || "").toLowerCase();
    if (this.validate) {
      this.policy.validateTargetFormat(targetFormat);
    }
    const outputPath = path.join(payload.tempDir, `converted-${requestId}.${targetFormat}`);
    await fs.writeFile(outputPath, Buffer.from("converted"));
    return outputPath;
  }
}

const createServer = (
  apiKey: string,
  conversionService?: {
    convert: (
      payload: { fields: Record<string, string>; tempDir: string },
      requestId: string,
    ) => Promise<string>;
  },
) => {
  const config = new GatewayConfig({
    PORT: "0",
    MAX_FILE_SIZE_MB: "5",
    CLOUD_GATEWAY_API_KEY: apiKey,
    CORS_ORIGIN: "*",
  } as NodeJS.ProcessEnv);
  const logger = new Logger();
  const storage = new TempStorage();
  const policy = new FilePolicy();
  const parser = new MultipartParser(config, storage, policy);
  const security = new SecurityPolicy();
  const fallbackService = new StubConversionService(policy);
  return new GatewayServer(
    config,
    logger,
    security,
    parser,
    conversionService ?? fallbackService,
    storage,
  );
};

const buildRequest = (apiKey?: string, targetFormat = "docx") => {
  const form = new FormData();
  form.append("targetFormat", targetFormat);
  form.append("ocr", "false");
  form.append("file", new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }), "sample.pdf");

  const headers = new Headers();
  if (apiKey) headers.set("x-api-key", apiKey);
  return new Request("http://localhost/convert", {
    method: "POST",
    headers,
    body: form,
  });
};

describe("GatewayServer integration", () => {
  it("serves health checks with security headers", async () => {
    const server = createServer("");
    const response = await server.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects unauthorized requests", async () => {
    const server = createServer("secret");
    const response = await server.handle(buildRequest());
    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.code).toBe("UNAUTHORIZED");
  });

  it("handles a conversion request end-to-end", async () => {
    const server = createServer("secret");
    const response = await server.handle(buildRequest("secret"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toContain("sample.docx");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("allows requests when api key is not configured", async () => {
    const server = createServer("");
    const response = await server.handle(buildRequest());
    expect(response.status).toBe(200);
  });

  it("returns a conversion error when service throws HttpError", async () => {
    const conversionService = {
      async convert() {
        throw new HttpError(400, "BAD_INPUT", "Bad input");
      },
    };
    const server = createServer("secret", conversionService);
    const response = await server.handle(buildRequest("secret"));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("BAD_INPUT");
  });

  it("returns a generic error when service throws", async () => {
    const conversionService = {
      async convert() {
        throw new Error("boom");
      },
    };
    const server = createServer("secret", conversionService);
    const response = await server.handle(buildRequest("secret"));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe("INTERNAL_ERROR");
  });

  it("returns a generic error when service throws a non-error", async () => {
    const conversionService = {
      async convert() {
        throw "boom";
      },
    };
    const server = createServer("secret", conversionService);
    const response = await server.handle(buildRequest("secret"));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe("INTERNAL_ERROR");
  });

  it("falls back to octet-stream for unknown formats", async () => {
    const policy = new FilePolicy();
    const conversionService = new StubConversionService(policy, false);
    const server = createServer("secret", conversionService);
    const response = await server.handle(buildRequest("secret", "unknown"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("returns an error for invalid content types", async () => {
    const server = createServer("");
    const response = await server.handle(
      new Request("http://localhost/convert", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "payload",
      }),
    );
    expect(response.status).toBe(415);
    const payload = await response.json();
    expect(payload.code).toBe("INVALID_CONTENT_TYPE");
  });

  it("falls back to a converted filename when the original name is empty", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kyte-test-"));
    const mockParser = {
      async parse() {
        return {
          fields: {},
          file: {
            path: path.join(tempDir, "input.pdf"),
            originalName: "",
            mimeType: "application/pdf",
            size: 1,
          },
          tempDir,
        };
      },
    } as unknown as InstanceType<typeof MultipartParser>;
    const conversionService = {
      async convert(
        payload: { fields: Record<string, string>; tempDir: string },
        requestId: string,
      ) {
        const targetFormat = String(payload.fields.targetFormat || "").toLowerCase();
        const outputPath = path.join(payload.tempDir, `converted-${requestId}.${targetFormat}`);
        await fs.writeFile(outputPath, Buffer.from("converted"));
        return outputPath;
      },
    };

    const config = new GatewayConfig({
      PORT: "0",
      MAX_FILE_SIZE_MB: "5",
      CLOUD_GATEWAY_API_KEY: "",
      CORS_ORIGIN: "*",
    } as NodeJS.ProcessEnv);
    const logger = new Logger();
    const storage = new TempStorage();
    const security = new SecurityPolicy();
    const server = new GatewayServer(
      config,
      logger,
      security,
      mockParser,
      conversionService,
      storage,
    );

    const response = await server.handle(
      new Request("http://localhost/convert", { method: "POST", body: "payload" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="converted."');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns 500 when middleware throws", async () => {
    const config = new GatewayConfig({
      PORT: "0",
      MAX_FILE_SIZE_MB: "5",
      CLOUD_GATEWAY_API_KEY: "",
      CORS_ORIGIN: "*",
    } as NodeJS.ProcessEnv);
    const logger = new Logger();
    const storage = new TempStorage();
    const policy = new FilePolicy();
    const parser = new MultipartParser(config, storage, policy);
    const explodingSecurity = {
      apply(app: any) {
        app.use("*", () => {
          throw new Error("boom");
        });
      },
    };
    const conversionService = new StubConversionService(policy);
    const server = new GatewayServer(
      config,
      logger,
      explodingSecurity as unknown as InstanceType<typeof SecurityPolicy>,
      parser,
      conversionService,
      storage,
    );

    const response = await server.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe("INTERNAL_ERROR");
  });
});
