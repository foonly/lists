// Request timestamps (Unix seconds) for signed backend requests.
//
// The backend rejects a request whose timestamp it has already seen for the
// same sync ID (replay protection) and any timestamp more than 300 s from
// its clock. Timestamps are therefore kept strictly increasing *per sync ID*:
// a single global counter would make busy moments (many lists opening at
// once) push every timestamp ahead of real time until requests are refused.

const TS_KEY = "lists-last-timestamps";
/** Global counter used before timestamps were tracked per sync ID. */
const LEGACY_TS_KEY = "lists-last-timestamp";
/** Entries this far behind the clock can't matter any more and are dropped. */
const STALE_AFTER_S = 600;

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

// Read from storage on every call so several open tabs share the counters.
function load(): Record<string, number> {
	try {
		const parsed = JSON.parse(localStorage.getItem(TS_KEY) || "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function save(map: Record<string, number>): void {
	const cutoff = nowSeconds() - STALE_AFTER_S;
	for (const [id, ts] of Object.entries(map)) {
		if (typeof ts !== "number" || ts < cutoff) delete map[id];
	}
	try {
		localStorage.setItem(TS_KEY, JSON.stringify(map));
	} catch {
		// Storage unavailable: a collision only costs one 401 + retry.
	}
}

/** Last timestamp for a sync ID, falling back to the old global counter. */
function lastFor(map: Record<string, number>, syncId: string): number {
	if (typeof map[syncId] === "number") return map[syncId];
	const legacy = parseInt(localStorage.getItem(LEGACY_TS_KEY) || "0", 10) || 0;
	if (legacy && legacy < nowSeconds() - STALE_AFTER_S) {
		localStorage.removeItem(LEGACY_TS_KEY);
		return 0;
	}
	return legacy;
}

/**
 * Returns a Unix timestamp (seconds) for a request to `syncId` that is
 * strictly greater than any timestamp previously used or seen for it.
 */
export function getNextTimestamp(syncId: string): number {
	const map = load();
	const last = lastFor(map, syncId);
	let ts = nowSeconds();
	if (ts <= last) ts = last + 1;
	map[syncId] = ts;
	save(map);
	return ts;
}

/**
 * Raise the last seen timestamp for `syncId` if the given one is newer.
 * Use this with timestamps received from the server.
 */
export function updateLastTimestamp(syncId: string, ts: number): void {
	const map = load();
	if (ts > lastFor(map, syncId)) {
		map[syncId] = ts;
		save(map);
	}
}
