// Minimal key-value access to the app's IndexedDB store. One connection is
// opened lazily and reused; it closes itself when another context (e.g. a
// newer app version, or a "reset app" deleting the database) needs it gone.

const IDB_NAME = "lists-app";
const IDB_STORE = "list-blobs";
const IDB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(IDB_NAME, IDB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE);
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			const forget = () => {
				db.close();
				dbPromise = null;
			};
			db.onversionchange = forget;
			db.onclose = () => {
				dbPromise = null;
			};
			resolve(db);
		};
		request.onerror = () => reject(request.error);
	}).catch((e) => {
		dbPromise = null;
		throw e;
	});
	return dbPromise;
}

function run<T>(
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
	return openDB().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const req = op(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
				req.onsuccess = () => resolve(req.result as T);
				req.onerror = () => reject(req.error);
			}),
	);
}

export async function idbGet(key: string): Promise<string | null> {
	return (await run<string | undefined>("readonly", (s) => s.get(key))) ?? null;
}

export async function idbSet(key: string, value: string): Promise<void> {
	await run("readwrite", (s) => s.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
	await run("readwrite", (s) => s.delete(key));
}

/** IndexedDB key of a list's locally stored blob. */
export function listBlobKey(syncId: string): string {
	return `list-${syncId}`;
}

export const IDB_DATABASE_NAME = IDB_NAME;
