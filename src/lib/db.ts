const DB_NAME = 'kathai';
const DB_VERSION = 1;

export async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('epubs')) {
        db.createObjectStore('epubs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

export async function saveToDB<T>(store: string, data: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const request = tx.objectStore(store).put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getFromDB<T = unknown>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

export async function getAllFromDB<T = unknown>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

export async function deleteFromDB(store: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const request = tx.objectStore(store).delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
