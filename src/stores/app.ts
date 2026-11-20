import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import {
	AppStateSchema,
	mergeAppStates,
	sameAppState,
	type AppState,
	type ListCredentials,
	decodeShareString,
	encodeAppCredentials,
	decodeAppCredentials,
} from "@/models/app-state";
import { ListBlobSchema, type ListBlob } from "@/models/list";
import {
	SyncClient,
	SyncHub,
	pullBlob,
	pushBlob,
	decrypt,
	generateSyncId,
	generateCryptKey,
	generateSecret,
	isRetryableSyncError,
	SyncHttpError,
} from "@/lib/sync-client";
import { useLocalMemoryStore } from "./local-memory";
import { idbDelete, listBlobKey } from "@/lib/idb";

const APP_STATE_KEY = "lists-app-state";
const APP_CREDENTIALS_KEY = "lists-app-credentials";
/** Persisted so changes made offline are still pushed after a restart. */
const APP_DIRTY_KEY = "lists-app-dirty";

const API_BASE_URL: string =
	import.meta.env.VITE_API_BASE_URL ?? "https://blob.foonly.dev";

let hub: SyncHub | null = null;

export function getHub(): SyncHub {
	if (!hub) {
		hub = new SyncHub(API_BASE_URL);
	}
	return hub;
}

export interface AppCredentials {
	syncId: string;
	cryptKey: string;
	secret: string;
}

export const useAppStore = defineStore("app", () => {
	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	const state = ref<AppState | null>(null);
	const credentials = ref<AppCredentials | null>(null);
	const initialized = ref(false);
	/** Tracks whether local state has changed since the last successful push. */
	const dirty = ref(false);

	watch(dirty, (isDirty) => {
		try {
			if (isDirty) localStorage.setItem(APP_DIRTY_KEY, "1");
			else localStorage.removeItem(APP_DIRTY_KEY);
		} catch {
			// Best effort: the merge on the next pull still recovers changes.
		}
	});

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_MS = 2_000;
	/** A push is in flight; another one must wait for it. */
	let syncing = false;
	/** A push was requested while one was in flight. */
	let pendingSync = false;

	// ---------------------------------------------------------------------------
	// Getters
	// ---------------------------------------------------------------------------

	// Both are needed: credentials without state can't show or create lists.
	const isSetUp = computed(
		() => credentials.value !== null && state.value !== null,
	);

	const username = computed(() => state.value?.username ?? "");

	const lists = computed(() => {
		if (!state.value) return [];
		return [...state.value.lists].sort((a, b) => a.order - b.order);
	});

	const settings = computed(() => state.value?.settings ?? null);

	/** The app credentials as a single pipe-delimited string for display/copy. */
	const credentialString = computed(() => {
		if (!credentials.value) return "";
		return encodeAppCredentials(credentials.value);
	});

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	function getClient(): SyncClient {
		return new SyncClient(API_BASE_URL);
	}

	/**
	 * Merge a state received from the backend into the local one. If the
	 * result holds anything the backend doesn't have yet (local changes, or
	 * entries another device dropped), mark dirty and push it back.
	 */
	function applyRemoteState(remote: AppState): void {
		const merged = state.value ? mergeAppStates(state.value, remote) : remote;
		state.value = merged;
		saveToLocalStorage();
		if (sameAppState(merged, remote)) {
			// Everything local is on the backend already, unless a push of
			// newer changes is still in flight or queued.
			if (!syncing && !debounceTimer) dirty.value = false;
		} else {
			dirty.value = true;
			scheduleDebouncedSync();
		}
	}

	/** Record a local change: persist it and schedule a push. */
	function commitLocalChange(): void {
		dirty.value = true;
		saveToLocalStorage();
		scheduleDebouncedSync();
	}

	function scheduleDebouncedSync() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			syncToBackend().catch((e) => {
				console.warn("App state sync failed:", e);
			});
		}, DEBOUNCE_MS);
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function init(): Promise<void> {
		if (initialized.value) return;

		// Load app-blob credentials
		const credsRaw = localStorage.getItem(APP_CREDENTIALS_KEY);
		if (credsRaw) {
			try {
				credentials.value = JSON.parse(credsRaw) as AppCredentials;
			} catch {
				credentials.value = null;
			}
		}

		// Load app state
		dirty.value = localStorage.getItem(APP_DIRTY_KEY) !== null;

		const stateRaw = localStorage.getItem(APP_STATE_KEY);
		if (stateRaw) {
			try {
				state.value = AppStateSchema.parse(JSON.parse(stateRaw));
			} catch {
				state.value = null;
			}
		}

		initialized.value = true;

		if (typeof window !== "undefined") {
			window.addEventListener("online", () => {
				// Trigger a sync when back online
				if (dirty.value) {
					scheduleDebouncedSync();
				}
			});
		}

		if (!credentials.value) return;

		if (state.value) {
			// The local copy is enough to render: sync in the background so the
			// first screen never waits on the network.
			startBackgroundSync();
		} else {
			// Credentials but no usable local state (e.g. storage was cleared or
			// corrupted): there is nothing to show yet, so wait for the backend.
			await startBackgroundSync();
		}
	}

	/**
	 * Pull the latest app state, then subscribe to real-time updates. The pull
	 * finishes first so its request timestamp is consumed by the server before
	 * the WebSocket subscription uses the next one.
	 */
	async function startBackgroundSync(): Promise<void> {
		const creds = credentials.value;
		if (!creds) return;

		await pullFromBackend().catch((e) => {
			console.warn("Background pull on init failed:", e);
		});
		// Push changes left over from an earlier session, e.g. made offline.
		if (dirty.value) scheduleDebouncedSync();

		// Credentials replaced meanwhile, or still no state (the user will be
		// sent to setup): don't subscribe with credentials that may be dropped.
		if (credentials.value !== creds || !state.value) return;
		getHub().subscribe(creds.syncId, creds.secret, async (response) => {
			await handleRemoteUpdate(response);
		});
	}

	async function handleRemoteUpdate(remote: {
		data: string;
		timestamp: number;
	}): Promise<void> {
		if (!credentials.value) return;

		try {
			const decrypted = await decrypt(remote.data, credentials.value.cryptKey);
			const parsed = JSON.parse(decrypted);
			applyRemoteState(AppStateSchema.parse(parsed));
		} catch (e) {
			console.warn("App state remote update failed:", e);
		}
	}

	/**
	 * First-time setup.
	 */
	async function setup(newUsername: string): Promise<void> {
		const syncId = generateSyncId();
		const cryptKey = await generateCryptKey();
		const secret = generateSecret();

		credentials.value = { syncId, cryptKey, secret };

		state.value = {
			version: 1,
			username: newUsername,
			lists: [],
			settings: {
				syncIntervalSeconds: 30,
				theme: "auto",
			},
			settingsUpdatedAt: Date.now(),
			removedLists: {},
		};

		saveToLocalStorage();
		dirty.value = true;

		getHub().subscribe(syncId, secret, async (response) => {
			await handleRemoteUpdate(response);
		});

		scheduleDebouncedSync();
	}

	/**
	 * Restore from an existing set of app-blob credentials.
	 */
	async function restore(credentialStr: string): Promise<void> {
		const parsed = decodeAppCredentials(credentialStr);
		if (!parsed) {
			throw new Error(
				"Invalid credential format. Expected: syncId|cryptKey|secret",
			);
		}

		// Fetch and decrypt before storing anything, so failed attempts leave
		// the app exactly as it was.
		let result: Awaited<ReturnType<typeof pullBlob<AppState>>>;
		try {
			result = await pullBlob(
				parsed.syncId,
				parsed.secret,
				parsed.cryptKey,
				AppStateSchema,
				getClient(),
			);
		} catch (e) {
			throw new Error(describeRestoreError(e), { cause: e });
		}
		if (!result) {
			throw new Error("No app state found on backend for these credentials");
		}

		credentials.value = parsed;
		state.value = result.data;
		dirty.value = false;
		saveToLocalStorage();

		getHub().subscribe(parsed.syncId, parsed.secret, async (response) => {
			await handleRemoteUpdate(response);
		});
	}

	function describeRestoreError(e: unknown): string {
		if (e instanceof TypeError) {
			// fetch() rejects with TypeError when the server can't be reached.
			return "Couldn't reach the sync server. Check your connection and try again.";
		}
		if (e instanceof DOMException && e.name === "OperationError") {
			// AES-GCM decryption failed: the key doesn't match this data.
			return "These credentials don't match the stored data. Check the key.";
		}
		if (e instanceof DOMException) {
			// Key isn't valid base64 or has the wrong length.
			return "These credentials look malformed. Copy them again and retry.";
		}
		if (e instanceof SyncHttpError && e.status === 401) {
			return "The sync server rejected these credentials. Check the secret.";
		}
		return e instanceof Error ? e.message : "Restore failed.";
	}

	async function createList(name: string): Promise<ListCredentials> {
		if (!state.value) throw new Error("App not initialized");

		const syncId = generateSyncId();
		const cryptKey = await generateCryptKey();
		const secret = generateSecret();

		const now = Date.now();
		const creds: ListCredentials = {
			name,
			syncId,
			cryptKey,
			secret,
			lastAccessedAt: now,
			createdAt: now,
			order: state.value.lists.length,
			activeItemCount: 0,
			totalItemCount: 0,
			updatedAt: now,
		};

		state.value.lists.push(creds);
		dirty.value = true;

		// Push an empty ListBlob to the backend to register it.
		// pushBlob auto-detects that the sync ID is new (GET returns 404)
		// and includes the registration_secret in the POST.
		const client = getClient();
		const emptyBlob: ListBlob = { version: 1, items: [] };
		await pushBlob(syncId, cryptKey, secret, emptyBlob, client);

		saveToLocalStorage();

		scheduleDebouncedSync();

		return creds;
	}

	function importList(shareString: string): ListCredentials | null {
		if (!state.value) return null;

		const parsed = decodeShareString(shareString);
		if (!parsed) return null;

		// Guard against importing a list that already exists
		if (state.value.lists.some((l) => l.syncId === parsed.syncId)) {
			return state.value.lists.find((l) => l.syncId === parsed.syncId)!;
		}

		const now = Date.now();
		const creds: ListCredentials = {
			name: parsed.name,
			syncId: parsed.syncId,
			cryptKey: parsed.cryptKey,
			secret: parsed.secret,
			lastAccessedAt: now,
			createdAt: now,
			order: state.value.lists.length,
			activeItemCount: 0,
			totalItemCount: 0,
			updatedAt: now,
		};

		state.value.lists.push(creds);
		// Re-importing a removed list revives it.
		delete state.value.removedLists[parsed.syncId];
		commitLocalChange();

		return creds;
	}

	function removeList(syncId: string): void {
		if (!state.value) return;
		state.value.lists = state.value.lists.filter((l) => l.syncId !== syncId);
		// Tombstone so other devices drop the list too instead of re-adding it.
		state.value.removedLists[syncId] = Date.now();
		useLocalMemoryStore().forgetList(syncId);
		// Drop this device's copy of the list's contents too.
		idbDelete(listBlobKey(syncId)).catch((e) => {
			console.warn("Failed to delete local list data:", e);
		});
		commitLocalChange();
	}

	function updateListName(syncId: string, name: string): void {
		if (!state.value) return;
		const list = state.value.lists.find((l) => l.syncId === syncId);
		if (list) {
			list.name = name;
			list.updatedAt = Date.now();
			commitLocalChange();
		}
	}

	function touchList(syncId: string): void {
		if (!state.value) return;
		const list = state.value.lists.find((l) => l.syncId === syncId);
		if (list) {
			list.lastAccessedAt = Date.now();
			commitLocalChange();
		}
	}

	function updateListMetadata(
		syncId: string,
		activeCount: number,
		totalCount: number,
		lastModifiedAt: number,
	): void {
		if (!state.value) return;
		const list = state.value.lists.find((l) => l.syncId === syncId);
		if (!list) return;
		if (
			list.activeItemCount === activeCount &&
			list.totalItemCount === totalCount &&
			list.lastModifiedAt === lastModifiedAt
		) {
			return; // Nothing changed: don't push the app state again.
		}
		list.activeItemCount = activeCount;
		list.totalItemCount = totalCount;
		list.lastModifiedAt = lastModifiedAt;
		commitLocalChange();
	}

	function updateSettings(changes: {
		username?: string;
		theme?: AppState["settings"]["theme"];
	}): void {
		if (!state.value) return;
		if (changes.username) state.value.username = changes.username;
		if (changes.theme) state.value.settings.theme = changes.theme;
		state.value.settingsUpdatedAt = Date.now();
		commitLocalChange();
	}

	function saveToLocalStorage(): void {
		if (state.value) {
			localStorage.setItem(APP_STATE_KEY, JSON.stringify(state.value));
		}
		if (credentials.value) {
			localStorage.setItem(
				APP_CREDENTIALS_KEY,
				JSON.stringify(credentials.value),
			);
		}
	}

	/**
	 * Push the app state blob to the backend — but only when the local state
	 * has actually changed since the last successful push (dirty flag).  This
	 * avoids redundant POST requests that would waste bandwidth, consume
	 * rate-limit budget, and create identical versions on the backend.
	 */
	async function syncToBackend(
		retryCount = 0,
		knownExists?: boolean,
	): Promise<void> {
		if (!state.value || !credentials.value) return;
		if (!dirty.value) return;

		// One push at a time; a request made meanwhile runs afterwards.
		if (syncing) {
			pendingSync = true;
			return;
		}

		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (retryTimer && retryCount === 0) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}

		syncing = true;
		const creds = credentials.value;
		// Push a snapshot, so changes made during the request are detected
		// afterwards instead of being marked as pushed.
		const pushed: AppState = JSON.parse(JSON.stringify(state.value));
		const client = getClient();
		try {
			await pushBlob(
				creds.syncId,
				creds.cryptKey,
				creds.secret,
				pushed,
				client,
				knownExists,
			);
			if (state.value && sameAppState(state.value, pushed)) {
				dirty.value = false;
			} else {
				pendingSync = true;
			}
		} catch (e) {
			console.warn("App state sync failed:", e);
			// Retry with exponential backoff if online
			if (navigator.onLine && retryCount < 5 && isRetryableSyncError(e)) {
				const delay = Math.pow(2, retryCount) * 1000;
				retryTimer = setTimeout(() => {
					retryTimer = null;
					syncToBackend(retryCount + 1);
				}, delay);
			}
		} finally {
			syncing = false;
			if (pendingSync) {
				pendingSync = false;
				scheduleDebouncedSync();
			}
		}
	}

	async function pullFromBackend(): Promise<void> {
		if (!credentials.value) return;

		const client = getClient();
		const result = await pullBlob(
			credentials.value.syncId,
			credentials.value.secret,
			credentials.value.cryptKey,
			AppStateSchema,
			client,
		);

		if (result) {
			applyRemoteState(result.data);
		} else if (state.value) {
			// Backend no longer has this record (cleaned up).  Re-register by
			// marking dirty and pushing the local state back.
			dirty.value = true;
			await syncToBackend(0, false);
		}
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	return {
		// State
		state,
		credentials,
		initialized,
		dirty,

		// Getters
		isSetUp,
		username,
		lists,
		settings,
		credentialString,

		// Actions
		init,
		setup,
		restore,
		createList,
		importList,
		removeList,
		updateListName,
		touchList,
		updateListMetadata,
		updateSettings,
		saveToLocalStorage,
		syncToBackend,
		pullFromBackend,
	};
});
