import { z } from "zod";

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
