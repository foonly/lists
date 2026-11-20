import { defineStore } from "pinia";
import { ref } from "vue";
import type { ListItem } from "@/models/list";

// Device-local memory that never syncs, kept per list: item texts for
// autofill, and the groups a list has had so they stay visible once empty.

const AUTOFILL_KEY = "lists-autofill";
const STICKY_GROUPS_KEY = "lists-sticky-groups";

/** Entries not seen on any list for this long are forgotten. */
const AUTOFILL_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_SUGGESTIONS = 6;

export interface AutofillEntry {
	text: string;
	group: string | null;
	/** Last time an item with this text and group was on a list. */
	lastSeenAt: number;
}

export interface Suggestion {
	text: string;
	/** The group the text was last seen in; shown as a hint when it differs. */
	group: string | null;
}

function entryKey(text: string, group: string | null): string {
	return `${group ?? ""}\u0000${text.toLowerCase()}`;
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full or unavailable: autofill and sticky groups are best-effort.
	}
}

export const useLocalMemoryStore = defineStore("local-memory", () => {
	// ---------------------------------------------------------------------------
	// Autofill
	// ---------------------------------------------------------------------------

	/** Per list (keyed by syncId): entry key → entry. */
	const autofill = ref<Record<string, Map<string, AutofillEntry>>>(
		loadAutofill(),
	);

	function loadAutofill(): Record<string, Map<string, AutofillEntry>> {
		const cutoff = Date.now() - AUTOFILL_TTL_MS;
		const stored = readJson<Record<string, AutofillEntry[]>>(AUTOFILL_KEY, {});
		const result: Record<string, Map<string, AutofillEntry>> = {};
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
			return result;
		}
		for (const [syncId, entries] of Object.entries(stored)) {
			if (!Array.isArray(entries)) continue;
			const map = new Map<string, AutofillEntry>();
			for (const e of entries) {
				if (
					typeof e?.text !== "string" ||
					typeof e.lastSeenAt !== "number" ||
					e.lastSeenAt < cutoff
				) {
					continue;
				}
				map.set(entryKey(e.text, e.group ?? null), {
					text: e.text,
					group: e.group ?? null,
					lastSeenAt: e.lastSeenAt,
				});
			}
			if (map.size > 0) result[syncId] = map;
		}
		return result;
	}

	function saveAutofill(): void {
		const out: Record<string, AutofillEntry[]> = {};
		for (const [syncId, map] of Object.entries(autofill.value)) {
			out[syncId] = [...map.values()];
		}
		writeJson(AUTOFILL_KEY, out);
	}

	/**
	 * Remember every item currently on the list and refresh when it was last
	 * seen. Called whenever an open list is saved, so items keep living while
	 * they remain on the list and expire 45 days after they leave it.
	 */
	function rememberItems(syncId: string, items: ListItem[]): void {
		const now = Date.now();
		let changed = false;
		const map = (autofill.value[syncId] ??= new Map());
		for (const item of items) {
			if (item.deleted.value) continue;
			const text = item.text.value.trim();
			if (!text) continue;
			const group = item.group.value;
			const key = entryKey(text, group);
			const existing = map.get(key);
			// Avoid rewriting storage on every save; a day's resolution is plenty
			// for a 45-day expiry. Text casing follows the latest edit.
			if (
				existing &&
				existing.text === text &&
				now - existing.lastSeenAt < 24 * 60 * 60 * 1000
			) {
				continue;
			}
			map.set(key, { text, group, lastSeenAt: now });
			changed = true;
		}
		if (changed) saveAutofill();
	}

	/**
	 * Suggestions for what is being typed. Within a group only that group's
	 * items are offered; ungrouped entry offers items from every group.
	 */
	function suggest(
		syncId: string,
		query: string,
		group: string | null,
		exclude: Iterable<string> = [],
	): Suggestion[] {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const excluded = new Set([...exclude].map((t) => t.trim().toLowerCase()));
		const cutoff = Date.now() - AUTOFILL_TTL_MS;

		// One suggestion per text: when ungrouped, the same text may exist in
		// several groups, so keep the most recently seen one.
		const byText = new Map<string, AutofillEntry & { prefix: boolean }>();
		const map = autofill.value[syncId];
		if (!map) return [];
		for (const entry of map.values()) {
			if (entry.lastSeenAt < cutoff) continue;
			if (group !== null && entry.group !== group) continue;
			const lower = entry.text.toLowerCase();
			if (lower === q || excluded.has(lower)) continue;
			const idx = lower.indexOf(q);
			if (idx === -1) continue;
			const prev = byText.get(lower);
			if (prev && prev.lastSeenAt >= entry.lastSeenAt) continue;
			byText.set(lower, { ...entry, prefix: idx === 0 });
		}

		return [...byText.values()]
			.sort((a, b) => {
				if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
				return b.lastSeenAt - a.lastSeenAt;
			})
			.slice(0, MAX_SUGGESTIONS)
			.map(({ text, group }) => ({ text, group }));
	}

	// ---------------------------------------------------------------------------
	// Sticky groups (per list, keyed by syncId)
	// ---------------------------------------------------------------------------

	const stickyGroups = ref<Record<string, string[]>>(
		readJson<Record<string, string[]>>(STICKY_GROUPS_KEY, {}),
	);

	function getStickyGroups(syncId: string): string[] {
		return stickyGroups.value[syncId] ?? [];
	}

	function addStickyGroups(syncId: string, groups: string[]): void {
		const current = getStickyGroups(syncId);
		const missing = groups.filter((g) => g && !current.includes(g));
		if (missing.length === 0) return;
		stickyGroups.value[syncId] = [...current, ...missing];
		writeJson(STICKY_GROUPS_KEY, stickyGroups.value);
	}

	function removeStickyGroup(syncId: string, group: string): void {
		const current = getStickyGroups(syncId);
		if (!current.includes(group)) return;
		const next = current.filter((g) => g !== group);
		if (next.length > 0) {
			stickyGroups.value[syncId] = next;
		} else {
			delete stickyGroups.value[syncId];
		}
		writeJson(STICKY_GROUPS_KEY, stickyGroups.value);
	}

	/** Drop everything remembered for a list that was removed. */
	function forgetList(syncId: string): void {
		if (syncId in autofill.value) {
			delete autofill.value[syncId];
			saveAutofill();
		}
		if (syncId in stickyGroups.value) {
			delete stickyGroups.value[syncId];
			writeJson(STICKY_GROUPS_KEY, stickyGroups.value);
		}
	}

	return {
		rememberItems,
		suggest,
		getStickyGroups,
		addStickyGroups,
		removeStickyGroup,
		forgetList,
	};
});
