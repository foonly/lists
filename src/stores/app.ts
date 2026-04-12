import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
	AppStateSchema,
	type AppState,
	type ListCredentials,
	decodeShareString,
	encodeAppCredentials,
	decodeAppCredentials,
} from "@/models/app-state";
import { ListBlobSchema, type ListBlob } from "@/models/list";
import {
	SyncClient,
	pullBlob,
	pushBlob,
	generateSyncId,
	generateCryptKey,
	generateSecret,
} from "@/lib/sync-client";

const APP_STATE_KEY = "lists-app-state";
const APP_CREDENTIALS_KEY = "lists-app-credentials";

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

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

	// ---------------------------------------------------------------------------
	// Getters
	// ---------------------------------------------------------------------------

	const isSetUp = computed(() => credentials.value !== null);

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
		const stateRaw = localStorage.getItem(APP_STATE_KEY);
		if (stateRaw) {
			try {
				state.value = AppStateSchema.parse(JSON.parse(stateRaw));
			} catch {
				state.value = null;
			}
		}

		initialized.value = true;

		// Background pull — don't block init, don't throw to the caller
		if (credentials.value && state.value) {
			pullFromBackend().catch((e) => {
				console.warn("Background pull on init failed:", e);
			});
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
		};

		saveToLocalStorage();
		dirty.value = true;

		// Fire-and-forget sync to backend
		syncToBackend().catch((e) => {
			console.warn("App state sync failed:", e);
		});
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

		credentials.value = parsed;
		saveToLocalStorage();

		const client = getClient();
		const result = await pullBlob(
			parsed.syncId,
			parsed.cryptKey,
			AppStateSchema,
			client,
		);

		if (result) {
			state.value = result.data;
		} else {
			throw new Error("No app state found on backend for these credentials");
		}

		dirty.value = false;
		saveToLocalStorage();
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

		// Fire-and-forget sync to backend
		syncToBackend().catch((e) => {
			console.warn("App state sync failed:", e);
		});

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
		};

		state.value.lists.push(creds);
		dirty.value = true;
		saveToLocalStorage();

		// Fire-and-forget sync to backend
		syncToBackend().catch((e) => {
			console.warn("App state sync failed:", e);
		});

		return creds;
	}

	function removeList(syncId: string): void {
		if (!state.value) return;
		state.value.lists = state.value.lists.filter((l) => l.syncId !== syncId);
		dirty.value = true;
		saveToLocalStorage();

		// Fire-and-forget sync to backend
		syncToBackend().catch((e) => {
			console.warn("App state sync failed:", e);
		});
	}

	function updateListName(syncId: string, name: string): void {
		if (!state.value) return;
		const list = state.value.lists.find((l) => l.syncId === syncId);
		if (list) {
			list.name = name;
			dirty.value = true;
			saveToLocalStorage();

			// Fire-and-forget sync to backend
			syncToBackend().catch((e) => {
				console.warn("App state sync failed:", e);
			});
		}
	}

	function touchList(syncId: string): void {
		if (!state.value) return;
		const list = state.value.lists.find((l) => l.syncId === syncId);
		if (list) {
			list.lastAccessedAt = Date.now();
			dirty.value = true;
			saveToLocalStorage();
		}
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
	async function syncToBackend(): Promise<void> {
		if (!state.value || !credentials.value) return;
		if (!dirty.value) return;

		const client = getClient();
		await pushBlob(
			credentials.value.syncId,
			credentials.value.cryptKey,
			credentials.value.secret,
			state.value,
			client,
		);

		dirty.value = false;
	}

	async function pullFromBackend(): Promise<void> {
		if (!credentials.value) return;

		const client = getClient();
		const result = await pullBlob(
			credentials.value.syncId,
			credentials.value.cryptKey,
			AppStateSchema,
			client,
		);

		if (result) {
			// Simple replace — app state is single-user, no field-level merge needed
			state.value = result.data;
			dirty.value = false;
			saveToLocalStorage();
		} else if (state.value) {
			// Backend no longer has this record (cleaned up).  Re-register by
			// marking dirty and pushing the local state back.
			dirty.value = true;
			await syncToBackend();
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
		saveToLocalStorage,
		syncToBackend,
		pullFromBackend,
	};
});
