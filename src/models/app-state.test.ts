import { describe, expect, it } from "vitest";
import {
	AppStateSchema,
	decodeAppCredentials,
	decodeShareString,
	encodeAppCredentials,
	encodeShareString,
	isValidCredentials,
	mergeAppStates,
	sameAppState,
	type AppState,
	type ListCredentials,
} from "./app-state";
import {
	generateCryptKey,
	generateSecret,
	generateSyncId,
} from "@/lib/sync-client/crypto";

function entry(syncId: string, o: Partial<ListCredentials> = {}): ListCredentials {
	return {
		name: syncId,
		syncId,
		cryptKey: "k",
		secret: "s",
		lastAccessedAt: 1,
		createdAt: 1,
		order: 0,
		activeItemCount: 0,
		totalItemCount: 0,
		updatedAt: 1,
		...o,
	};
}

function state(lists: ListCredentials[], o: Partial<AppState> = {}): AppState {
	return AppStateSchema.parse({
		version: 1,
		username: "u",
		settings: {},
		lists,
		...o,
	});
}

describe("AppStateSchema", () => {
	it("reads blobs written before merge fields existed", () => {
		const { updatedAt: _, ...old } = entry("x");
		const parsed = AppStateSchema.parse({
			version: 1,
			username: "u",
			settings: {},
			lists: [old],
		});
		expect(parsed.lists[0].updatedAt).toBe(0);
		expect(parsed.settingsUpdatedAt).toBe(0);
		expect(parsed.removedLists).toEqual({});
	});
});

describe("mergeAppStates", () => {
	it("keeps a list another device added while this one changed metadata", () => {
		const a = state([entry("x"), entry("new", { updatedAt: 50 })]);
		const b = state([
			entry("x", { activeItemCount: 3, lastModifiedAt: 60, lastAccessedAt: 70 }),
		]);
		const merged = mergeAppStates(a, b);
		expect(merged.lists.map((l) => l.syncId).sort()).toEqual(["new", "x"]);
		const x = merged.lists.find((l) => l.syncId === "x")!;
		expect(x.activeItemCount).toBe(3);
		expect(x.lastAccessedAt).toBe(70);
	});

	it("keeps a rename over a stale copy with newer counts", () => {
		const merged = mergeAppStates(
			state([entry("x", { name: "Renamed", updatedAt: 10 })]),
			state([entry("x", { totalItemCount: 9, lastModifiedAt: 99 })]),
		);
		expect(merged.lists[0].name).toBe("Renamed");
		expect(merged.lists[0].totalItemCount).toBe(9);
	});

	it("drops removed lists unless they were re-added later", () => {
		const now = Date.now();
		const removed = state([], { removedLists: { x: now } });
		const stale = state([entry("x", { updatedAt: now - 1000 })]);
		const readded = state([entry("x", { updatedAt: now + 1000 })]);
		expect(mergeAppStates(removed, stale).lists).toHaveLength(0);
		expect(mergeAppStates(removed, readded).lists).toHaveLength(1);
	});

	it("forgets tombstones older than a year", () => {
		const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
		const merged = mergeAppStates(state([], { removedLists: { x: old } }), state([]));
		expect(merged.removedLists).toEqual({});
	});

	it("takes username and settings from the later change", () => {
		const merged = mergeAppStates(
			state([], { username: "old", settingsUpdatedAt: 1 }),
			state([], { username: "new", settingsUpdatedAt: 2 }),
		);
		expect(merged.username).toBe("new");
	});

	it("is commutative and idempotent, so devices converge", () => {
		const a = state(
			[entry("x", { name: "A", updatedAt: 5 }), entry("y")],
			{ username: "a" },
		);
		const b = state([entry("x", { name: "B", updatedAt: 5 }), entry("z")], {
			username: "b",
		});
		const ab = mergeAppStates(a, b);
		expect(sameAppState(ab, mergeAppStates(b, a))).toBe(true);
		expect(sameAppState(mergeAppStates(ab, a), ab)).toBe(true);
		expect(sameAppState(mergeAppStates(ab, b), ab)).toBe(true);
	});
});

describe("credential strings", () => {
	async function realCreds() {
		return {
			syncId: generateSyncId(),
			cryptKey: await generateCryptKey(),
			secret: generateSecret(),
		};
	}

	it("round-trips share strings, including names with pipes", async () => {
		const creds = await realCreds();
		const share = encodeShareString({ ...entry("x"), ...creds, name: "A | B" });
		expect(decodeShareString(share)).toEqual({ name: "A | B", ...creds });
	});

	it("round-trips app credential strings", async () => {
		const creds = await realCreds();
		expect(decodeAppCredentials(encodeAppCredentials(creds))).toEqual(creds);
	});

	it("rejects malformed ids, keys and secrets", async () => {
		const creds = await realCreds();
		expect(isValidCredentials(creds)).toBe(true);
		expect(isValidCredentials({ ...creds, syncId: "bad id!" })).toBe(false);
		expect(isValidCredentials({ ...creds, cryptKey: "abc" })).toBe(false);
		expect(isValidCredentials({ ...creds, cryptKey: btoa("x".repeat(16)) })).toBe(
			false,
		);
		expect(isValidCredentials({ ...creds, secret: "has space" })).toBe(false);
		expect(decodeShareString(`n|${creds.syncId}|abc|${creds.secret}`)).toBeNull();
	});
});
