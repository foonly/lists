/**
 * JSON.stringify with object keys sorted, so two structurally equal values
 * always serialize identically regardless of how their objects were built.
 * Used to compare local and remote state and to break timestamp ties the
 * same way on every device.
 */
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const sorted: Record<string, unknown> = {};
			for (const k of Object.keys(v).sort()) {
				sorted[k] = (v as Record<string, unknown>)[k];
			}
			return sorted;
		}
		return v;
	});
}
