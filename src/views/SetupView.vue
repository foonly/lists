<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

const router = useRouter();
const appStore = useAppStore();

const mode = ref<"new" | "restore">("new");

const form = reactive({
	username: "",
	credentials: "",
});

const loading = ref(false);
const error = ref("");

async function handleNewSetup() {
	if (!form.username.trim()) {
		error.value = "Username is required.";
		return;
	}

	loading.value = true;
	error.value = "";

	try {
		await appStore.setup(form.username.trim());
		router.push("/");
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : "Setup failed.";
	} finally {
		loading.value = false;
	}
}

async function handleRestore() {
	if (!form.credentials.trim()) {
		error.value = "Credentials are required.";
		return;
	}

	loading.value = true;
	error.value = "";

	try {
		await appStore.restore(form.credentials.trim());
		router.push("/");
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : "Restore failed.";
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<div class="setup-page">
		<div class="setup-card">
			<h1 class="setup-title">Lists</h1>
			<p class="setup-subtitle">Collaborative shopping lists, offline-first.</p>

			<div class="mode-tabs">
				<button
					:class="['mode-tab', { active: mode === 'new' }]"
					@click="
						mode = 'new';
						error = '';
					"
				>
					New setup
				</button>
				<button
					:class="['mode-tab', { active: mode === 'restore' }]"
					@click="
						mode = 'restore';
						error = '';
					"
				>
					Restore from backup
				</button>
			</div>

			<form
				v-if="mode === 'new'"
				class="setup-form"
				@submit.prevent="handleNewSetup"
			>
				<div class="field">
					<label for="username">Username</label>
					<input
						id="username"
						v-model="form.username"
						type="text"
						placeholder="Your display name"
						autocomplete="username"
					/>
				</div>

				<p v-if="error" class="error-message">{{ error }}</p>

				<button type="submit" class="btn-primary" :disabled="loading">
					{{ loading ? "Setting up…" : "Get Started" }}
				</button>
			</form>

			<form v-else class="setup-form" @submit.prevent="handleRestore">
				<div class="field">
					<label for="credentials">App Credentials</label>
					<input
						id="credentials"
						v-model="form.credentials"
						type="text"
						placeholder="syncId|cryptKey|secret"
						autocomplete="off"
						spellcheck="false"
					/>
					<p class="field-hint">
						Paste the credential string from your other device's Settings page.
					</p>
				</div>

				<p v-if="error" class="error-message">{{ error }}</p>

				<button type="submit" class="btn-primary" :disabled="loading">
					{{ loading ? "Restoring…" : "Restore" }}
				</button>
			</form>
		</div>
	</div>
</template>

<style scoped>
.setup-page {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 100dvh;
	padding: 1.5rem;
	background: var(--color-bg, #f5f5f5);
}

.setup-card {
	width: 100%;
	max-width: 420px;
	background: var(--color-surface, #ffffff);
	border-radius: 12px;
	padding: 2rem;
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.setup-title {
	margin: 0 0 0.25rem;
	font-size: 1.75rem;
	font-weight: 700;
	text-align: center;
	color: var(--color-text, #1a1a1a);
}

.setup-subtitle {
	margin: 0 0 1.5rem;
	font-size: 0.9rem;
	text-align: center;
	color: var(--color-text-secondary, #666);
}

.mode-tabs {
	display: flex;
	gap: 0;
	margin-bottom: 1.5rem;
	border-radius: 8px;
	overflow: hidden;
	border: 1px solid var(--color-border, #ddd);
}

.mode-tab {
	flex: 1;
	padding: 0.6rem 0.75rem;
	border: none;
	background: transparent;
	font-size: 0.85rem;
	font-weight: 500;
	color: var(--color-text-secondary, #666);
	cursor: pointer;
	transition:
		background 0.15s,
		color 0.15s;
}

.mode-tab.active {
	background: var(--color-primary, #4a90d9);
	color: #fff;
}

.mode-tab:not(.active):hover {
	background: var(--color-hover, #f0f0f0);
}

.setup-form {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.field label {
	font-size: 0.85rem;
	font-weight: 500;
	color: var(--color-text, #1a1a1a);
}

.field input {
	padding: 0.6rem 0.75rem;
	border: 1px solid var(--color-border, #ddd);
	border-radius: 8px;
	font-size: 0.9rem;
	background: var(--color-bg, #f5f5f5);
	color: var(--color-text, #1a1a1a);
	outline: none;
	transition: border-color 0.15s;
}

.field input:focus {
	border-color: var(--color-primary, #4a90d9);
}

.field input::placeholder {
	color: var(--color-text-secondary, #aaa);
}

.error-message {
	margin: 0;
	padding: 0.5rem 0.75rem;
	font-size: 0.85rem;
	color: var(--color-error, #d9534f);
	background: var(--color-error-bg, #fdf0f0);
	border-radius: 6px;
}

.btn-primary {
	padding: 0.7rem 1rem;
	border: none;
	border-radius: 8px;
	background: var(--color-primary, #4a90d9);
	color: #fff;
	font-size: 0.95rem;
	font-weight: 600;
	cursor: pointer;
	transition: opacity 0.15s;
}

.btn-primary:hover:not(:disabled) {
	opacity: 0.9;
}

.btn-primary:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.field-hint {
	font-size: 0.75rem;
	color: var(--color-text-secondary, #999);
	margin-top: 0.15rem;
	line-height: 1.4;
}
</style>
