<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import { decodeShareString } from "@/models/app-state";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();

const error = ref("");
const importing = ref(true);
/** The share string awaiting confirmation. */
const pendingCode = ref<string | null>(null);
const pendingName = ref("");

/**
 * Share links carry the credentials in the URL fragment (/import#code), which
 * browsers never send to the server. /import/:code and /import?c=code are
 * still accepted so links shared by older versions keep working.
 */
function readCode(): string {
	if (route.hash.length > 1) return route.hash.slice(1);
	return (route.params.code as string) || (route.query.c as string) || "";
}

onMounted(() => {
	const code = readCode();
	// Drop the credentials from the address bar and this history entry.
	router.replace({ name: "import" });

	if (!code) {
		error.value = "No import code provided.";
		importing.value = false;
		return;
	}

	const parsed = decodeShareString(code);
	if (!parsed) {
		error.value = "Invalid import code format.";
		importing.value = false;
		return;
	}

	// Already on this device: just open it.
	if (appStore.lists.some((l) => l.syncId === parsed.syncId)) {
		router.replace(`/list/${parsed.syncId}`);
		return;
	}

	pendingCode.value = code;
	pendingName.value = parsed.name;
	importing.value = false;
});

function confirmImport() {
	if (!pendingCode.value) return;
	try {
		const creds = appStore.importList(pendingCode.value);
		if (creds) {
			router.replace(`/list/${creds.syncId}`);
		} else {
			error.value = "Invalid import code format.";
			pendingCode.value = null;
		}
	} catch (e: unknown) {
		error.value =
			e instanceof Error ? e.message : "An unexpected error occurred.";
		pendingCode.value = null;
	}
}

function goHome() {
	router.replace("/");
}
</script>

<template>
	<div class="import-view">
		<div v-if="importing" class="status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Importing your list...</p>
		</div>

		<div v-else-if="pendingCode" class="confirm-state">
			<h1>Add shared list?</h1>
			<p class="list-name">{{ pendingName }}</p>
			<p class="confirm-text">
				Anyone with this link can see and edit the list. Only add it if you
				trust who sent it.
			</p>
			<div class="actions">
				<button class="btn-primary" @click="confirmImport">Add list</button>
				<button class="btn" @click="goHome">Cancel</button>
			</div>
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

.error-state,
.confirm-state {
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

.list-name {
	font-size: 1.15rem;
	font-weight: 600;
	margin-bottom: 1rem;
	overflow-wrap: anywhere;
}

.confirm-text {
	color: var(--color-text-secondary);
	margin-bottom: 2rem;
	line-height: 1.6;
}

.actions {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
}

.actions .btn {
	width: 100%;
	max-width: 240px;
}
</style>
