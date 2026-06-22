let lastTimestamp = 0;

/**
 * Returns a Unix timestamp (seconds) that is guaranteed to be strictly
 * greater than any timestamp previously returned by this function in the
 * current session.
 */
export function getNextTimestamp(): number {
	let ts = Math.floor(Date.now() / 1000);
	if (ts <= lastTimestamp) {
		ts = lastTimestamp + 1;
	}
	lastTimestamp = ts;
	return ts;
}

/**
 * Updates the last seen timestamp if the provided one is newer.
 * Use this when receiving timestamps from the server.
 */
export function updateLastTimestamp(ts: number) {
	if (ts > lastTimestamp) {
		lastTimestamp = ts;
	}
}
