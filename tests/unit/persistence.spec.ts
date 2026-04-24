import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistence } from "../../utils/persistence";

describe("PersistenceManager", () => {
  let mockDb: any;
  let mockStore: any;
  let mockJobsStore: any;
  let mockRequest: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = { onsuccess: null, onerror: null, result: null };
    mockStore = {
      put: vi.fn(() => ({ onsuccess: null })),
      get: vi.fn(() => ({ onsuccess: null })),
      delete: vi.fn(() => ({ onsuccess: null })),
      add: vi.fn(() => ({ onsuccess: null })),
      getAll: vi.fn(() => ({ onsuccess: null })),
      clear: vi.fn(() => ({ onsuccess: null })),
      openCursor: vi.fn(() => ({ onsuccess: null, result: null })),
    };
    mockJobsStore = {
      add: vi.fn(() => ({ onsuccess: null })),
      delete: vi.fn(() => ({ onsuccess: null })),
      getAll: vi.fn(() => ({ onsuccess: null })),
      clear: vi.fn(() => ({ onsuccess: null })),
    };

    mockDb = {
      transaction: vi.fn((_stores) => ({
        objectStore: vi.fn((name) => (name === "jobs" ? mockJobsStore : mockStore)),
        oncomplete: null,
      })),
      objectStoreNames: { contains: vi.fn(() => true) },
      close: vi.fn(),
    };

    vi.stubGlobal("indexedDB", {
      open: vi.fn().mockReturnValue(mockRequest),
    });

    (persistence as any).db = null;
    (persistence as any).initStarted = false;
  });

  it("should initialize the database", async () => {
    const initPromise = persistence.init();
    mockRequest.onsuccess({ target: { result: mockDb } });
    const db = await initPromise;
    expect(db).toBe(mockDb);
    expect(await persistence.init()).toBe(mockDb);
  });

  it("should create missing object stores during upgrades", async () => {
    const createObjectStore = vi.fn();
    const upgradeDb = {
      createObjectStore,
      objectStoreNames: { contains: vi.fn(() => false) },
    };

    const initPromise = persistence.init();
    mockRequest.onupgradeneeded({ target: { result: upgradeDb } });
    mockRequest.onsuccess({ target: { result: upgradeDb } });

    await initPromise;

    expect(createObjectStore).toHaveBeenCalledWith("sessions");
    expect(createObjectStore).toHaveBeenCalledWith("jobs", {
      autoIncrement: true,
      keyPath: "id",
    });
  });

  it("should reject when IndexedDB fails to open", async () => {
    const initPromise = persistence.init();
    const error = new Error("open failed");

    mockRequest.onerror({ target: { error } });

    await expect(initPromise).rejects.toThrow("open failed");
  });

  it("should set data", async () => {
    const setPromise = persistence.set("k", "v");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const putReq = vi.mocked(mockStore.put).mock.results[0].value;
    putReq.onsuccess({});

    await setPromise;
    expect(mockStore.put).toHaveBeenCalledWith("v", "k");
  });

  it("should reject set failures", async () => {
    const setPromise = persistence.set("k", "v");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const putReq = vi.mocked(mockStore.put).mock.results[0].value;
    putReq.onerror({ target: { error: new Error("put failed") } });

    await expect(setPromise).rejects.toThrow("put failed");
  });

  it("should get data", async () => {
    const getPromise = persistence.get("key");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const getReq = vi.mocked(mockStore.get).mock.results[0].value;
    getReq.result = "value";
    getReq.onsuccess({ target: getReq });

    expect(await getPromise).toBe("value");
  });

  it("should reject get failures", async () => {
    const getPromise = persistence.get("key");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const getReq = vi.mocked(mockStore.get).mock.results[0].value;
    getReq.onerror({ target: { error: new Error("get failed") } });

    await expect(getPromise).rejects.toThrow("get failed");
  });

  it("should delete data", async () => {
    const deletePromise = persistence.delete("key");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const delReq = vi.mocked(mockStore.delete).mock.results[0].value;
    delReq.onsuccess({});

    await deletePromise;
    expect(mockStore.delete).toHaveBeenCalledWith("key");
  });

  it("should reject delete failures", async () => {
    const deletePromise = persistence.delete("key");
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const delReq = vi.mocked(mockStore.delete).mock.results[0].value;
    delReq.onerror({ target: { error: new Error("delete failed") } });

    await expect(deletePromise).rejects.toThrow("delete failed");
  });

  it("should add a job", async () => {
    const job = { tool: "compress", fileName: "test.pdf", fileSize: 100 };
    const addPromise = persistence.addJob(job);
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const addReq = vi.mocked(mockJobsStore.add).mock.results[0].value;
    addReq.result = 123;
    addReq.onsuccess({ target: addReq });

    const id = await addPromise;
    expect(id).toBe(123);
  });

  it("should reject add job failures", async () => {
    const addPromise = persistence.addJob({
      tool: "compress",
      fileName: "test.pdf",
      fileSize: 100,
    });
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const addReq = vi.mocked(mockJobsStore.add).mock.results[0].value;
    addReq.onerror({ target: { error: new Error("add failed") } });

    await expect(addPromise).rejects.toThrow("add failed");
  });

  it("should get all jobs sorted by timestamp", async () => {
    const mockJobs = [
      { id: 1, timestamp: 100 },
      { id: 2, timestamp: 300 },
      { id: 3, timestamp: 200 },
    ];
    const getJobsPromise = persistence.getJobs();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const getAllReq = vi.mocked(mockJobsStore.getAll).mock.results[0].value;
    getAllReq.result = mockJobs;
    getAllReq.onsuccess({ target: getAllReq });

    const result = await getJobsPromise;
    expect(result[0].id).toBe(2); // 300 - newest
    expect(result[1].id).toBe(3); // 200
    expect(result[2].id).toBe(1); // 100 - oldest
  });

  it("should reject get jobs failures", async () => {
    const getJobsPromise = persistence.getJobs();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const getAllReq = vi.mocked(mockJobsStore.getAll).mock.results[0].value;
    getAllReq.onerror({ target: { error: new Error("jobs failed") } });

    await expect(getJobsPromise).rejects.toThrow("jobs failed");
  });

  it("should delete a job", async () => {
    const deletePromise = persistence.deleteJob(123);
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const delReq = vi.mocked(mockJobsStore.delete).mock.results[0].value;
    delReq.onsuccess({});

    await deletePromise;
    expect(mockJobsStore.delete).toHaveBeenCalledWith(123);
  });

  it("should reject delete job failures", async () => {
    const deletePromise = persistence.deleteJob(123);
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const delReq = vi.mocked(mockJobsStore.delete).mock.results[0].value;
    delReq.onerror({ target: { error: new Error("delete job failed") } });

    await expect(deletePromise).rejects.toThrow("delete job failed");
  });

  it("should estimate usage", async () => {
    const estimatePromise = persistence.estimateUsage();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const cursorReq = vi.mocked(mockStore.openCursor).mock.results[0].value;
    cursorReq.result = {
      value: { size: 100 },
      continue: vi.fn(() => {
        cursorReq.result = null;
        cursorReq.onsuccess({ target: cursorReq });
      }),
    };
    cursorReq.onsuccess({ target: cursorReq });

    expect(await estimatePromise).toBe(100);
  });

  it("should estimate usage with nested data", async () => {
    const estimatePromise = persistence.estimateUsage();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const cursorReq = vi.mocked(mockStore.openCursor).mock.results[0].value;
    cursorReq.result = {
      value: { data: { size: 50 } },
      continue: vi.fn(() => {
        cursorReq.result = null;
        cursorReq.onsuccess({ target: cursorReq });
      }),
    };
    cursorReq.onsuccess({ target: cursorReq });

    expect(await estimatePromise).toBe(50);
  });

  it("should estimate usage with array data", async () => {
    const estimatePromise = persistence.estimateUsage();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const cursorReq = vi.mocked(mockStore.openCursor).mock.results[0].value;
    cursorReq.result = {
      value: [{ size: 25 }, { size: 25 }],
      continue: vi.fn(() => {
        cursorReq.result = null;
        cursorReq.onsuccess({ target: cursorReq });
      }),
    };
    cursorReq.onsuccess({ target: cursorReq });

    expect(await estimatePromise).toBe(50);
  });

  it("should resolve zero when usage estimation cursor fails", async () => {
    const estimatePromise = persistence.estimateUsage();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const cursorReq = vi.mocked(mockStore.openCursor).mock.results[0].value;
    cursorReq.onerror();

    expect(await estimatePromise).toBe(0);
  });

  it("should get storage usage via navigator", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 1000, quota: 2000 }),
      },
    });

    const estimate = await persistence.getStorageUsage();
    expect(estimate).toEqual({ usage: 1000, quota: 2000 });
  });

  it("should return default values when navigator.storage unavailable", async () => {
    vi.stubGlobal("navigator", {});

    const estimate = await persistence.getStorageUsage();
    expect(estimate).toEqual({ usage: 0, quota: 0 });
  });

  it("should clear sessions", async () => {
    const clearPromise = persistence.clearSessions();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const transaction = vi.mocked(mockDb.transaction).mock.results[0].value;
    transaction.oncomplete();

    await clearPromise;
    expect(mockStore.clear).toHaveBeenCalled();
  });

  it("should reject clear session failures", async () => {
    const clearPromise = persistence.clearSessions();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const transaction = vi.mocked(mockDb.transaction).mock.results[0].value;
    transaction.onerror({ target: { error: new Error("clear sessions failed") } });

    await expect(clearPromise).rejects.toThrow("clear sessions failed");
  });

  it("should clear all data", async () => {
    const clearPromise = persistence.clearAll();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const transaction = vi.mocked(mockDb.transaction).mock.results[0].value;
    transaction.oncomplete();

    await clearPromise;
    expect(mockStore.clear).toHaveBeenCalled();
    expect(mockJobsStore.clear).toHaveBeenCalled();
  });

  it("should reject clear all failures", async () => {
    const clearPromise = persistence.clearAll();
    mockRequest.onsuccess({ target: { result: mockDb } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const transaction = vi.mocked(mockDb.transaction).mock.results[0].value;
    transaction.onerror({ target: { error: new Error("clear all failed") } });

    await expect(clearPromise).rejects.toThrow("clear all failed");
  });
});
