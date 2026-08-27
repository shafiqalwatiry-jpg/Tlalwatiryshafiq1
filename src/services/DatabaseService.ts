/**
 * DatabaseService.ts
 * Robust IndexedDB storage layer with automatic LocalStorage fallback,
 * transaction safety, store versioning, and offline queue support.
 */

export class DatabaseService {
  private static DB_NAME = 'TilawatakDB';
  private static DB_VERSION = 1;
  private static STORE_NAMES = [
    'reciters',
    'recitations',
    'competitions',
    'announcements',
    'honors',
    'submissions',
    'offline_queue',
    'drafts'
  ];

  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return Promise.reject(new Error('IndexedDB not supported'));
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

        request.onerror = () => {
          console.warn('[DatabaseService] IndexedDB open error, falling back to LocalStorage');
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          this.STORE_NAMES.forEach((storeName) => {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName, { keyPath: storeName === 'offline_queue' || storeName === 'drafts' ? 'id' : 'id' });
            }
          });
        };
      });
    }

    return this.dbPromise;
  }

  static async setItem<T>(storeName: string, id: string | number, data: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const record = typeof data === 'object' && data !== null ? { ...(data as any), id } : { id, data };
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      // Fallback to LocalStorage
      try {
        localStorage.setItem(`tilawatak_idb_${storeName}_${id}`, JSON.stringify(data));
      } catch (err) {
        console.warn('[DatabaseService] LocalStorage fallback failed:', err);
      }
    }
  }

  static async setBulk<T>(storeName: string, items: T[], idKey: string = 'id'): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);

        items.forEach((item: any) => {
          const key = item[idKey];
          if (key !== undefined && key !== null) {
            store.put(item);
          }
        });
      });
    } catch (e) {
      // Fallback to LocalStorage bulk
      try {
        localStorage.setItem(`tilawatak_idb_bulk_${storeName}`, JSON.stringify(items));
      } catch (err) {
        console.warn('[DatabaseService] Bulk LocalStorage fallback failed:', err);
      }
    }
  }

  static async get<T>(storeName: string, id: string | number): Promise<T | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(id);

        request.onsuccess = () => {
          const res = request.result;
          if (res && res.data !== undefined && Object.keys(res).length === 2 && res.id !== undefined) {
            resolve(res.data);
          } else {
            resolve(res || null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      try {
        const raw = localStorage.getItem(`tilawatak_idb_${storeName}_${id}`);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    }
  }

  static async getAll<T>(storeName: string): Promise<T[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map((r: any) => (r && r.data !== undefined && Object.keys(r).length === 2 && r.id !== undefined ? r.data : r)));
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      try {
        const raw = localStorage.getItem(`tilawatak_idb_bulk_${storeName}`);
        return raw ? JSON.parse(raw) : [];
      } catch (err) {
        return [];
      }
    }
  }

  static async delete(storeName: string, id: string | number): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      try {
        localStorage.removeItem(`tilawatak_idb_${storeName}_${id}`);
      } catch (err) {}
    }
  }

  static async clearStore(storeName: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {}
  }
}
