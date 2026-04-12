<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();

const error = ref("");
const importing = ref(true);

onMounted(async () => {
	// Support both path params (/import/:code) and query params (/import?c=...)
	const code = (route.params.code as string) || (route.query.c as string);

	if (!code) {
		error.value = "No import code provided.";
		importing.value = false;
		return;
	}

	try {
		// router already decodes URL components
		const shareString = code;
		const creds = appStore.importList(shareString);

		if (creds) {
			// Success! Redirect to the newly imported list.
			router.replace(`/list/${creds.syncId}`);
		} else {
			error.value = "Invalid import code format.";
			importing.value = false;
		}
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : "An unexpected error occurred.";
		importing.value = false;
	}
});

function goHome() {
	router.push("/");
}
</script>

<template>
	<div class="import-view">
		<div v-if="importing" class="status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Importing your list...</p>
		</div>

		<div v-else-if="error" class="error-state">
			<div class="error-icon" aria-hidden="true">
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			</div>
			<h1>Import Failed</h1>
			<p class="error-text">{{ error }}</p>
			<button class="btn-primary" @click="goHome">Go to Dashboard</button>
		</div>
	</div>
</template>

<style scoped>
.import-view {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 100dvh;
	padding: 2rem;
	background: var(--color-bg);
	color: var(--color-text);
}

.status {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.5rem;
}

.spinner {
	width: 48px;
	height: 48px;
	border: 4px solid var(--color-border);
	border-top-color: var(--color-primary);
	border-radius: 50%;
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.error-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	max-width: 400px;
	width: 100%;
	text-align: center;
}

.error-icon {
	color: var(--color-danger);
	margin-bottom: 1.5rem;
}

h1 {
	font-size: 1.5rem;
	font-weight: 700;
	margin-bottom: 0.75rem;
}

.error-text {
	color: var(--color-text-secondary);
	margin-bottom: 2rem;
	line-height: 1.6;
}

.btn-primary {
	width: 100%;
	max-width: 240px;
}
</style>
