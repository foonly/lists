import { z } from "zod/v4";

export const SyncResponseSchema = z.object({
  data: z.string(),
  timestamp: z.number(),
});

export const HistoryEntrySchema = z.object({
  timestamp: z.number(),
});

export const HistoryResponseSchema = z.array(HistoryEntrySchema);
