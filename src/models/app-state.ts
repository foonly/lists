import { z } from "zod";

export const ListCredentialsSchema = z.object({
	name: z.string(), // Local display name (not synced inside list blob)
	syncId: z.string(), // Backend blob ID
	cryptKey: z.string(), // Base64-encoded AES-GCM key for the list blob
	secret: z.string(), // HMAC signing secret for backend auth
	lastAccessedAt: z.number(), // Unix timestamp ms, for "recently accessed" sorting
	createdAt: z.number(), // Unix timestamp ms
	order: z.number(), // Manual sort order on the dashboard
});

export const AppStateSchema = z.object({
	version: z.literal(1),
	username: z.string().min(1),
	lists: z.array(ListCredentialsSchema),
	settings: z.object({
		syncIntervalSeconds: z.number().default(30),
		// Optional override — when absent, the app uses VITE_API_BASE_URL from the environment.
		backendUrl: z.string().optional(),
		theme: z.enum(["light", "dark", "auto"]).default("auto"),
	}),
});

export type ListCredentials = z.infer<typeof ListCredentialsSchema>;
export type AppState = z.infer<typeof AppStateSchema>;

/**
 * Resolve the effective backend URL.
 * Priority: explicit override in settings > VITE_API_BASE_URL env var > "/api/v1" fallback.
 */
export function resolveBackendUrl(settings?: AppState["settings"]): string {
	const override = settings?.backendUrl?.trim();
	if (override) return override;
	return import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
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
