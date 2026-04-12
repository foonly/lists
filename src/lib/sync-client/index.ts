export { SyncClient } from "./client";
export * from "./crypto";
export * from "./types";
export * from "./schemas";

import type { z } from "zod/v4";
import type { SyncClient } from "./client";
import { encrypt, decrypt } from "./crypto";

/**
 * Pull and decrypt a blob from the backend, validating it against a Zod schema.
 *
 * Returns `null` when the sync ID does not exist yet (HTTP 404).
 */
export async function pullBlob<T>(
	syncId: string,
	cryptKey: string,
	schema: z.ZodType<T>,
	client: SyncClient,
): Promise<{ data: T; timestamp: number } | null> {
	const response = await client.fetch(syncId);
	if (response === null) {
		return null;
	}

	const decrypted = await decrypt(response.data, cryptKey);
	const parsed = JSON.parse(decrypted);
	const data = schema.parse(parsed) as T;

	return { data, timestamp: response.timestamp };
}

/**
 * Encrypt and push a blob to the backend.
 *
 * Registration is handled automatically: a GET is performed first and, if it
 * returns 404 (the sync ID doesn't exist yet), the `secret` is included as
 * `registration_secret` in the POST body so the backend can store it for
 * future HMAC verification.  This matches the flow used by the reference
 * bookmarks client.
 *
 * When `knownExists` is `true` the initial GET is skipped — use this when
 * you have already fetched the blob in the same sync cycle and know it
 * exists on the server.
 */
export async function pushBlob<T>(
	syncId: string,
	cryptKey: string,
	secret: string,
	data: T,
	client: SyncClient,
	knownExists?: boolean,
): Promise<void> {
	// Determine whether this sync ID already exists on the backend.
	// If it doesn't we must include the registration_secret.
	let isNew = false;

	if (!knownExists) {
		const existing = await client.fetch(syncId);
		isNew = existing === null;
	}

	const json = JSON.stringify(data);
	const encrypted = await encrypt(json, cryptKey);

	await client.push(syncId, secret, encrypted, isNew ? secret : undefined);
}
