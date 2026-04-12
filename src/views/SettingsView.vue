<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import AppBar from "@/components/AppBar.vue";

const router = useRouter();
const appStore = useAppStore();

const username = ref("");
const backendUrlOverride = ref("");
const theme = ref<"light" | "dark" | "auto">("auto");
const syncInterval = ref(30);

const copied = ref<string | null>(null);
const saved = ref(false);
const showResetConfirm = ref(false);

const envBackendUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

const effectiveBackendUrl = () => {
	const override = backendUrlOverride.value.trim();
	return override || envBackendUrl;
};

onMounted(() => {
	username.value = appStore.username;
	if (appStore.settings) {
		// Only show the override if it differs from the env default
		const stored = appStore.settings.backendUrl;
		if (stored && stored !== envBackendUrl) {
			backendUrlOverride.value = stored;
		}
		theme.value = appStore.settings.theme;
		syncInterval.value = appStore.settings.syncIntervalSeconds;
	}
});

async function handleSave() {
	if (!appStore.state) return;

	appStore.state.username = username.value.trim() || appStore.state.username;
	appStore.state.settings.backendUrl = effectiveBackendUrl();
	appStore.state.settings.theme = theme.value;
	appStore.state.settings.syncIntervalSeconds = Math.max(5, syncInterval.value);
	appStore.dirty = true;
	appStore.saveToLocalStorage();

	// Sync settings to backend
	appStore.syncToBackend().catch((e) => {
		console.warn("Settings sync failed:", e);
	});

	saved.value = true;
	setTimeout(() => {
		saved.value = false;
	}, 2000);
}

async function copyToClipboard(text: string, label: string) {
	try {
		await navigator.clipboard.writeText(text);
		copied.value = label;
		setTimeout(() => {
			copied.value = null;
		}, 1500);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		document.execCommand("copy");
		document.body.removeChild(ta);
		copied.value = label;
		setTimeout(() => {
			copied.value = null;
		}, 1500);
	}
}

function handleReset() {
	localStorage.clear();
	try {
		indexedDB.deleteDatabase("lists-app");
	} catch {
		// ignore
	}
	window.location.href = "/";
}
</script>

<template>
	<div class="settings-view">
		<AppBar title="Settings" :show-back="true">
			<template #actions>
				<button
					class="save-header-btn"
					:class="{ 'is-saved': saved }"
					@click="handleSave"
				>
					{{ saved ? "✓ Saved" : "Save" }}
				</button>
			</template>
		</AppBar>

		<div class="settings-content">
			<!-- Username -->
			<section class="settings-section">
				<label class="field-label" for="settings-username">Username</label>
				<input
					id="settings-username"
					v-model="username"
					type="text"
					class="input"
					placeholder="Your display name"
					autocomplete="username"
				/>
				<p class="field-hint">Shown on items you edit.</p>
			</section>

			<!-- Backend URL -->
			<section class="settings-section">
				<label class="field-label" for="settings-backend">Backend URL</label>
				<div class="backend-default">
					<span class="backend-default-label">Default:</span>
					<code class="backend-default-value">{{ envBackendUrl }}</code>
				</div>
				<input
					id="settings-backend"
					v-model="backendUrlOverride"
					type="url"
					class="input"
					:placeholder="`Using default: ${envBackendUrl}`"
				/>
				<p class="field-hint">
					Leave empty to use the default backend. Only set this if you run your
					own sync server at a different address.
				</p>
			</section>

			<!-- Theme -->
			<section class="settings-section">
				<label class="field-label" for="settings-theme">Theme</label>
				<select id="settings-theme" v-model="theme" class="select">
					<option value="auto">Auto (system)</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</section>

			<!-- Sync interval -->
			<section class="settings-section">
				<label class="field-label" for="settings-sync-interval"
					>Sync interval (seconds)</label
				>
				<input
					id="settings-sync-interval"
					v-model.number="syncInterval"
					type="number"
					class="input"
					min="5"
					max="3600"
					step="1"
				/>
				<p class="field-hint">
					How often lists sync with the backend. Minimum 5s.
				</p>
			</section>

			<!-- Save button (main) -->
			<section class="settings-section">
				<button
					class="btn-primary save-btn"
					:class="{ 'is-saved': saved }"
					@click="handleSave"
				>
					{{ saved ? "✓ Saved" : "Save Settings" }}
				</button>
			</section>

			<!-- App Credentials -->
			<section
				class="settings-section credentials-section"
				v-if="appStore.credentials"
			>
				<h2 class="section-heading">App Credentials</h2>
				<p class="field-hint">
					Save this string somewhere safe. You can use it to restore your app on
					another device.
				</p>

				<div class="credential-display">
					<code class="credential-string">{{ appStore.credentialString }}</code>
					<button
						class="copy-btn"
						:class="{ copied: copied === 'app-creds' }"
						@click="copyToClipboard(appStore.credentialString, 'app-creds')"
					>
						{{ copied === "app-creds" ? "✓ Copied" : "Copy" }}
					</button>
				</div>
			</section>

			<!-- Danger zone -->
			<section class="settings-section danger-section">
				<h2 class="section-heading danger-heading">Danger Zone</h2>
				<p class="field-hint">
					This will permanently delete all local data and cannot be undone.
				</p>

				<button
					v-if="!showResetConfirm"
					class="btn-danger"
					@click="showResetConfirm = true"
				>
					Reset App
				</button>

				<div v-else class="reset-confirm">
					<p class="reset-warning">
						Are you sure? All local data will be lost.
					</p>
					<div class="reset-actions">
						<button class="btn-danger" @click="handleReset">
							Yes, Reset Everything
						</button>
						<button class="btn" @click="showResetConfirm = false">
							Cancel
						</button>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>

<style scoped>
.settings-view {
	display: flex;
	flex-direction: column;
	min-height: 100dvh;
}

.settings-content {
	flex: 1;
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.settings-section {
	padding: 0.75rem 0;
}

.settings-section + .settings-section {
	border-top: 1px solid var(--color-border);
}

.section-heading {
	font-size: 0.95rem;
	font-weight: 600;
	margin-bottom: 0.35rem;
	color: var(--color-text);
}

.field-label {
	display: block;
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--color-text);
	margin-bottom: 0.3rem;
}

.field-hint {
	font-size: 0.75rem;
	color: var(--color-text-secondary);
	margin-top: 0.3rem;
	line-height: 1.4;
}

.backend-default {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	margin-bottom: 0.4rem;
}

.backend-default-label {
	font-size: 0.75rem;
	color: var(--color-text-secondary);
	font-weight: 500;
}

.backend-default-value {
	font-size: 0.75rem;
	font-family: "SF Mono", "Fira Code", "Consolas", monospace;
	color: var(--color-text);
	background: var(--color-bg);
	padding: 0.15rem 0.4rem;
	border-radius: 4px;
	border: 1px solid var(--color-border);
}

.input {
	display: block;
	width: 100%;
	padding: 0.55rem 0.75rem;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	color: var(--color-text);
	font-size: 0.9rem;
	line-height: 1.4;
	outline: none;
	transition: border-color 0.15s ease;
}

.input:focus {
	border-color: var(--color-primary);
}

.input::placeholder {
	color: var(--color-text-secondary);
	opacity: 0.7;
}

.select {
	display: block;
	width: 100%;
	padding: 0.55rem 0.75rem;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	color: var(--color-text);
	font-size: 0.9rem;
	line-height: 1.4;
	outline: none;
	transition: border-color 0.15s;
}

.select:focus {
	border-color: var(--color-primary);
}

/* Hide number spinners */
.input[type="number"]::-webkit-inner-spin-button,
.input[type="number"]::-webkit-outer-spin-button {
	-webkit-appearance: none;
	margin: 0;
}

.input[type="number"] {
	-moz-appearance: textfield;
}

.save-btn {
	width: 100%;
	padding: 0.7rem 1rem;
}

.save-btn.is-saved {
	background: var(--color-success);
}

.save-header-btn {
	padding: 0.35rem 0.75rem;
	border: none;
	border-radius: 6px;
	background: var(--color-primary);
	color: #ffffff;
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition:
		background 0.15s,
		opacity 0.15s;
	-webkit-tap-highlight-color: transparent;
}

.save-header-btn:hover {
	opacity: 0.9;
}

.save-header-btn.is-saved {
	background: var(--color-success);
}

/* Credentials */
.credentials-section {
	padding-top: 1rem;
}

.credential-display {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-top: 0.6rem;
	background: var(--color-bg);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	padding: 0.6rem 0.75rem;
}

.credential-string {
	flex: 1;
	min-width: 0;
	font-size: 0.75rem;
	font-family: "SF Mono", "Fira Code", "Consolas", monospace;
	color: var(--color-text);
	word-break: break-all;
	line-height: 1.5;
	user-select: all;
}

.copy-btn {
	flex-shrink: 0;
	padding: 0.2rem 0.5rem;
	border: 1px solid var(--color-border);
	border-radius: 4px;
	background: var(--color-surface);
	color: var(--color-text-secondary);
	font-size: 0.7rem;
	font-weight: 500;
	cursor: pointer;
	transition:
		background 0.15s,
		color 0.15s;
	-webkit-tap-highlight-color: transparent;
}

.copy-btn:hover {
	background: var(--color-hover);
	color: var(--color-text);
}

.copy-btn.copied {
	color: var(--color-success);
	border-color: var(--color-success);
}

/* Danger zone */
.danger-section {
	margin-top: 0.5rem;
}

.danger-heading {
	color: var(--color-danger);
}

.reset-confirm {
	margin-top: 0.5rem;
}

.reset-warning {
	font-size: 0.85rem;
	font-weight: 600;
	color: var(--color-danger);
	margin-bottom: 0.5rem;
}

.reset-actions {
	display: flex;
	gap: 0.5rem;
}
</style>
