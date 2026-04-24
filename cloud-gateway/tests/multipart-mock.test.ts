import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";

class MockBusboy extends EventEmitter {
  write() {
    return true;
  }

  end() {}
}

type BusboyBehavior = (busboy: MockBusboy) => void;
let behavior: BusboyBehavior | null = null;

vi.mock("busboy", () => {
  return {
    default: vi.fn(() => {
      const busboy = new MockBusboy();
      if (behavior) {
        setImmediate(() => behavior?.(busboy));
      }
      return busboy;
    }),
  };
});

const { FilePolicy, GatewayConfig, HttpError, MultipartParser, TempStorage } = await import(
  "../server"
);

const createParser = () => {
  const config = new GatewayConfig({
    PORT: "0",
    MAX_FILE_SIZE_MB: "5",
    CLOUD_GATEWAY_API_KEY: "",
    CORS_ORIGIN: "*",
  } as NodeJS.ProcessEnv);
  const policy = new FilePolicy();
  const parser = new MultipartParser(config, new TempStorage(), policy);
  return { parser };
};

const buildRequest = () =>
  new Request("http://localhost/convert", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=mock" },
    body: "payload",
  });

const createStream = (content: string) => {
  const stream = new Readable({
    read() {},
  });
  setImmediate(() => {
    stream.push(content);
    stream.push(null);
  });
  return stream;
};

const createErrorStream = (message: string) => {
  const stream = new Readable({
    read() {},
  });
  setImmediate(() => {
    stream.destroy(new Error(message));
  });
  return stream;
};

describe("MultipartParser with mocked busboy", () => {
  afterEach(() => {
    behavior = null;
  });

  it("ignores additional file parts after the first upload", async () => {
    behavior = (busboy) => {
      const firstStream = createStream("first");
      firstStream.on("end", () => {
        setImmediate(() => {
          const secondStream = createStream("second");
          busboy.emit("file", "file", secondStream, {
            filename: "second.pdf",
            mimeType: "application/pdf",
          });
          setImmediate(() => busboy.emit("finish"));
        });
      });
      busboy.emit("file", "file", firstStream, {
        filename: "first.pdf",
        mimeType: "application/pdf",
      });
    };

    const { parser } = createParser();
    const payload = await parser.parse(buildRequest(), "req");
    expect(payload.file.originalName).toBe("first.pdf");
    await fs.rm(payload.tempDir, { recursive: true, force: true });
  });

  it("defaults missing mime types to octet-stream", async () => {
    behavior = (busboy) => {
      const stream = createStream("data");
      stream.on("end", () => {
        setImmediate(() => busboy.emit("finish"));
      });
      busboy.emit("file", "file", stream, {
        filename: "sample.pdf",
      });
    };

    const { parser } = createParser();
    const payload = await parser.parse(buildRequest(), "req");
    expect(payload.file.mimeType).toBe("application/octet-stream");
    await fs.rm(payload.tempDir, { recursive: true, force: true });
  });

  it("rejects when the file name is missing", async () => {
    behavior = (busboy) => {
      const stream = createStream("data");
      busboy.emit("file", "file", stream, { mimeType: "application/pdf" });
    };

    const { parser } = createParser();
    await expect(parser.parse(buildRequest(), "req")).rejects.toThrow(HttpError);
  });

  it("wraps non-error busboy failures as upload errors", async () => {
    behavior = (busboy) => {
      busboy.emit("error", "boom");
    };

    const { parser } = createParser();
    await expect(parser.parse(buildRequest(), "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });

  it("wraps Error busboy failures as upload errors", async () => {
    behavior = (busboy) => {
      busboy.emit("error", new Error("boom"));
    };

    const { parser } = createParser();
    await expect(parser.parse(buildRequest(), "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });

  it("wraps file stream errors as upload errors", async () => {
    behavior = (busboy) => {
      const stream = createErrorStream("boom");
      busboy.emit("file", "file", stream, {
        filename: "sample.pdf",
        mimeType: "application/pdf",
      });
    };

    const { parser } = createParser();
    await expect(parser.parse(buildRequest(), "req")).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });
});
