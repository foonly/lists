import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { nanoid } from "nanoid";
import { ListBlobSchema, tracked, TRACKED_FIELDS } from "@/models/list";
import type { ListBlob, ListItem, TrackedFieldName } from "@/models/list";
import type { ListCredentials } from "@/models/app-state";
import {
	SyncClient,
	pullBlob,
	pushBlob,
	decrypt,
	contentChecksum,
	type ConnectionStatus,
} from "@/lib/sync-client";
import { useAppStore, getHub } from "./app";
import { useLocalMemoryStore } from "./local-memory";
import { stableStringify } from "@/lib/stable-json";

// ---------------------------------------------------------------------------
// SyncMeta type
// ---------------------------------------------------------------------------

export interface SyncMeta {
	status: "idle" | "pulling" | "pushing" | "merging" | "error";
	lastSyncedAt: number | null;
	remoteTimestamp: number;
	dirty: boolean;
	error: string | null;
	isOffline: boolean;
	hubStatus: ConnectionStatus;
}

function defaultSyncMeta(): SyncMeta {
	return {
		status: "idle",
		lastSyncedAt: null,
		remoteTimestamp: 0,
		dirty: false,
		error: null,
		isOffline: !navigator.onLine,
		// The hub connection is shared by all lists and outlives this metadata,
		// which is reset whenever a list is closed. Start from its real status:
		// the watcher below only fires when that status changes.
		hubStatus: getHub().status.value,
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

	// Update offline and hub status
	if (typeof window !== "undefined") {
		window.addEventListener("online", () => {
			syncMeta.value.isOffline = false;
			// Trigger a sync when back online
			if (syncMeta.value.dirty) {
				scheduleDebouncedSync();
			}
		});
		window.addEventListener("offline", () => {
			syncMeta.value.isOffline = true;
		});

		// Sync hub status
		const hub = getHub();
		watch(
			() => hub.status.value,
			(status) => {
				syncMeta.value.hubStatus = status;
			},
			{ immediate: true },
		);
	}
	/** Tracks whether we have confirmed the blob exists on the server (via WS or Pull) */
	const remoteExistsConfirmed = ref(false);
	/** The JSON string of the last known remote state to avoid redundant pushes */
	let lastKnownRemoteJson: string | null = null;
	/** When true, background syncs are skipped to avoid overwriting in-progress edits. */
	const editing = ref(false);

	/**
	 * Incremented whenever a list is opened or closed. Async work captures the
	 * value it started with and drops its result once it no longer matches, so
	 * a slow request for one list can never write into another.
	 */
	let session = 0;
	/** The session a sync is currently running for, if any. */
	let syncingSession: number | null = null;
	/** A sync was skipped (editing, or one already running) and must run later. */
	let pendingResync = false;
	let pendingForce = false;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	// Run a sync that was skipped while the item editor was open.
	watch(editing, (isEditing) => {
		if (!isEditing && pendingResync && credentials.value) {
			runPendingResync();
		}
	});

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	function getUsername(): string {
		const appStore = useAppStore();
		return appStore.username || "unknown";
	}

	function getClient(): SyncClient {
		return new SyncClient(
			import.meta.env.VITE_API_BASE_URL ?? "https://blob.foonly.dev",
		);
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

	/**
	 * Group names in use by non-deleted items, plus this device's sticky groups
	 * for the list (groups that stay visible after their items are gone).
	 */
	const groups = computed(() => {
		const names = new Set<string>();
		for (const item of nonDeletedItems.value) {
			if (item.group.value !== null) {
				names.add(item.group.value);
			}
		}
		if (credentials.value) {
			const memory = useLocalMemoryStore();
			for (const g of memory.getStickyGroups(credentials.value.syncId)) {
				names.add(g);
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

		const gen = session;
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
		if (gen !== session) return;
		checksumCache.value = newCache;
	}

	// ---------------------------------------------------------------------------
	// IndexedDB persistence
	// ---------------------------------------------------------------------------

	async function saveToIndexedDB(): Promise<void> {
		if (!blob.value || !credentials.value) return;
		rememberLocally();
		await idbSet(idbKey(), JSON.stringify(blob.value));
	}

	/** Feed the device-local autofill memory and sticky groups from this list. */
	function rememberLocally(): void {
		if (!credentials.value) return;
		const memory = useLocalMemoryStore();
		memory.rememberItems(credentials.value.syncId, nonDeletedItems.value);
		const used = new Set<string>();
		for (const item of nonDeletedItems.value) {
			if (item.group.value !== null) used.add(item.group.value);
		}
		memory.addStickyGroups(credentials.value.syncId, [...used]);
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

		const gen = session;
		const raw = await idbGet(idbKey());
		if (gen !== session) return;
		if (raw) {
			try {
				blob.value = ListBlobSchema.parse(JSON.parse(raw));
				rememberLocally();
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

		// Follow the remote item order, then local-only items, so a device that
		// adopts a remote list reproduces it exactly and has nothing to push back.
		const allIds = new Set<string>([...remoteMap.keys(), ...localMap.keys()]);

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
					createdBy: localItem.createdBy,
					createdAt: localItem.createdAt,
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
					// Later timestamp wins. Equal timestamps are broken by content,
					// so every device picks the same value and they converge.
					const remoteWins =
						remoteField.timestamp !== localField.timestamp
							? remoteField.timestamp > localField.timestamp
							: stableStringify(remoteField) >= stableStringify(localField);
					if (remoteWins) {
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
	// Sync timing – 5 s debounced push after mutations
	// ---------------------------------------------------------------------------

	const DEBOUNCE_MS = 2_000;

	/** Schedule a sync 2 s after the last mutation.  Resets on each call. */
	function scheduleDebouncedSync(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			sync().catch(() => {
				/* errors captured in syncMeta */
			});
		}, DEBOUNCE_MS);
	}

	function stopAllTimers(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (retryTimer !== null) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	function runPendingResync(): void {
		const force = pendingForce;
		pendingResync = false;
		pendingForce = false;
		if (force) {
			sync(0, true).catch(() => {
				/* errors captured in syncMeta */
			});
		} else {
			scheduleDebouncedSync();
		}
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function openList(creds: ListCredentials): Promise<void> {
		const gen = ++session;
		credentials.value = creds;
		// Never show a previous list's data while this one loads.
		blob.value = null;

		await loadFromIndexedDB();
		if (gen !== session) return;
		if (!blob.value) {
			blob.value = { version: 1, items: [] };
		}

		await updateChecksums();
		if (gen !== session) return;

		// Trigger an initial background sync first so its timestamp is
		// consumed before we subscribe to real-time updates.
		await sync().catch(() => {
			/* errors are captured in syncMeta */
		});
		if (gen !== session) return;

		// Subscribe to real-time updates
		getHub().subscribe(creds.syncId, creds.secret, async (response) => {
			await handleRemoteUpdate(response, gen);
		});
	}

	async function handleRemoteUpdate(
		remote: {
			data: string;
			timestamp: number;
		},
		gen: number,
	): Promise<void> {
		if (!credentials.value || gen !== session) return;

		try {
			const decrypted = await decrypt(remote.data, credentials.value.cryptKey);
			if (gen !== session) return;
			const parsed = JSON.parse(decrypted);
			const remoteData = ListBlobSchema.parse(parsed);

			remoteExistsConfirmed.value = true;
			lastKnownRemoteJson = stableStringify(remoteData);
			syncMeta.value.remoteTimestamp = remote.timestamp;

			if (blob.value && blob.value.items.length > 0) {
				syncMeta.value.status = "merging";
				const merged = mergeItems(blob.value.items, remoteData.items);
				blob.value = { version: 1, items: merged };
			} else {
				blob.value = remoteData;
			}

			// If the merge kept anything the server doesn't have (local edits
			// or items the sender lacked), push the merged list back.
			const differsFromRemote =
				stableStringify(blob.value) !== lastKnownRemoteJson;
			syncMeta.value.status = "idle";
			syncMeta.value.error = null;
			syncMeta.value.lastSyncedAt = Date.now();
			syncMeta.value.dirty = differsFromRemote;

			await updateChecksums();
			if (gen !== session) return;
			await saveToIndexedDB();
			updateAppMetadata();
			if (differsFromRemote) scheduleDebouncedSync();
		} catch (e) {
			if (gen !== session) return;
			syncMeta.value.status = "error";
			syncMeta.value.error = e instanceof Error ? e.message : String(e);
		}
	}

	async function closeList(): Promise<void> {
		// Invalidate all in-flight work for this list before anything else.
		session++;
		if (credentials.value) {
			getHub().unsubscribe(credentials.value.syncId);
		}
		stopAllTimers();
		pendingResync = false;
		pendingForce = false;
		// The item editor may still have been open when the list was left.
		editing.value = false;

		// Snapshot what to persist, then clear state synchronously so nothing
		// can observe a half-closed list while the write is pending.
		let snapshot: { key: string; json: string } | null = null;
		if (blob.value && credentials.value) {
			rememberLocally();
			snapshot = { key: idbKey(), json: JSON.stringify(blob.value) };
		}

		blob.value = null;
		credentials.value = null;
		remoteExistsConfirmed.value = false;
		lastKnownRemoteJson = null;
		checksumCache.value = new Map();
		syncMeta.value = defaultSyncMeta();

		if (snapshot) {
			await idbSet(snapshot.key, snapshot.json);
		}
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
			createdBy: un,
			createdAt: now,
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

	async function sync(retryCount = 0, force = false): Promise<void> {
		// Capture the list this sync belongs to; every await below re-checks
		// `gen` so a sync can't touch a list that was opened after it started.
		const creds = credentials.value;
		if (!creds) return;
		const gen = session;

		// Don't sync over an open editor, and never run two syncs at once
		// (concurrent pushes would race). Remember to run once unblocked.
		if (editing.value || syncingSession === gen) {
			pendingResync = true;
			pendingForce ||= force;
			return;
		}

		if (debounceTimer && retryCount === 0) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		if (!navigator.onLine) {
			syncMeta.value.status = "idle";
			return;
		}

		const client = getClient();
		syncingSession = gen;

		try {
			// If we haven't confirmed existence yet, or we're forcing a refresh,
			// we MUST pull to see what's on the server.
			if (!remoteExistsConfirmed.value || force) {
				syncMeta.value.status = "pulling";
				const remote = await pullBlob(
					creds.syncId,
					creds.secret,
					creds.cryptKey,
					ListBlobSchema,
					client,
				);
				if (gen !== session) return;

				if (remote) {
					remoteExistsConfirmed.value = true;
					syncMeta.value.remoteTimestamp = remote.timestamp;
					lastKnownRemoteJson = stableStringify(remote.data);

					if (blob.value && blob.value.items.length > 0) {
						syncMeta.value.status = "merging";
						const merged = mergeItems(blob.value.items, remote.data.items);
						blob.value = { version: 1, items: merged };
					} else {
						blob.value = remote.data;
					}
				} else {
					remoteExistsConfirmed.value = false;
					lastKnownRemoteJson = null;
				}
			}

			// Ensure we always have a valid blob
			if (!blob.value) {
				blob.value = { version: 1, items: [] };
			}

			// --- Push (only if something changed) ----------------------------
			// Snapshot exactly what is sent: edits made while the request is
			// in flight must not be recorded as already on the server.
			const pushedJson = stableStringify(blob.value);

			if (pushedJson !== lastKnownRemoteJson) {
				syncMeta.value.status = "pushing";
				await pushBlob(
					creds.syncId,
					creds.cryptKey,
					creds.secret,
					JSON.parse(pushedJson) as ListBlob,
					client,
					remoteExistsConfirmed.value,
				);
				if (gen !== session) return;
				remoteExistsConfirmed.value = true;
				lastKnownRemoteJson = pushedJson;
			}

			// --- Done --------------------------------------------------------
			const stillDirty = stableStringify(blob.value) !== lastKnownRemoteJson;
			syncMeta.value.status = "idle";
			syncMeta.value.error = null;
			syncMeta.value.lastSyncedAt = Date.now();
			syncMeta.value.dirty = stillDirty;

			await updateChecksums();
			if (gen !== session) return;
			await saveToIndexedDB();
			updateAppMetadata();

			// Changes arrived during the push: send them too.
			if (stillDirty) scheduleDebouncedSync();
		} catch (e) {
			if (gen !== session) return;
			syncMeta.value.status = "error";
			syncMeta.value.error = e instanceof Error ? e.message : String(e);

			// Exponential backoff retry
			if (retryCount < 5) {
				const delay = Math.pow(2, retryCount) * 1000;
				retryTimer = setTimeout(() => {
					retryTimer = null;
					if (gen === session) {
						sync(retryCount + 1).catch(() => {
							/* errors captured in syncMeta */
						});
					}
				}, delay);
			}
		} finally {
			if (syncingSession === gen) syncingSession = null;
			if (gen === session && pendingResync && !editing.value) {
				runPendingResync();
			}
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
