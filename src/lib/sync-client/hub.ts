import { ref, type Ref } from "vue";
import { signSubscribe } from "./crypto";
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

	/** Observable connection status */
	public status: Ref<ConnectionStatus> = ref("closed");

	constructor(baseUrl: string) {
		// Convert http(s) to ws(s)
		this.baseUrl = baseUrl.replace(/^http/, "ws");
		// Strip trailing slash and /api/v1
		this.baseUrl = this.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

		if (typeof window !== "undefined") {
			window.addEventListener("online", () => {
				if (this.shouldReconnect && !this.ws) {
					console.log("SyncHub: Browser back online, reconnecting...");
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
		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = async () => {
			console.log("SyncHub: Connected to WebSocket");
			this.status.value = "open";
			for (const [syncId, { secret }] of this.subscriptions) {
				await this.sendSubscribe(syncId, secret);
			}
		};

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "update") {
					const sub = this.subscriptions.get(msg.id);
					if (sub) {
						const response = SyncResponseSchema.parse(msg);
						sub.handler(response);
					}
				} else if (msg.type === "error") {
					console.error("SyncHub error:", msg.message);
				}
			} catch (e) {
				console.error("SyncHub: Failed to parse message", e);
			}
		};

		this.ws.onclose = () => {
			this.ws = null;
			if (this.shouldReconnect) {
				this.status.value = "closed";
				console.log("SyncHub: Disconnected, reconnecting in 5s...");
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null;
					this.connect();
				}, 5000);
			} else {
				this.status.value = "closed";
			}
		};

		this.ws.onerror = (err) => {
			console.error("SyncHub: WebSocket error", err);
			this.status.value = "error";
		};
	}

	private async sendSubscribe(syncId: string, secret: string) {
		const timestamp = Math.floor(Date.now() / 1000);
		const signature = await signSubscribe(secret, timestamp, syncId);
		this.ws?.send(
			JSON.stringify({
				type: "subscribe",
				id: syncId,
				timestamp,
				signature,
			}),
		);
	}

	close() {
		this.shouldReconnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}
