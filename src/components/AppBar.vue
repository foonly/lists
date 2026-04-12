<script setup lang="ts">
import { useRouter } from "vue-router";

const props = withDefaults(
	defineProps<{
		title: string;
		showBack?: boolean;
	}>(),
	{
		showBack: false,
	},
);

const router = useRouter();

function goBack() {
	if (window.history.length > 1) {
		router.back();
	} else {
		router.push("/");
	}
}
</script>

<template>
	<header class="app-bar">
		<div class="app-bar-left">
			<button
				v-if="showBack"
				class="app-bar-btn back-btn"
				aria-label="Go back"
				@click="goBack"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M13 4L7 10L13 16"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</div>

		<div class="app-bar-title">
			<slot name="title">
				<h1 class="app-bar-title-text">{{ title }}</h1>
			</slot>
		</div>

		<div class="app-bar-right">
			<slot name="actions" />
		</div>
	</header>
</template>

<style scoped>
.app-bar {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	background: var(--color-surface, #ffffff);
	border-bottom: 1px solid var(--color-border, #e0e0e0);
	position: sticky;
	top: 0;
	z-index: 100;
	min-height: 3.25rem;
}

.app-bar-left,
.app-bar-right {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	flex-shrink: 0;
	min-width: 2.5rem;
}

.app-bar-right {
	justify-content: flex-end;
}

.app-bar-title {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
}

.app-bar-title-text {
	font-size: 1.125rem;
	font-weight: 600;
	text-align: center;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	line-height: 1.3;
	margin: 0;
}

.app-bar-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	padding: 0;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: var(--color-text, #333333);
	cursor: pointer;
	transition: background-color 0.15s ease;
	-webkit-tap-highlight-color: transparent;
}

.app-bar-btn:hover {
	background: var(--color-hover, #f0f0f0);
}

.app-bar-btn:active {
	background: var(--color-border, #e0e0e0);
}
</style>
