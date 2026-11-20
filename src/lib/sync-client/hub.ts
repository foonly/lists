import { ref, type Ref } from "vue";
import { signSubscribe } from "./crypto";
import { getNextTimestamp, updateLastTimestamp } from "./utils";
import { SyncResponseSchema } from "./schemas";
import type { SyncResponse } from "./types";

export type UpdateHandler = (response: SyncResponse) => void;
export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export class SyncHub {
	private ws: WebSocket | null = null;
	private baseUrl: string;
	private subscriptions = new Map<
		string,
		{ secret: string; handler: UpdateHandler }
	>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private shouldReconnect = true;
	/** Failed subscribe attempts per sync ID since the last successful update. */
	private retries = new Map<string, number>();
	private static readonly MAX_SUBSCRIBE_RETRIES = 5;

	/** Observable connection status */
	public status: Ref<ConnectionStatus> = ref("closed");

	constructor(baseUrl: string) {
		// Convert http(s) to ws(s)
		this.baseUrl = baseUrl.replace(/^http/, "ws");
		// Strip trailing slash and /api/v1
		this.baseUrl = this.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

		if (typeof window !== "undefined") {
			window.addEventListener("online", () => {
				if (this.shouldReconnect) {
					console.log("SyncHub: Browser back online, forcing reconnect...");
					if (this.reconnectTimer) {
						clearTimeout(this.reconnectTimer);
						this.reconnectTimer = null;
					}
					this.dropSocket();
					this.connect();
				}
			});
		}
	}

	async subscribe(syncId: string, secret: string, handler: UpdateHandler) {
		this.subscriptions.set(syncId, { secret, handler });
		if (this.ws?.readyState === WebSocket.OPEN) {
			await this.sendSubscribe(syncId, secret);
		} else {
			this.connect();
		}
	}

	unsubscribe(syncId: string) {
		this.subscriptions.delete(syncId);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: "unsubscribe", id: syncId }));
		}
	}

	connect() {
		if (this.ws || this.reconnectTimer) return;

		this.status.value = "connecting";
		const wsUrl = `${this.baseUrl}/api/v1/ws`;
		const ws = new WebSocket(wsUrl);
		this.ws = ws;
		// Handlers can fire after this socket was replaced (e.g. by the
		// "online" handler); such events belong to a dead socket and must not
		// touch the hub's state or deliver updates.
		const isCurrent = () => this.ws === ws;

		ws.onopen = async () => {
			if (!isCurrent()) return;
			console.log("SyncHub: WebSocket connection established");
			this.status.value = "open";
			this.retries.clear();
			for (const [syncId, { secret }] of this.subscriptions) {
				if (!isCurrent()) return;
				console.log(`SyncHub: Subscribing to ${syncId}`);
				await this.sendSubscribe(syncId, secret);
			}
		};

		ws.onmessage = (event) => {
			if (!isCurrent()) return;
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "update") {
					const sub = this.subscriptions.get(msg.id);
					if (sub) {
						this.retries.delete(msg.id);
						if (this.status.value === "error") {
							this.status.value = "open";
						}
						console.log(`SyncHub: Received update for ${msg.id}`);
						const response = SyncResponseSchema.parse(msg);
						updateLastTimestamp(msg.id, response.timestamp);
						sub.handler(response);
					}
				} else if (msg.type === "error") {
					console.error("SyncHub server-side error:", msg.message);
					// The server names the sync ID a subscribe error belongs to.
					// 404: the blob is not uploaded yet (e.g. right after setup).
					// 401: a replayed signature, e.g. another device made the
					// identical request in the same second.
					if (
						msg.id &&
						(msg.code === 401 || msg.code === 404) &&
						this.retrySubscribe(msg.id)
					) {
						return;
					}
					if (msg.code === 401) {
						this.status.value = "error";
					}
				}
			} catch (e) {
				console.error("SyncHub: Failed to parse message", e);
			}
		};

		ws.onclose = () => {
			if (!isCurrent()) return;
			const wasConnecting = this.status.value === "connecting";
			this.ws = null;
			if (this.shouldReconnect) {
				// If we were connecting and it closed, it's essentially an error
				if (wasConnecting) {
					this.status.value = "error";
				} else {
					this.status.value = "closed";
				}
				console.log("SyncHub: Disconnected, reconnecting in 5s...");
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null;
					this.connect();
				}, 5000);
			} else {
				this.status.value = "closed";
			}
		};

		ws.onerror = (err) => {
			if (!isCurrent()) return;
			console.error("SyncHub: WebSocket error", err);
			this.status.value = "error";
		};
	}

	/** Schedules another subscribe attempt with backoff. Returns false when giving up. */
	private retrySubscribe(syncId: string): boolean {
		const sub = this.subscriptions.get(syncId);
		const attempt = (this.retries.get(syncId) ?? 0) + 1;
		if (!sub || attempt > SyncHub.MAX_SUBSCRIBE_RETRIES) {
			return false;
		}
		this.retries.set(syncId, attempt);
		setTimeout(() => {
			const current = this.subscriptions.get(syncId);
			if (current && this.ws?.readyState === WebSocket.OPEN) {
				this.sendSubscribe(syncId, current.secret);
			}
		}, 2000 * attempt);
		return true;
	}

	private async sendSubscribe(syncId: string, secret: string) {
		const timestamp = getNextTimestamp(syncId);
		const signature = await signSubscribe(secret, timestamp, syncId);
		// The socket may have closed or been replaced while signing.
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		this.ws.send(
			JSON.stringify({
				type: "subscribe",
				id: syncId,
				timestamp,
				signature,
			}),
		);
	}

	/** Detach and close the current socket; its late events are ignored. */
	private dropSocket() {
		const ws = this.ws;
		if (!ws) return;
		this.ws = null;
		ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
		ws.close();
	}

	close() {
		this.shouldReconnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.dropSocket();
		this.status.value = "closed";
	}
}
