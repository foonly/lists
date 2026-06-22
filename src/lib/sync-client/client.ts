import { SyncResponseSchema, HistoryResponseSchema } from "./schemas";
import { sign, signGet } from "./crypto";
import { getNextTimestamp, updateLastTimestamp } from "./utils";
import type { SyncResponse, HistoryEntry } from "./types";

export class SyncClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		// Strip trailing slash and /api/v1 so we can always append /api/v1/sync/...
		this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
	}

	async fetch(
		syncId: string,
		secret: string,
		isRetry = false,
	): Promise<SyncResponse | null> {
		const timestamp = getNextTimestamp();
		const path = `/api/v1/sync/${encodeURIComponent(syncId)}`;
		const signature = await signGet(secret, timestamp, path);

		const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
			headers: {
				"X-Sync-Timestamp": String(timestamp),
				"X-Sync-Signature": signature,
			},
		});

		if (res.status === 404) {
			return null;
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			// If we get a 401, it might be a timestamp collision. Try once more
			// with a fresh (incremented) timestamp.
			if (res.status === 401 && !isRetry) {
				console.warn("SyncClient: 401 on fetch, retrying with new timestamp");
				return this.fetch(syncId, secret, true);
			}
			throw new Error(
				`Failed to fetch sync data: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
			);
		}

		const json = await res.json();
		const result = SyncResponseSchema.parse(json);
		updateLastTimestamp(result.timestamp);
		return result;
	}

	/**
	 * Push an encrypted blob to the backend.
	 *
	 * When `registrationSecret` is provided it is included in the request
	 * body as `registration_secret`.  This is required on the very first
	 * POST to a new sync ID so the backend can store the secret for future
	 * HMAC verification.  Callers should only set this when a prior GET
	 * returned 404 (i.e. the blob does not exist yet).
	 */
	async push(
		syncId: string,
		secret: string,
		data: string,
		registrationSecret?: string,
		isRetry = false,
	): Promise<void> {
		const body: Record<string, string> = { data };

		if (registrationSecret) {
			body.registration_secret = registrationSecret;
			body.allowed_origin = globalThis.location.origin;
		}

		const rawBody = JSON.stringify(body);
		const timestamp = getNextTimestamp();
		const signature = await sign(secret, timestamp, rawBody);

		const res = await globalThis.fetch(
			`${this.baseUrl}/api/v1/sync/${encodeURIComponent(syncId)}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Sync-Timestamp": String(timestamp),
					"X-Sync-Signature": signature,
				},
				body: rawBody,
			},
		);

		if (res.status !== 201) {
			const text = await res.text().catch(() => "");
			// If we get a 401, it might be a timestamp collision. Try once more
			// with a fresh (incremented) timestamp.
			if (res.status === 401 && !isRetry) {
				console.warn("SyncClient: 401 on push, retrying with new timestamp");
				return this.push(syncId, secret, data, registrationSecret, true);
			}
			throw new Error(
				`Failed to push sync data: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
			);
		}
	}

	async history(syncId: string, secret: string): Promise<HistoryEntry[]> {
		const timestamp = getNextTimestamp();
		const path = `/api/v1/sync/${encodeURIComponent(syncId)}/history`;
		const signature = await signGet(secret, timestamp, path);

		const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
			headers: {
				"X-Sync-Timestamp": String(timestamp),
				"X-Sync-Signature": signature,
			},
		});

		if (!res.ok) {
			throw new Error(
				`Failed to fetch history: ${res.status} ${res.statusText}`,
			);
		}

		const json = await res.json();
		return HistoryResponseSchema.parse(json);
	}

	async fetchVersion(
		syncId: string,
		secret: string,
		versionTimestamp: number,
	): Promise<SyncResponse> {
		const timestamp = getNextTimestamp();
		const path = `/api/v1/sync/${encodeURIComponent(syncId)}/${encodeURIComponent(String(versionTimestamp))}`;
		const signature = await signGet(secret, timestamp, path);

		const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
			headers: {
				"X-Sync-Timestamp": String(timestamp),
				"X-Sync-Signature": signature,
			},
		});

		if (!res.ok) {
			throw new Error(
				`Failed to fetch version ${versionTimestamp}: ${res.status} ${res.statusText}`,
			);
		}

		const json = await res.json();
		const result = SyncResponseSchema.parse(json);
		updateLastTimestamp(result.timestamp);
		return result;
	}
}
