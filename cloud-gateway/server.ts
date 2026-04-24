import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import Busboy from "busboy";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { StatusCode } from "hono/utils/http-status";

type AppVariables = {
  requestId: string;
};

type UploadedFile = {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
};

type MultipartPayload = {
  fields: Record<string, string>;
  file: UploadedFile;
  tempDir: string;
};

interface ConversionHandler {
  convert(payload: MultipartPayload, requestId: string): Promise<string>;
}

type ExecRunner = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<void>;

type ServerRunner = (options: {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
}) => void;

const execFileAsync = promisify(execFile);
const defaultExecRunner: ExecRunner = async (command, args, options) => {
  await execFileAsync(command, args, options);
};

class Logger {
  info(message: string, meta: Record<string, unknown> = {}) {
    this.log("INFO", message, meta);
  }

  warn(message: string, meta: Record<string, unknown> = {}) {
    this.log("WARN", message, meta);
  }

  error(message: string, meta: Record<string, unknown> = {}) {
    this.log("ERROR", message, meta);
  }

  private log(level: string, message: string, meta: Record<string, unknown>) {
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    };
    const output = JSON.stringify(payload);
    if (level === "ERROR") {
      console.error(output);
    } else if (level === "WARN") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class GatewayConfig {
  readonly port: number;
  readonly maxFileSizeMb: number;
  readonly apiKey: string;
  readonly corsOrigin: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.port = Number(env.PORT || 8080);
    this.maxFileSizeMb = Number(env.MAX_FILE_SIZE_MB || 50);
    this.apiKey = env.CLOUD_GATEWAY_API_KEY || "";
    this.corsOrigin = env.CORS_ORIGIN || "*";
  }

  get maxFileBytes() {
    return this.maxFileSizeMb * 1024 * 1024;
  }

  get corsOrigins() {
    if (!this.corsOrigin.includes(",")) {
      return this.corsOrigin;
    }
    return this.corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
}

class SecurityPolicy {
  apply(app: Hono<{ Variables: AppVariables }>, config: GatewayConfig) {
    app.use("*", secureHeaders());
    app.use("*", cors({ origin: config.corsOrigins }));
    app.use("*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      c.header("X-Content-Type-Options", "nosniff");
      await next();
    });
  }
}

class TempStorage {
  async createTempDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), "kyte-gateway-"));
  }

  async cleanup(paths: string[]) {
    await Promise.all(paths.map((entry) => fs.rm(entry, { recursive: true, force: true }))).catch(
      () => undefined,
    );
  }
}

class FilePolicy {
  private readonly allowedInputExt = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".odt",
    ".odp",
    ".ods",
  ]);
  private readonly allowedFormats = new Set(["docx", "pptx", "xlsx", "pdf"]);

  validateTargetFormat(format: string) {
    if (!this.allowedFormats.has(format)) {
      throw new HttpError(400, "INVALID_TARGET_FORMAT", "Unsupported target format.");
    }
  }

  validateInputFilename(filename: string) {
    const ext = path.extname(filename).toLowerCase();
    if (!this.allowedInputExt.has(ext)) {
      throw new HttpError(415, "UNSUPPORTED_INPUT_TYPE", "Unsupported input file type.");
    }
  }

  sanitizeFilename(name: string) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
}

class MultipartParser {
  constructor(
    private readonly config: GatewayConfig,
    private readonly storage: TempStorage,
    private readonly policy: FilePolicy,
  ) {}

  async parse(request: Request, _requestId: string): Promise<MultipartPayload> {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new HttpError(415, "INVALID_CONTENT_TYPE", "Expected multipart/form-data.");
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > this.config.maxFileBytes + 1024 * 1024) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Uploaded file is too large.");
    }

    if (!request.body) {
      throw new HttpError(400, "MISSING_BODY", "Missing request body.");
    }

    let tempDir: string;
    try {
      tempDir = await this.storage.createTempDir();
    } catch (err) {
      if (err instanceof Error) {
        err.message = `Upload failed: ${err.message}`;
      }
      throw new HttpError(400, "UPLOAD_FAILED", "Failed to process upload.");
    }
    const fields: Record<string, string> = {};
    let uploadedFile: UploadedFile | null = null;

    return new Promise<MultipartPayload>((resolve, reject) => {
      const busboy = Busboy({
        headers: { "content-type": contentType },
        limits: {
          files: 1,
          fileSize: this.config.maxFileBytes,
          fields: 10,
        },
      });

      busboy.on("field", (name, value) => {
        fields[name] = value;
      });

      busboy.on("file", (fieldName, stream, info) => {
        if (fieldName !== "file") {
          stream.resume();
          return;
        }

        if (uploadedFile) {
          stream.resume();
          return;
        }

        let safeName = "input";
        let targetPath = "";
        let writeStream: ReturnType<typeof createWriteStream> | null = null;
        try {
          safeName = this.policy.sanitizeFilename(info.filename || "input");
          this.policy.validateInputFilename(safeName);
          targetPath = path.join(tempDir, safeName);
          writeStream = createWriteStream(targetPath, { flags: "wx" });
        } catch (err) {
          stream.resume();
          reject(err);
          return;
        }

        let total = 0;
        stream.on("data", (chunk) => {
          total += chunk.length;
        });

        stream.on("limit", () => {
          writeStream?.destroy();
          reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "Uploaded file is too large."));
        });

        stream.on("end", () => {
          uploadedFile = {
            path: targetPath,
            originalName: safeName,
            mimeType: info.mimeType || "application/octet-stream",
            size: total,
          };
        });

        stream.on("error", (err) => {
          writeStream?.destroy();
          reject(err);
        });

        writeStream.on("error", (err) => reject(err));

        stream.pipe(writeStream);
      });

      busboy.on("filesLimit", () => {
        reject(new HttpError(400, "TOO_MANY_FILES", "Only one file is allowed."));
      });

      busboy.on("error", (err) => {
        reject(err);
      });

      busboy.on("finish", () => {
        if (!uploadedFile) {
          reject(new HttpError(400, "MISSING_FILE", "Missing file upload."));
          return;
        }
        resolve({ fields, file: uploadedFile, tempDir });
      });

      this.toNodeStream(request)
        .then((stream) => {
          stream.on("error", (err) => reject(err));
          stream.pipe(busboy);
        })
        .catch((err) => reject(err));
    }).catch(async (err) => {
      await this.storage.cleanup([tempDir]);
      if (err instanceof HttpError) {
        throw err;
      }
      if (err instanceof Error) {
        err.message = `Upload failed: ${err.message}`;
      }
      throw new HttpError(400, "UPLOAD_FAILED", "Failed to process upload.");
    });
  }

  private async toNodeStream(request: Request) {
    const body = request.body;
    if (!body) {
      throw new HttpError(400, "MISSING_BODY", "Missing request body.");
    }
    const isBun = typeof (process as any).versions?.bun === "string";
    if (isBun) {
      const buffer = Buffer.from(await request.arrayBuffer());
      return Readable.from(buffer);
    }
    return Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>);
  }
}

class LibreOfficeClient {
  constructor(
    private readonly logger: Logger,
    private readonly execRunner: ExecRunner = defaultExecRunner,
  ) {}

  async convert(inputPath: string, outDir: string, targetFormat: string, requestId: string) {
    const args = this.convertArgs(targetFormat, outDir, inputPath);
    this.logger.info("LibreOffice conversion started", {
      requestId,
      targetFormat,
    });
    await this.execRunner("soffice", args, {
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const baseName = path.parse(inputPath).name;
    return path.join(outDir, `${baseName}.${targetFormat}`);
  }

  private convertArgs(targetFormat: string, outDir: string, inputPath: string) {
    const formatMap: Record<string, string> = {
      docx: 'docx:"MS Word 2007 XML"',
      pptx: 'pptx:"Impress MS PowerPoint 2007 XML"',
      xlsx: 'xlsx:"Calc MS Excel 2007 XML"',
      pdf: "pdf",
    };

    const formatArg = formatMap[targetFormat];
    if (!formatArg) {
      throw new HttpError(400, "INVALID_TARGET_FORMAT", "Unsupported target format.");
    }

    return [
      "--headless",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--nofirststartwizard",
      "--invisible",
      `-env:UserInstallation=file:///tmp/lo-${process.pid}`,
      "--convert-to",
      formatArg,
      "--outdir",
      outDir,
      inputPath,
    ];
  }
}

class OcrClient {
  constructor(
    private readonly logger: Logger,
    private readonly execRunner: ExecRunner = defaultExecRunner,
  ) {}

  async run(inputPath: string, outputPath: string, requestId: string) {
    this.logger.info("OCR started", { requestId });
    const args = ["--skip-text", "--optimize", "1", "--output-type", "pdf", inputPath, outputPath];
    await this.execRunner("ocrmypdf", args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return outputPath;
  }
}

class ConversionService implements ConversionHandler {
  constructor(
    private readonly policy: FilePolicy,
    private readonly libreOffice: LibreOfficeClient,
    private readonly ocr: OcrClient,
  ) {}

  async convert(payload: MultipartPayload, requestId: string) {
    const targetFormat = String(payload.fields.targetFormat || "").toLowerCase();
    const ocrEnabled = String(payload.fields.ocr || "false").toLowerCase() === "true";
    this.policy.validateTargetFormat(targetFormat);

    const inputPath = payload.file.path;
    const inputExt = path.extname(inputPath).toLowerCase();
    const isInputPdf = inputExt === ".pdf";

    let workingPdf = inputPath;
    if (ocrEnabled) {
      if (!isInputPdf) {
        workingPdf = await this.libreOffice.convert(inputPath, payload.tempDir, "pdf", requestId);
      }
      workingPdf = await this.ocr.run(workingPdf, path.join(payload.tempDir, "ocr.pdf"), requestId);
    }

    if (targetFormat === "pdf") {
      if (ocrEnabled) {
        return workingPdf;
      }
      if (isInputPdf) {
        return inputPath;
      }
      return this.libreOffice.convert(inputPath, payload.tempDir, "pdf", requestId);
    }

    const sourcePath = ocrEnabled ? workingPdf : inputPath;
    return this.libreOffice.convert(sourcePath, payload.tempDir, targetFormat, requestId);
  }
}

class GatewayServer {
  private readonly app: Hono<{ Variables: AppVariables }>;

  constructor(
    private readonly config: GatewayConfig,
    private readonly logger: Logger,
    private readonly security: SecurityPolicy,
    private readonly parser: MultipartParser,
    private readonly conversionService: ConversionHandler,
    private readonly storage: TempStorage,
    private readonly serverRunner: ServerRunner = serve,
  ) {
    this.app = new Hono<{ Variables: AppVariables }>();
    this.registerMiddleware();
    this.registerRoutes();
    this.registerErrorHandler();
  }

  start() {
    this.serverRunner({
      fetch: this.app.fetch,
      port: this.config.port,
    });
    this.logger.info("Cloud gateway started", { port: this.config.port });
  }

  handle(request: Request) {
    return this.app.fetch(request);
  }

  private registerMiddleware() {
    this.app.use("*", async (c, next) => {
      c.set("requestId", randomUUID());
      await next();
    });
    this.security.apply(this.app, this.config);
  }

  private registerRoutes() {
    this.app.get("/health", (c) => {
      return c.json({ status: "ok" });
    });

    this.app.post("/convert", async (c) => {
      const requestId = c.get("requestId");
      if (!this.ensureApiKey(c, requestId)) {
        return this.jsonError(c, { error: "Unauthorized", code: "UNAUTHORIZED", requestId }, 401);
      }

      let payload: MultipartPayload | null = null;
      try {
        payload = await this.parser.parse(c.req.raw, requestId);
        const outputPath = await this.conversionService.convert(payload, requestId);
        const outputBytes = await fs.readFile(outputPath);
        const targetFormat = String(payload.fields.targetFormat || "").toLowerCase();
        const baseName = path.parse(payload.file.originalName).name || "converted";
        const downloadName = `${baseName}.${targetFormat}`;

        c.header("Content-Type", this.getMimeType(targetFormat));
        c.header("Content-Disposition", `attachment; filename="${downloadName}"`);
        return c.body(outputBytes);
      } catch (err) {
        this.handleError(err, requestId);
        const status = err instanceof HttpError ? err.status : 500;
        const code = err instanceof HttpError ? err.code : "INTERNAL_ERROR";
        const message =
          err instanceof HttpError ? err.message : "Conversion failed. Please try again.";
        return this.jsonError(c, { error: message, code, requestId }, status);
      } finally {
        if (payload) {
          await this.storage.cleanup([payload.tempDir, payload.file.path]);
        }
      }
    });
  }

  private registerErrorHandler() {
    this.app.onError((err, c) => {
      const requestId = c.get("requestId");
      this.handleError(err, requestId);
      return this.jsonError(
        c,
        { error: "Internal Server Error", code: "INTERNAL_ERROR", requestId },
        500,
      );
    });
  }

  private ensureApiKey(c: Context, requestId: string) {
    if (!this.config.apiKey) return true;
    const provided = c.req.header("x-api-key") || "";
    const expected = this.config.apiKey;
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    const allowed =
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer);
    if (!allowed) {
      this.logger.warn("Unauthorized request", { requestId });
    }
    return allowed;
  }

  private getMimeType(targetFormat: string) {
    const map: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pdf: "application/pdf",
    };
    return map[targetFormat] || "application/octet-stream";
  }

  private jsonError(
    c: Context,
    payload: { error: string; code: string; requestId: string },
    status: number,
  ) {
    return c.newResponse(JSON.stringify(payload), status as StatusCode, {
      "Content-Type": "application/json",
    });
  }

  private handleError(err: unknown, requestId: string) {
    if (err instanceof HttpError) {
      this.logger.warn("Request failed", {
        requestId,
        status: err.status,
        code: err.code,
        message: err.message,
      });
    } else {
      this.logger.error("Unhandled error", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
}

const runBootstrap = (serverRunner: ServerRunner = serve) => {
  const logger = new Logger();
  const config = new GatewayConfig(process.env);
  const storage = new TempStorage();
  const policy = new FilePolicy();
  const security = new SecurityPolicy();
  const parser = new MultipartParser(config, storage, policy);
  const libreOffice = new LibreOfficeClient(logger);
  const ocr = new OcrClient(logger);
  const conversionService = new ConversionService(policy, libreOffice, ocr);
  const server = new GatewayServer(
    config,
    logger,
    security,
    parser,
    conversionService,
    storage,
    serverRunner,
  );
  server.start();
};

const Bootstrap = {
  run: runBootstrap,
};

if (process.env.NODE_ENV !== "test") {
  runBootstrap();
}

export {
  Bootstrap,
  ConversionService,
  type ConversionHandler,
  type ExecRunner,
  FilePolicy,
  GatewayConfig,
  GatewayServer,
  HttpError,
  LibreOfficeClient,
  Logger,
  MultipartParser,
  OcrClient,
  SecurityPolicy,
  TempStorage,
  runBootstrap,
};
export type { MultipartPayload, UploadedFile };
