import { z } from "zod";
import { stableStringify } from "@/lib/stable-json";

export const ListCredentialsSchema = z.object({
	name: z.string(), // Local display name (not synced inside list blob)
	syncId: z.string(), // Backend blob ID
	cryptKey: z.string(), // Base64-encoded AES-GCM key for the list blob
	secret: z.string(), // HMAC signing secret for backend auth
	lastAccessedAt: z.number(), // Unix timestamp ms, for "recently accessed" sorting
	createdAt: z.number(), // Unix timestamp ms
	order: z.number(), // Manual sort order on the dashboard
	activeItemCount: z.number().default(0),
	totalItemCount: z.number().default(0),
	lastModifiedAt: z.number().optional(), // Unix timestamp ms of last item edit
	// Unix ms of the last change to name, order or credentials. Decides which
	// device's copy of the entry wins a merge. 0 for entries from before merging.
	updatedAt: z.number().default(0),
});

export const AppStateSchema = z.object({
	version: z.literal(1),
	username: z.string().min(1),
	lists: z.array(ListCredentialsSchema),
	settings: z.object({
		syncIntervalSeconds: z.number().default(30),
		theme: z.enum(["light", "dark", "auto"]).default("auto"),
	}),
	// Unix ms of the last change to username or settings.
	settingsUpdatedAt: z.number().default(0),
	// Tombstones: syncId → Unix ms the list was removed. An entry only
	// survives a merge if it was updated (e.g. re-imported) after removal.
	removedLists: z.record(z.string(), z.number()).default({}),
});

export type ListCredentials = z.infer<typeof ListCredentialsSchema>;
export type AppState = z.infer<typeof AppStateSchema>;

/** Tombstones older than this are dropped. */
const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Pick between two versions of something by timestamp. Ties are broken by
 * comparing canonical JSON, so every device picks the same winner.
 */
function pickNewer<T>(a: T, aTime: number, b: T, bTime: number): T {
	if (aTime !== bTime) return aTime > bTime ? a : b;
	return stableStringify(a) >= stableStringify(b) ? a : b;
}

function mergeListEntry(a: ListCredentials, b: ListCredentials): ListCredentials {
	// Name, order and credentials: last writer wins.
	const base = pickNewer(a, a.updatedAt, b, b.updatedAt);
	// Item counts describe the list contents as of lastModifiedAt, so take
	// them together from whichever copy saw the later edit.
	const counts = pickNewer(
		{
			activeItemCount: a.activeItemCount,
			totalItemCount: a.totalItemCount,
			lastModifiedAt: a.lastModifiedAt,
		},
		a.lastModifiedAt ?? 0,
		{
			activeItemCount: b.activeItemCount,
			totalItemCount: b.totalItemCount,
			lastModifiedAt: b.lastModifiedAt,
		},
		b.lastModifiedAt ?? 0,
	);
	const merged: ListCredentials = {
		...base,
		...counts,
		lastAccessedAt: Math.max(a.lastAccessedAt, b.lastAccessedAt),
	};
	if (merged.lastModifiedAt === undefined) delete merged.lastModifiedAt;
	return merged;
}

/**
 * Merge two copies of the app state (e.g. local and remote). The merge is
 * commutative and deterministic, so devices exchanging states converge:
 *   - lists are merged per entry (see mergeListEntry);
 *   - a removed list stays removed unless re-added after the removal;
 *   - username and settings go to whichever was changed last.
 */
export function mergeAppStates(a: AppState, b: AppState): AppState {
	const cutoff = Date.now() - TOMBSTONE_TTL_MS;

	const removedLists: Record<string, number> = {};
	for (const tombstones of [a.removedLists, b.removedLists]) {
		for (const [syncId, removedAt] of Object.entries(tombstones)) {
			if (removedAt < cutoff) continue;
			removedLists[syncId] = Math.max(removedLists[syncId] ?? 0, removedAt);
		}
	}

	const entries = new Map<string, ListCredentials>();
	for (const entry of [...a.lists, ...b.lists]) {
		const existing = entries.get(entry.syncId);
		entries.set(
			entry.syncId,
			existing ? mergeListEntry(existing, entry) : entry,
		);
	}

	const lists = [...entries.values()]
		.filter((l) => !(l.syncId in removedLists) || l.updatedAt > removedLists[l.syncId])
		.sort((x, y) => x.order - y.order || x.syncId.localeCompare(y.syncId));

	const profile = pickNewer(
		{ username: a.username, settings: a.settings },
		a.settingsUpdatedAt,
		{ username: b.username, settings: b.settings },
		b.settingsUpdatedAt,
	);

	return {
		version: 1,
		username: profile.username,
		settings: { ...profile.settings },
		settingsUpdatedAt: Math.max(a.settingsUpdatedAt, b.settingsUpdatedAt),
		lists,
		removedLists,
	};
}

/** True when two app states hold the same data, ignoring key and list order. */
export function sameAppState(a: AppState, b: AppState): boolean {
	const canonical = (s: AppState) =>
		stableStringify({
			...s,
			lists: [...s.lists].sort((x, y) => x.syncId.localeCompare(y.syncId)),
		});
	return canonical(a) === canonical(b);
}

// Credential share format: name|syncId|cryptKey|secret
// Uses pipe delimiter (not valid in base64, so parsing is unambiguous)
export function encodeShareString(creds: ListCredentials): string {
	return `${creds.name}|${creds.syncId}|${creds.cryptKey}|${creds.secret}`;
}

/** Encode app credentials as a single pipe-delimited string: syncId|cryptKey|secret */
export function encodeAppCredentials(creds: {
	syncId: string;
	cryptKey: string;
	secret: string;
}): string {
	return `${creds.syncId}|${creds.cryptKey}|${creds.secret}`;
}

/** Decode a pipe-delimited app credential string. Returns null if invalid. */
export function decodeAppCredentials(
	str: string,
): { syncId: string; cryptKey: string; secret: string } | null {
	const parts = str.trim().split("|");
	if (parts.length !== 3) return null;
	const [syncId, cryptKey, secret] = parts;
	if (!syncId || !cryptKey || !secret) return null;
	return { syncId, cryptKey, secret };
}

export function decodeShareString(
	shareString: string,
): { name: string; syncId: string; cryptKey: string; secret: string } | null {
	const parts = shareString.trim().split("|");
	if (parts.length < 4) return null;
	// Name might contain pipes (unlikely), so rejoin all but last 3
	const secret = parts.pop()!;
	const cryptKey = parts.pop()!;
	const syncId = parts.pop()!;
	const name = parts.join("|");
	if (!name || !syncId || !cryptKey || !secret) return null;
	return { name, syncId, cryptKey, secret };
}
