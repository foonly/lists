const TS_KEY = "lists-last-timestamp";

let lastTimestamp = parseInt(localStorage.getItem(TS_KEY) || "0", 10);

/**
 * Returns a Unix timestamp (seconds) that is guaranteed to be strictly
 * greater than any timestamp previously returned by this function in the
 * current session or stored in localStorage.
 */
export function getNextTimestamp(): number {
	// Re-read from storage every time to support multiple tabs
	lastTimestamp = parseInt(localStorage.getItem(TS_KEY) || "0", 10);
	let ts = Math.floor(Date.now() / 1000);
	if (ts <= lastTimestamp) {
		ts = lastTimestamp + 1;
	}
	lastTimestamp = ts;
	localStorage.setItem(TS_KEY, String(ts));
	return ts;
}

/**
 * Updates the last seen timestamp if the provided one is newer.
 * Use this when receiving timestamps from the server.
 */
export function updateLastTimestamp(ts: number) {
	if (ts > lastTimestamp) {
		lastTimestamp = ts;
		localStorage.setItem(TS_KEY, String(ts));
	}
}
