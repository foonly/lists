import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { nanoid } from "nanoid";
import { ListBlobSchema, tracked, TRACKED_FIELDS } from "@/models/list";
import type { ListBlob, ListItem, TrackedFieldName } from "@/models/list";
import type { ListCredentials } from "@/models/app-state";
import {
	SyncClient,
	pullBlob,
	pushBlob,
	contentChecksum,
} from "@/lib/sync-client";
import { useAppStore } from "./app";

// ---------------------------------------------------------------------------
// SyncMeta type
// ---------------------------------------------------------------------------

export interface SyncMeta {
	status: "idle" | "pulling" | "pushing" | "merging" | "error";
	lastSyncedAt: number | null;
	remoteTimestamp: number | null;
	dirty: boolean;
	error: string | null;
}

function defaultSyncMeta(): SyncMeta {
	return {
		status: "idle",
		lastSyncedAt: null,
		remoteTimestamp: null,
		dirty: false,
		error: null,
	};
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

const IDB_NAME = "lists-app";
const IDB_STORE = "list-blobs";
const IDB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(IDB_NAME, IDB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function idbGet(key: string): Promise<string | null> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readonly");
		const store = tx.objectStore(IDB_STORE);
		const req = store.get(key);
		req.onsuccess = () => resolve((req.result as string) ?? null);
		req.onerror = () => reject(req.error);
	});
}

async function idbSet(key: string, value: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		const store = tx.objectStore(IDB_STORE);
		const req = store.put(value, key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useListStore = defineStore("list", () => {
	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	const blob = ref<ListBlob | null>(null);
	const credentials = ref<ListCredentials | null>(null);
	const syncMeta = ref<SyncMeta>(defaultSyncMeta());
	const checksumCache = ref<Map<string, string>>(new Map());
	/** When true, background syncs are skipped to avoid overwriting in-progress edits. */
	const editing = ref(false);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	function getUsername(): string {
		const appStore = useAppStore();
		return appStore.username || "unknown";
	}

	function getClient(): SyncClient {
		return new SyncClient(import.meta.env.VITE_API_BASE_URL ?? "/api/v1");
	}

	function idbKey(): string {
		return `list-${credentials.value!.syncId}`;
	}

	// ---------------------------------------------------------------------------
	// Getters
	// ---------------------------------------------------------------------------

	const nonDeletedItems = computed(() => {
		if (!blob.value) return [];
		return blob.value.items.filter((item) => !item.deleted.value);
	});

	/** Non-deleted items sorted by group name then by order. */
	const items = computed(() => {
		return [...nonDeletedItems.value].sort((a, b) => {
			const groupA = a.group.value ?? "";
			const groupB = b.group.value ?? "";
			if (groupA !== groupB) return groupA.localeCompare(groupB);
			return a.order.value - b.order.value;
		});
	});

	/** Items that are marked done and whose checksum still matches current content. */
	const doneItems = computed(() => {
		return items.value.filter((item) => {
			if (item.done.value === null) return false;
			const cached = checksumCache.value.get(item.id);
			return cached !== undefined && item.done.value === cached;
		});
	});

	/** Items that are marked done but whose content has since changed (checksum mismatch). */
	const staleItems = computed(() => {
		return items.value.filter((item) => {
			if (item.done.value === null) return false;
			const cached = checksumCache.value.get(item.id);
			return cached !== undefined && item.done.value !== cached;
		});
	});

	/** Items that are not marked done. */
	const activeItems = computed(() => {
		return items.value.filter((item) => item.done.value === null);
	});

	/** Unique group names from non-deleted items. */
	const groups = computed(() => {
		const names = new Set<string>();
		for (const item of nonDeletedItems.value) {
			if (item.group.value !== null) {
				names.add(item.group.value);
			}
		}
		return [...names].sort();
	});

	// ---------------------------------------------------------------------------
	// Checksum management
	// ---------------------------------------------------------------------------

	async function updateChecksums(): Promise<void> {
		if (!blob.value) {
			checksumCache.value = new Map();
			return;
		}

		const newCache = new Map<string, string>();
		const promises = blob.value.items
			.filter((item) => !item.deleted.value)
			.map(async (item) => {
				const cs = await contentChecksum(
					item.text.value,
					item.quantity.value,
					item.unit.value,
				);
				newCache.set(item.id, cs);
			});

		await Promise.all(promises);
		checksumCache.value = newCache;
	}

	// ---------------------------------------------------------------------------
	// IndexedDB persistence
	// ---------------------------------------------------------------------------

	async function saveToIndexedDB(): Promise<void> {
		if (!blob.value || !credentials.value) return;
		await idbSet(idbKey(), JSON.stringify(blob.value));
	}

	function updateAppMetadata(): void {
		if (!credentials.value || !blob.value) return;
		const appStore = useAppStore();

		const activeCount = activeItems.value.length;
		const totalCount = nonDeletedItems.value.length;

		let lastModifiedAt = 0;
		for (const item of nonDeletedItems.value) {
			for (const field of TRACKED_FIELDS) {
				const fieldData = (item as any)[field];
				if (fieldData && typeof fieldData.timestamp === "number") {
					if (fieldData.timestamp > lastModifiedAt) {
						lastModifiedAt = fieldData.timestamp;
					}
				}
			}
		}

		appStore.updateListMetadata(
			credentials.value.syncId,
			activeCount,
			totalCount,
			lastModifiedAt || credentials.value.createdAt,
		);
	}

	async function loadFromIndexedDB(): Promise<void> {
		if (!credentials.value) return;

		const raw = await idbGet(idbKey());
		if (raw) {
			try {
				blob.value = ListBlobSchema.parse(JSON.parse(raw));
				updateAppMetadata();
			} catch {
				blob.value = null;
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Merge
	// ---------------------------------------------------------------------------

	function mergeItems(local: ListItem[], remote: ListItem[]): ListItem[] {
		const localMap = new Map<string, ListItem>(
			local.map((item) => [item.id, item]),
		);
		const remoteMap = new Map<string, ListItem>(
			remote.map((item) => [item.id, item]),
		);

		const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

		const merged: ListItem[] = [];

		for (const id of allIds) {
			const localItem = localMap.get(id);
			const remoteItem = remoteMap.get(id);

			if (localItem && !remoteItem) {
				merged.push(localItem);
			} else if (!localItem && remoteItem) {
				merged.push(remoteItem);
			} else if (localItem && remoteItem) {
				// Per-field last-writer-wins merge.
				// Clone local as the base, then overlay winning fields.
				const mergedItem: ListItem = {
					id: localItem.id,
					text: { ...localItem.text },
					quantity: { ...localItem.quantity },
					unit: { ...localItem.unit },
					group: { ...localItem.group },
					order: { ...localItem.order },
					done: { ...localItem.done },
					deleted: { ...localItem.deleted },
				};

				for (const field of TRACKED_FIELDS) {
					const localField = localItem[field];
					const remoteField = remoteItem[field];
					// Later timestamp wins. Equal timestamps → prefer remote.
					if (remoteField.timestamp >= localField.timestamp) {
						// Use type assertion since TS can't narrow the union across
						// all tracked field types in a generic loop.
						(mergedItem[field] as typeof remoteField) = {
							...remoteField,
						};
					}
				}

				merged.push(mergedItem);
			}
		}

		return merged;
	}

	// ---------------------------------------------------------------------------
	// Sync timing – 5 s debounced push after mutations, configurable poll while open
	// ---------------------------------------------------------------------------

	const DEBOUNCE_MS = 5_000;

	function getPollMs(): number {
		const appStore = useAppStore();
		const seconds = appStore.settings?.syncIntervalSeconds ?? 30;
		return Math.max(5, seconds) * 1000;
	}

	/** Schedule a sync 5 s after the last mutation.  Resets on each call. */
	function scheduleDebouncedSync(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			sync()
				.then(() => resetPollTimer())
				.catch(() => {
					/* errors captured in syncMeta */
				});
		}, DEBOUNCE_MS);
	}

	function startPollTimer(): void {
		stopPollTimer();
		pollTimer = setInterval(() => {
			sync().catch(() => {
				/* errors captured in syncMeta */
			});
		}, getPollMs());
	}

	function stopPollTimer(): void {
		if (pollTimer !== null) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	/** Restart the poll interval so the next tick is a full interval away. */
	function resetPollTimer(): void {
		if (pollTimer !== null) {
			startPollTimer();
		}
	}

	function stopAllTimers(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		stopPollTimer();
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function openList(creds: ListCredentials): Promise<void> {
		credentials.value = creds;

		await loadFromIndexedDB();
		if (!blob.value) {
			blob.value = { version: 1, items: [] };
		}

		await updateChecksums();

		// Trigger a background sync, then start the 30 s poll timer
		sync()
			.then(() => startPollTimer())
			.catch(() => {
				/* errors are captured in syncMeta */
				startPollTimer();
			});
	}

	async function closeList(): Promise<void> {
		stopAllTimers();
		await saveToIndexedDB();

		blob.value = null;
		credentials.value = null;
		checksumCache.value = new Map();
		syncMeta.value = defaultSyncMeta();
	}

	async function addItem(
		text: string,
		opts?: {
			quantity?: number;
			unit?: string;
			group?: string;
		},
	): Promise<string | undefined> {
		if (!blob.value) return;

		const un = getUsername();
		const now = Date.now();

		const groupItems = blob.value.items.filter(
			(i) => !i.deleted.value && (i.group.value ?? "") === (opts?.group ?? ""),
		);
		const maxOrder = groupItems.reduce(
			(max, i) => Math.max(max, i.order.value),
			-1,
		);

		const item: ListItem = {
			id: nanoid(),
			text: tracked(text, un, now),
			quantity: tracked(opts?.quantity ?? null, un, now),
			unit: tracked(opts?.unit ?? null, un, now),
			group: tracked(opts?.group ?? null, un, now),
			order: tracked(maxOrder + 1, un, now),
			done: tracked(null, un, now),
			deleted: tracked(false, un, now),
		};

		blob.value.items.push(item);
		syncMeta.value.dirty = true;
		await updateChecksums();
		await saveToIndexedDB();
		updateAppMetadata();
		scheduleDebouncedSync();

		return item.id;
	}

	async function updateItem(
		id: string,
		changes: Partial<{
			text: string;
			quantity: number | null;
			unit: string | null;
			group: string | null;
		}>,
	): Promise<void> {
		if (!blob.value) return;

		const item = blob.value.items.find((i) => i.id === id);
		if (!item) return;

		const un = getUsername();
		const now = Date.now();

		if ("text" in changes) {
			item.text = { value: changes.text!, timestamp: now, username: un };
		}
		if ("quantity" in changes) {
			item.quantity = {
				value: changes.quantity!,
				timestamp: now,
				username: un,
			};
		}
		if ("unit" in changes) {
			item.unit = { value: changes.unit!, timestamp: now, username: un };
		}
		if ("group" in changes) {
			item.group = {
				value: changes.group!,
				timestamp: now,
				username: un,
			};
		}

		syncMeta.value.dirty = true;
		await updateChecksums();
		await saveToIndexedDB();
		updateAppMetadata();
		scheduleDebouncedSync();
	}

	async function toggleDone(id: string): Promise<void> {
		if (!blob.value) return;

		const item = blob.value.items.find((i) => i.id === id);
		if (!item) return;

		const un = getUsername();
		const now = Date.now();

		if (item.done.value === null) {
			// Mark done — store the content checksum at check-off time
			const cs = await contentChecksum(
				item.text.value,
				item.quantity.value,
				item.unit.value,
			);
			item.done = { value: cs, timestamp: now, username: un };
		} else {
			// Unmark done
			item.done = { value: null, timestamp: now, username: un };
		}

		syncMeta.value.dirty = true;
		await updateChecksums();
		await saveToIndexedDB();
		updateAppMetadata();
		scheduleDebouncedSync();
	}

	async function reorderItem(
		id: string,
		targetGroup: string | null,
		targetIndex: number,
	): Promise<void> {
		if (!blob.value) return;

		const item = blob.value.items.find((i) => i.id === id);
		if (!item) return;

		const un = getUsername();
		const now = Date.now();

		const sourceGroup = item.group.value;

		// Update group if changing groups
		if (targetGroup !== sourceGroup) {
			item.group = { value: targetGroup, timestamp: now, username: un };
		}

		// Get all non-deleted items in the target group, sorted by current order,
		// excluding the item being moved
		const groupItems = blob.value.items
			.filter(
				(i) =>
					!i.deleted.value &&
					(i.group.value ?? "") === (targetGroup ?? "") &&
					i.id !== id,
			)
			.sort((a, b) => a.order.value - b.order.value);

		// Insert at the target index
		groupItems.splice(targetIndex, 0, item);

		// Renumber the entire target group sequentially
		for (let i = 0; i < groupItems.length; i++) {
			if (groupItems[i].order.value !== i) {
				groupItems[i].order = { value: i, timestamp: now, username: un };
			}
		}

		// If the item moved between groups, also renumber the source group
		if (targetGroup !== sourceGroup) {
			const sourceItems = blob.value.items
				.filter(
					(i) =>
						!i.deleted.value &&
						(i.group.value ?? "") === (sourceGroup ?? "") &&
						i.id !== id,
				)
				.sort((a, b) => a.order.value - b.order.value);

			for (let i = 0; i < sourceItems.length; i++) {
				if (sourceItems[i].order.value !== i) {
					sourceItems[i].order = { value: i, timestamp: now, username: un };
				}
			}
		}

		syncMeta.value.dirty = true;
		await updateChecksums();
		await saveToIndexedDB();
		updateAppMetadata();
		scheduleDebouncedSync();
	}

	async function toggleDelete(id: string): Promise<void> {
		if (!blob.value) return;

		const item = blob.value.items.find((i) => i.id === id);
		if (!item) return;

		const un = getUsername();
		const now = Date.now();

		item.deleted = {
			value: !item.deleted.value,
			timestamp: now,
			username: un,
		};

		syncMeta.value.dirty = true;
		await updateChecksums();
		await saveToIndexedDB();
		updateAppMetadata();
		scheduleDebouncedSync();
	}

	async function deleteDoneItems(): Promise<void> {
		if (!blob.value) return;

		const un = getUsername();
		const now = Date.now();
		let changed = false;

		for (const item of blob.value.items) {
			if (item.done.value !== null && !item.deleted.value) {
				item.deleted = {
					value: true,
					timestamp: now,
					username: un,
				};
				changed = true;
			}
		}

		if (changed) {
			syncMeta.value.dirty = true;
			await updateChecksums();
			await saveToIndexedDB();
			updateAppMetadata();
			scheduleDebouncedSync();
		}
	}

	async function sync(): Promise<void> {
		if (!credentials.value) return;
		if (editing.value) return;

		const client = getClient();
		if (!client) return;

		try {
			// --- Pull --------------------------------------------------------
			syncMeta.value.status = "pulling";
			syncMeta.value.error = null;

			const remote = await pullBlob(
				credentials.value.syncId,
				credentials.value.cryptKey,
				ListBlobSchema,
				client,
			);

			// Track whether the blob already exists on the backend so we can
			// skip the redundant GET inside pushBlob and handle registration
			// correctly (include registration_secret when the ID is new).
			const remoteExists = remote !== null;

			// Snapshot the remote items as JSON so we can compare after merge
			// to detect whether anything actually changed.
			const remoteJson = remote ? JSON.stringify(remote.data) : null;

			// --- Merge -------------------------------------------------------
			if (remote) {
				syncMeta.value.remoteTimestamp = remote.timestamp;

				if (blob.value && blob.value.items.length > 0) {
					syncMeta.value.status = "merging";
					const merged = mergeItems(blob.value.items, remote.data.items);
					blob.value = { version: 1, items: merged };
				} else {
					blob.value = remote.data;
				}
			}

			// Ensure we always have a valid blob
			if (!blob.value) {
				blob.value = { version: 1, items: [] };
			}

			// --- Push (only if something changed) ----------------------------
			// Compare the current blob against what the remote had.  If they
			// are identical there is nothing to upload — skip the POST to save
			// bandwidth, reduce rate-limit pressure, and avoid creating
			// redundant versions on the backend.
			const localJson = JSON.stringify(blob.value);
			const needsPush = !remoteExists || localJson !== remoteJson;

			if (needsPush) {
				syncMeta.value.status = "pushing";
				await pushBlob(
					credentials.value.syncId,
					credentials.value.cryptKey,
					credentials.value.secret,
					blob.value,
					client,
					remoteExists,
				);
			}

			// --- Done --------------------------------------------------------
			syncMeta.value.status = "idle";
			syncMeta.value.lastSyncedAt = Date.now();
			syncMeta.value.dirty = false;

			await updateChecksums();
			await saveToIndexedDB();
			updateAppMetadata();
		} catch (e) {
			syncMeta.value.status = "error";
			syncMeta.value.error = e instanceof Error ? e.message : String(e);
		}
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	return {
		// State
		blob,
		credentials,
		syncMeta,
		checksumCache,
		editing,

		// Getters
		items,
		doneItems,
		staleItems,
		activeItems,
		groups,

		// Actions
		openList,
		closeList,
		addItem,
		updateItem,
		toggleDone,
		toggleDelete,
		deleteDoneItems,
		reorderItem,
		mergeItems,
		sync,
		updateChecksums,
		saveToIndexedDB,
		loadFromIndexedDB,
	};
});
