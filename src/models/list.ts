import { z } from "zod";
import { stableStringify } from "@/lib/stable-json";

// Generic tracked field — each mutable field carries its own timestamp and author.
// This enables per-field last-writer-wins merging during sync.
const TrackedFieldSchema = <T extends z.ZodTypeAny>(inner: T) =>
	z.object({
		value: inner,
		timestamp: z.number(), // Unix ms when THIS field was last changed
		username: z.string(), // Who made THIS specific change
	});

// Helper type to extract the inferred type from a TrackedFieldSchema
export type TrackedField<T> = {
	value: T;
	timestamp: number;
	username: string;
};

// Factory to create a TrackedField value
export function tracked<T>(
	value: T,
	username: string,
	timestamp?: number,
): TrackedField<T> {
	return {
		value,
		timestamp: timestamp ?? Date.now(),
		username,
	};
}

export const ListItemSchema = z.object({
	id: z.string(), // Immutable, not tracked
	createdBy: z.string().default("Unknown"), // Who created the item
	createdAt: z.number().default(() => Date.now()), // When it was created

	// Content fields — independently mergeable
	text: TrackedFieldSchema(z.string()),
	quantity: TrackedFieldSchema(z.number().nullable()), // null = not set
	unit: TrackedFieldSchema(z.string().nullable()), // null = not set
	group: TrackedFieldSchema(z.string().nullable()), // null = ungrouped

	// Sort order within a group (lower = higher in list)
	order: TrackedFieldSchema(z.number()),

	// Done marker — stores checksum of (text, quantity, unit) at time of check-off
	// null = not done, string = checksum of content when marked done
	done: TrackedFieldSchema(z.string().nullable()),

	// Soft delete
	deleted: TrackedFieldSchema(z.boolean()),
});

export const ListBlobSchema = z.object({
	version: z.literal(1),
	items: z.array(ListItemSchema),
});

export type ListItem = z.infer<typeof ListItemSchema>;
export type ListBlob = z.infer<typeof ListBlobSchema>;

// The tracked field names that participate in merging
export const TRACKED_FIELDS = [
	"text",
	"quantity",
	"unit",
	"group",
	"order",
	"done",
	"deleted",
] as const;
export type TrackedFieldName = (typeof TRACKED_FIELDS)[number];

/**
 * Merge two versions of a list's items with per-field last-writer-wins.
 *
 * The result follows the remote item order, then local-only items, so a
 * device that adopts a remote list reproduces it exactly. Equal timestamps
 * are broken by content, so every device picks the same value: merging is
 * deterministic and devices exchanging lists converge.
 */
export function mergeListItems(local: ListItem[], remote: ListItem[]): ListItem[] {
	const localMap = new Map<string, ListItem>(
		local.map((item) => [item.id, item]),
	);
	const remoteMap = new Map<string, ListItem>(
		remote.map((item) => [item.id, item]),
	);

	// Follow the remote item order, then local-only items, so a device that
	// adopts a remote list reproduces it exactly and has nothing to push back.
	const allIds = new Set<string>([...remoteMap.keys(), ...localMap.keys()]);

	const merged: ListItem[] = [];

	for (const id of allIds) {
		const localItem = localMap.get(id);
		const remoteItem = remoteMap.get(id);

		if (localItem && !remoteItem) {
			merged.push(localItem);
		} else if (!localItem && remoteItem) {
			merged.push(remoteItem);
		} else if (localItem && remoteItem) {
			// Per-field last-writer-wins merge.
			// Clone local as the base, then overlay winning fields.
			const mergedItem: ListItem = {
				id: localItem.id,
				createdBy: localItem.createdBy,
				createdAt: localItem.createdAt,
				text: { ...localItem.text },
				quantity: { ...localItem.quantity },
				unit: { ...localItem.unit },
				group: { ...localItem.group },
				order: { ...localItem.order },
				done: { ...localItem.done },
				deleted: { ...localItem.deleted },
			};

			for (const field of TRACKED_FIELDS) {
				const localField = localItem[field];
				const remoteField = remoteItem[field];
				// Later timestamp wins. Equal timestamps are broken by content,
				// so every device picks the same value and they converge.
				const remoteWins =
					remoteField.timestamp !== localField.timestamp
						? remoteField.timestamp > localField.timestamp
						: stableStringify(remoteField) >= stableStringify(localField);
				if (remoteWins) {
					// Use type assertion since TS can't narrow the union across
					// all tracked field types in a generic loop.
					(mergedItem[field] as typeof remoteField) = {
						...remoteField,
					};
				}
			}

			merged.push(mergedItem);
		}
	}

	return merged;
}
