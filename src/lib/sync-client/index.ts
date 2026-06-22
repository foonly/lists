export { SyncClient } from "./client";
export { SyncHub, type UpdateHandler, type ConnectionStatus } from "./hub";
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
	secret: string,
	cryptKey: string,
	schema: z.ZodType<T>,
	client: SyncClient,
): Promise<{ data: T; timestamp: number } | null> {
	const response = await client.fetch(syncId, secret);
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
 * Registration is handled automatically: if the blob does not exist yet
 * (HTTP 404 on GET), the `secret` is included as `registration_secret`
 * in the POST body so the backend can store it for future HMAC verification.
 *
 * When `knownExists` is provided (true or false) the initial GET is skipped.
 * Use `true` when you have already confirmed the blob exists on the server,
 * and `false` when you know it does NOT exist yet (e.g. after a 404 pull).
 * If omitted (undefined), a GET is performed to check existence.
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

	if (knownExists === undefined) {
		const existing = await client.fetch(syncId, secret);
		isNew = existing === null;
	} else {
		isNew = !knownExists;
	}

	const json = JSON.stringify(data);
	const encrypted = await encrypt(json, cryptKey);

	await client.push(syncId, secret, encrypted, isNew ? secret : undefined);
}
