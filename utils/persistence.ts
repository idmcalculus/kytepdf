import { logger } from "./logger.ts";

export interface Job {
  id?: number;
  tool: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  [key: string]: any;
}

class PersistenceManager {
  private dbName = "KytePdfDB";
  private dbVersion = 2;
  private storeName = "sessions";
  private db: IDBDatabase | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
        if (!db.objectStoreNames.contains("jobs")) {
          db.createObjectStore("jobs", { keyPath: "id", autoIncrement: true });
        }
      };

      request.onsuccess = (event: Event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        logger.info("Persistence IndexedDB initialized");
        resolve(this.db);
      };

      request.onerror = (event: Event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        logger.error("IndexedDB error", error);
        reject(error);
      };
    });
  }

  /**
   * Stash data for a specific tool
   * @param key
   * @param data
   */
  async set(key: string, data: any): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.put(data, key);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Retrieve data for a specific tool
   * @param key
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Delete data for a specific tool
   * @param key
   */
  async delete(key: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  // Jobs History Methods
  async addJob(job: Omit<Job, "timestamp">): Promise<number> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["jobs"], "readwrite");
      const store = transaction.objectStore("jobs");
      const request = store.add({
        ...job,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve(request.result as number);
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  async getJobs(): Promise<Job[]> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["jobs"], "readonly");
      const store = transaction.objectStore("jobs");
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp descending
        const sorted = ((request.result as Job[]) || []).sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  async deleteJob(id: number): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["jobs"], "readwrite");
      const store = transaction.objectStore("jobs");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Clear all session data
   */
  async clearAll(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName, "jobs"], "readwrite");
      transaction.objectStore(this.storeName).clear();
      transaction.objectStore("jobs").clear();

      transaction.oncomplete = () => {
        logger.warn("All session and job data cleared from IndexedDB");
        resolve();
      };
      transaction.onerror = (e) => reject((e.target as IDBRequest).error);
    });
  }

  /**
   * Estimate current storage usage
   */
  async getStorageUsage(): Promise<StorageEstimate> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0 };
    }
    return await navigator.storage.estimate();
  }
}

export const persistence = new PersistenceManager();
