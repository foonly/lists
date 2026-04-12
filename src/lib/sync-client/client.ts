import { SyncResponseSchema, HistoryResponseSchema } from "./schemas";
import { sign } from "./crypto";
import type { SyncResponse, HistoryEntry } from "./types";

export class SyncClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		// Strip trailing slash so we can always append /sync/...
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	async fetch(syncId: string): Promise<SyncResponse | null> {
		const res = await globalThis.fetch(
			`${this.baseUrl}/sync/${encodeURIComponent(syncId)}`,
		);

		if (res.status === 404) {
			return null;
		}

		if (!res.ok) {
			throw new Error(
				`Failed to fetch sync data: ${res.status} ${res.statusText}`,
			);
		}

		const json = await res.json();
		return SyncResponseSchema.parse(json);
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
	): Promise<void> {
		const body: Record<string, string> = { data };

		if (registrationSecret) {
			body.registration_secret = registrationSecret;
		}

		const rawBody = JSON.stringify(body);
		const timestamp = Math.floor(Date.now() / 1000);
		const signature = await sign(secret, timestamp, rawBody);

		const res = await globalThis.fetch(
			`${this.baseUrl}/sync/${encodeURIComponent(syncId)}`,
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
			throw new Error(
				`Failed to push sync data: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
			);
		}
	}

	async history(syncId: string): Promise<HistoryEntry[]> {
		const res = await globalThis.fetch(
			`${this.baseUrl}/sync/${encodeURIComponent(syncId)}/history`,
		);

		if (!res.ok) {
			throw new Error(
				`Failed to fetch history: ${res.status} ${res.statusText}`,
			);
		}

		const json = await res.json();
		return HistoryResponseSchema.parse(json);
	}

	async fetchVersion(syncId: string, timestamp: number): Promise<SyncResponse> {
		const res = await globalThis.fetch(
			`${this.baseUrl}/sync/${encodeURIComponent(syncId)}/${encodeURIComponent(String(timestamp))}`,
		);

		if (!res.ok) {
			throw new Error(
				`Failed to fetch version ${timestamp}: ${res.status} ${res.statusText}`,
			);
		}

		const json = await res.json();
		return SyncResponseSchema.parse(json);
	}
}
