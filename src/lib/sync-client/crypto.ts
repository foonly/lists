import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

export function base64ToBuffer(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function bufferToBase64(buf: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < buf.length; i++) {
		binary += String.fromCharCode(buf[i]);
	}
	return btoa(binary);
}

export function bufferToHex(buf: Uint8Array): string {
	let hex = "";
	for (let i = 0; i < buf.length; i++) {
		hex += buf[i].toString(16).padStart(2, "0");
	}
	return hex;
}

export async function importAesKey(base64Key: string): Promise<CryptoKey> {
	const raw = base64ToBuffer(base64Key);
	return crypto.subtle.importKey(
		"raw",
		raw.buffer as ArrayBuffer,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

/**
 * Import an HMAC-SHA256 key from a secret string.
 *
 * The secret is encoded as UTF-8 bytes — this matches the Go backend which
 * stores the `registration_secret` string as-is and uses its raw bytes as
 * the HMAC key material.
 */
export async function importHmacKey(secret: string): Promise<CryptoKey> {
	const raw = new TextEncoder().encode(secret);
	return crypto.subtle.importKey(
		"raw",
		raw.buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a random AES-GCM 256-bit key and export it as base64.
 */
export async function generateCryptKey(): Promise<string> {
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
	const raw = await crypto.subtle.exportKey("raw", key);
	return bufferToBase64(new Uint8Array(raw));
}

/**
 * Generate a random signing secret as a 32-byte hex string.
 *
 * This string serves double duty:
 *   1. Sent as `registration_secret` in the first POST to a new sync ID.
 *   2. Used (via UTF-8 encoding) as the HMAC-SHA256 key for signing
 *      subsequent requests.
 *
 * Using hex (rather than base64) keeps the string URL-safe and free of
 * characters that could cause issues in JSON or headers.  The Go backend
 * stores the string verbatim and encodes it with the equivalent of
 * TextEncoder to derive HMAC key bytes — so we must do the same.
 */
export function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return bufferToHex(bytes);
}

/**
 * Generate a 21-character URL-safe sync ID using nanoid.
 */
export function generateSyncId(): string {
	return nanoid();
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a base64 string of (12-byte IV || ciphertext).
 */
export async function encrypt(
	plaintext: string,
	base64Key: string,
): Promise<string> {
	const key = await importAesKey(base64Key);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);

	const cipherBuf = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoded,
	);

	const cipherBytes = new Uint8Array(cipherBuf);
	const combined = new Uint8Array(iv.length + cipherBytes.length);
	combined.set(iv, 0);
	combined.set(cipherBytes, iv.length);

	return bufferToBase64(combined);
}

/**
 * Decrypt a base64 blob (IV + ciphertext) with AES-256-GCM.
 * Returns the plaintext string.
 */
export async function decrypt(
	base64Blob: string,
	base64Key: string,
): Promise<string> {
	const key = await importAesKey(base64Key);
	const combined = base64ToBuffer(base64Blob);

	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);

	const plainBuf = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);

	return new TextDecoder().decode(plainBuf);
}

/**
 * Compute a SHA-256 hex digest of an arbitrary string.
 */
export async function hash(data: string): Promise<string> {
	const encoded = new TextEncoder().encode(data);
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
	return bufferToHex(new Uint8Array(hashBuffer));
}

/**
 * Compute the HMAC-SHA256 signature for a sync POST request.
 *
 *   signature = HMAC-SHA256(secret, timestamp_string + sha256_hex(body))
 *
 * The secret is treated as a plain UTF-8 string (matching the reference
 * bookmarks client and the Go backend).  Returns the signature as a hex
 * string.
 */
export async function sign(
	secret: string,
	timestamp: number,
	body: string,
): Promise<string> {
	// SHA-256 hex digest of the raw request body
	const bodyHex = await hash(body);

	// HMAC-SHA256(secret_utf8, timestamp_string + bodyHex)
	const hmacKey = await importHmacKey(secret);
	const message = new TextEncoder().encode(String(timestamp) + bodyHex);
	const sig = await crypto.subtle.sign("HMAC", hmacKey, message);

	return bufferToHex(new Uint8Array(sig));
}

/**
 * Compute a SHA-256 hex checksum of content fields joined with a null
 * separator.  Used for done-state checksums.  Deliberately excludes group
 * — changing which aisle an item is in should not invalidate a check-off.
 */
export async function contentChecksum(
	text: string,
	quantity: number | null,
	unit: string | null,
): Promise<string> {
	const parts = [
		text,
		quantity === null ? "" : String(quantity),
		unit === null ? "" : unit,
	];
	const joined = parts.join("\0");
	return hash(joined);
}
