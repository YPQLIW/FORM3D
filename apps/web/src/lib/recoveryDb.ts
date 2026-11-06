/**
 * 복구용 자동 스냅샷 (브라우저 IndexedDB).
 * 저장하지 않은 변경이 있으면 주기적으로 현재 상태를 여기에 기록합니다.
 * 브라우저가 갑자기 닫히거나 전원이 꺼져도 다음 실행 때 복구할 수 있습니다.
 * 로컬 서버가 없어도 동작합니다.
 */
export interface RecoverySnapshot {
  data: Uint8Array;
  name: string;
  projectId: string | null;
  savedAt: number;
  objects: number;
}

const DB = 'form3d';
const STORE = 'recovery';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB 없음'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const recoveryDb = {
  put: (snap: RecoverySnapshot) => tx('readwrite', (s) => s.put(snap, KEY)).then(() => undefined),
  get: () => tx<RecoverySnapshot | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<RecoverySnapshot | undefined>),
  clear: () => tx('readwrite', (s) => s.delete(KEY)).then(() => undefined),
};
