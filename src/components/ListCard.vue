<script setup lang="ts">
import { computed } from "vue";
import type { ListCredentials } from "@/models/app-state";

const props = defineProps<{
	credentials: ListCredentials;
}>();

const emit = defineEmits<{
	click: [];
	remove: [];
}>();

const relativeTime = computed(() => {
	const now = Date.now();
	const diff = now - props.credentials.lastAccessedAt;
	const seconds = Math.floor(diff / 1000);

	if (seconds < 10) return "Just now";
	if (seconds < 60) return `${seconds}s ago`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;

	const months = Math.floor(days / 30);
	return `${months}mo ago`;
});
</script>

<template>
	<div class="list-card">
		<button class="list-card-main" @click="emit('click')">
			<div class="list-card-content">
				<span class="list-card-name">{{ credentials.name }}</span>
				<span class="list-card-time">{{ relativeTime }}</span>
			</div>
			<svg
				class="list-card-arrow"
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M6 3L11 8L6 13"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
		<button
			class="list-card-remove"
			aria-label="Remove list"
			@click.stop="emit('remove')"
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<!-- Lid -->
				<path
					d="M2.5 4.5H13.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
				<path
					d="M6 4.5V3C6 2.44772 6.44772 2 7 2H9C9.55228 2 10 2.44772 10 3V4.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<!-- Body -->
				<path
					d="M3.5 4.5L4.25 13C4.25 13.5523 4.69772 14 5.25 14H10.75C11.3023 14 11.75 13.5523 11.75 13L12.5 4.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<!-- Lines inside body -->
				<path
					d="M6.5 7V11"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
				<path
					d="M9.5 7V11"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.list-card {
	display: flex;
	align-items: center;
	width: 100%;
	padding: 0 0 0 0;
	background: var(--color-surface, #ffffff);
	border: 1px solid var(--color-border, #e0e0e0);
	border-radius: 10px;
	color: var(--color-text, #333333);
	transition:
		border-color 0.15s ease,
		box-shadow 0.15s ease;
	-webkit-tap-highlight-color: transparent;
}

.list-card:has(.list-card-main:hover) {
	border-color: var(--color-primary, #4a90d9);
	box-shadow: 0 2px 8px rgba(74, 144, 217, 0.1);
}

.list-card-main {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.875rem 0.5rem 0.875rem 1rem;
	background: none;
	border: none;
	font: inherit;
	color: inherit;
	text-align: left;
	cursor: pointer;
	border-radius: 10px 0 0 10px;
	min-width: 0;
	transition: background-color 0.15s ease;
	-webkit-tap-highlight-color: transparent;
}

.list-card-main:hover {
	background: var(--color-hover, #f0f0f0);
}

.list-card-main:active {
	background: var(--color-border, #e0e0e0);
}

.list-card-content {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	min-width: 0;
}

.list-card-name {
	font-size: 0.95rem;
	font-weight: 600;
	line-height: 1.3;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.list-card-time {
	font-size: 0.75rem;
	color: var(--color-text-secondary, #888888);
	line-height: 1.2;
}

.list-card-arrow {
	flex-shrink: 0;
	color: var(--color-text-secondary, #888888);
	transition:
		transform 0.15s ease,
		color 0.15s ease;
}

.list-card-main:hover .list-card-arrow {
	transform: translateX(2px);
	color: var(--color-primary, #4a90d9);
}

.list-card-remove {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	flex-shrink: 0;
	margin-right: 0.5rem;
	background: none;
	border: none;
	border-radius: 50%;
	color: var(--color-text-secondary, #888888);
	cursor: pointer;
	padding: 0;
	transition:
		background-color 0.15s ease,
		color 0.15s ease;
	-webkit-tap-highlight-color: transparent;
}

.list-card-remove:hover {
	background: rgba(220, 53, 69, 0.1);
	color: var(--color-danger, #dc3545);
}

.list-card-remove:active {
	background: rgba(220, 53, 69, 0.2);
	color: var(--color-danger, #dc3545);
}
</style>
