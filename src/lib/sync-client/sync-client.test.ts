import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	contentChecksum,
	decrypt,
	encrypt,
	generateCryptKey,
	sign,
} from "./crypto";
import { getNextTimestamp, updateLastTimestamp } from "./utils";
import { isRetryableSyncError, SyncHttpError } from "./client";

describe("crypto", () => {
	it("decrypts what it encrypted, with a fresh IV each time", async () => {
		const key = await generateCryptKey();
		const a = await encrypt("hello", key);
		const b = await encrypt("hello", key);
		expect(a).not.toBe(b);
		expect(await decrypt(a, key)).toBe("hello");
	});

	it("refuses to decrypt with the wrong key", async () => {
		const blob = await encrypt("secret", await generateCryptKey());
		await expect(decrypt(blob, await generateCryptKey())).rejects.toThrow();
	});

	it("signs deterministically per secret, timestamp and body", async () => {
		const s1 = await sign("secret", 100, "{}");
		expect(await sign("secret", 100, "{}")).toBe(s1);
		expect(await sign("secret", 101, "{}")).not.toBe(s1);
		expect(await sign("other", 100, "{}")).not.toBe(s1);
	});

	it("ignores nothing but group in the done checksum", async () => {
		const base = await contentChecksum("milk", 2, "l");
		expect(await contentChecksum("milk", 2, "l")).toBe(base);
		expect(await contentChecksum("milk", 3, "l")).not.toBe(base);
		expect(await contentChecksum("milk", null, null)).not.toBe(base);
	});
});

describe("request timestamps", () => {
	const store = new Map<string, string>();
	const now = 1_800_000_000;

	beforeEach(() => {
		store.clear();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, String(v)),
			removeItem: (k: string) => void store.delete(k),
		});
		vi.useFakeTimers();
		vi.setSystemTime(now * 1000);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("increases strictly per sync ID within the same second", () => {
		expect(getNextTimestamp("a")).toBe(now);
		expect(getNextTimestamp("a")).toBe(now + 1);
		expect(getNextTimestamp("a")).toBe(now + 2);
	});

	it("keeps sync IDs independent", () => {
		getNextTimestamp("a");
		getNextTimestamp("a");
		expect(getNextTimestamp("b")).toBe(now);
	});

	it("stays above timestamps seen from the server", () => {
		updateLastTimestamp("a", now + 50);
		expect(getNextTimestamp("a")).toBe(now + 51);
		updateLastTimestamp("a", now); // older: ignored
		expect(getNextTimestamp("a")).toBe(now + 52);
	});

	it("uses the old global counter as a floor for unseen IDs", () => {
		store.set("lists-last-timestamp", String(now + 20));
		expect(getNextTimestamp("c")).toBe(now + 21);
	});

	it("drops counters that fell far behind the clock", () => {
		getNextTimestamp("a");
		vi.setSystemTime((now + 3600) * 1000);
		getNextTimestamp("b");
		expect(JSON.parse(store.get("lists-last-timestamps")!)).not.toHaveProperty("a");
	});
});

describe("isRetryableSyncError", () => {
	it("retries network failures, rate limits and server errors", () => {
		expect(isRetryableSyncError(new TypeError("Failed to fetch"))).toBe(true);
		expect(isRetryableSyncError(new SyncHttpError("", 429))).toBe(true);
		expect(isRetryableSyncError(new SyncHttpError("", 503))).toBe(true);
	});

	it("does not retry auth, client or data errors", () => {
		expect(isRetryableSyncError(new SyncHttpError("", 401))).toBe(false);
		expect(isRetryableSyncError(new SyncHttpError("", 413))).toBe(false);
		expect(isRetryableSyncError(new DOMException("", "OperationError"))).toBe(
			false,
		);
		expect(isRetryableSyncError(new Error("bad data"))).toBe(false);
	});
});
