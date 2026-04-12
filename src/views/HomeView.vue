<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import AppBar from "@/components/AppBar.vue";
import ListCard from "@/components/ListCard.vue";

const router = useRouter();
const appStore = useAppStore();

const showCreateForm = ref(false);
const showImportForm = ref(false);
const newListName = ref("");
const shareString = ref("");
const creating = ref(false);
const importing = ref(false);
const error = ref("");

function navigateToList(syncId: string) {
	router.push(`/list/${syncId}`);
}

function navigateToSettings() {
	router.push("/settings");
}

async function handleCreate() {
	const name = newListName.value.trim();
	if (!name) return;

	creating.value = true;
	error.value = "";
	try {
		await appStore.createList(name);
		newListName.value = "";
		showCreateForm.value = false;
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : "Failed to create list.";
	} finally {
		creating.value = false;
	}
}

async function handleImport() {
	const raw = shareString.value.trim();
	if (!raw) return;

	importing.value = true;
	error.value = "";
	try {
		await appStore.importList(raw);
		shareString.value = "";
		showImportForm.value = false;
	} catch (e: unknown) {
		error.value = e instanceof Error ? e.message : "Failed to import list.";
	} finally {
		importing.value = false;
	}
}

function openCreate() {
	showCreateForm.value = true;
	showImportForm.value = false;
	error.value = "";
}

function openImport() {
	showImportForm.value = true;
	showCreateForm.value = false;
	error.value = "";
}

function cancelForms() {
	showCreateForm.value = false;
	showImportForm.value = false;
	newListName.value = "";
	shareString.value = "";
	error.value = "";
}
</script>

<template>
	<div class="home-view">
		<AppBar title="Lists">
			<template #actions>
				<button
					class="btn-icon"
					aria-label="Settings"
					@click="navigateToSettings"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
							stroke="currentColor"
							stroke-width="1.5"
						/>
						<path
							d="M16.2 12.2a1.4 1.4 0 00.28 1.54l.05.05a1.7 1.7 0 11-2.4 2.4l-.05-.05a1.4 1.4 0 00-1.54-.28 1.4 1.4 0 00-.84 1.28v.16a1.7 1.7 0 11-3.4 0v-.08a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.54.28l-.05.05a1.7 1.7 0 11-2.4-2.4l.05-.05a1.4 1.4 0 00.28-1.54 1.4 1.4 0 00-1.28-.84H2.3a1.7 1.7 0 110-3.4h.08a1.4 1.4 0 001.28-.92 1.4 1.4 0 00-.28-1.54l-.05-.05a1.7 1.7 0 112.4-2.4l.05.05a1.4 1.4 0 001.54.28h.07a1.4 1.4 0 00.84-1.28V2.3a1.7 1.7 0 113.4 0v.08a1.4 1.4 0 00.84 1.28 1.4 1.4 0 001.54-.28l.05-.05a1.7 1.7 0 112.4 2.4l-.05.05a1.4 1.4 0 00-.28 1.54v.07a1.4 1.4 0 001.28.84h.16a1.7 1.7 0 110 3.4h-.08a1.4 1.4 0 00-1.28.84z"
							stroke="currentColor"
							stroke-width="1.5"
						/>
					</svg>
				</button>
			</template>
		</AppBar>

		<main class="home-content">
			<!-- Empty state -->
			<div
				v-if="appStore.lists.length === 0 && !showCreateForm && !showImportForm"
				class="empty-state"
			>
				<div class="empty-icon" aria-hidden="true">
					<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
						<rect
							x="8"
							y="6"
							width="32"
							height="36"
							rx="4"
							stroke="currentColor"
							stroke-width="2"
						/>
						<path
							d="M16 18H32M16 24H28M16 30H24"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</div>
				<h2 class="empty-title">No lists yet</h2>
				<p class="empty-text">
					Create a new list or import one from a friend to get started.
				</p>
			</div>

			<!-- List cards -->
			<div v-if="appStore.lists.length > 0" class="lists-grid">
				<ListCard
					v-for="creds in appStore.lists"
					:key="creds.syncId"
					:credentials="creds"
					@click="navigateToList(creds.syncId)"
				/>
			</div>

			<!-- Error message -->
			<p v-if="error" class="error-msg">{{ error }}</p>

			<!-- Create form -->
			<Transition name="form-fade">
				<form
					v-if="showCreateForm"
					class="inline-form"
					@submit.prevent="handleCreate"
				>
					<label class="form-label" for="new-list-name">New list name</label>
					<div class="form-row">
						<input
							id="new-list-name"
							v-model="newListName"
							type="text"
							class="input"
							placeholder="e.g. Weekly Groceries"
							autocomplete="off"
							autofocus
						/>
						<button
							type="submit"
							class="btn-primary"
							:disabled="!newListName.trim() || creating"
						>
							{{ creating ? "Creating…" : "Create" }}
						</button>
					</div>
					<button
						type="button"
						class="btn-ghost cancel-btn"
						@click="cancelForms"
					>
						Cancel
					</button>
				</form>
			</Transition>

			<!-- Import form -->
			<Transition name="form-fade">
				<form
					v-if="showImportForm"
					class="inline-form"
					@submit.prevent="handleImport"
				>
					<label class="form-label" for="share-string">Paste share link</label>
					<div class="form-row">
						<input
							id="share-string"
							v-model="shareString"
							type="text"
							class="input"
							placeholder="name|syncId|cryptKey|secret"
							autocomplete="off"
							autofocus
						/>
						<button
							type="submit"
							class="btn-primary"
							:disabled="!shareString.trim() || importing"
						>
							{{ importing ? "Importing…" : "Import" }}
						</button>
					</div>
					<button
						type="button"
						class="btn-ghost cancel-btn"
						@click="cancelForms"
					>
						Cancel
					</button>
				</form>
			</Transition>

			<!-- Action buttons -->
			<div v-if="!showCreateForm && !showImportForm" class="actions">
				<button class="btn-primary action-btn" @click="openCreate">
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M8 2V14M2 8H14"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
					Create List
				</button>
				<button class="btn action-btn" @click="openImport">
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2 10V13H14V10"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M8 2V10M5 7L8 10L11 7"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Import List
				</button>
			</div>
		</main>
	</div>
</template>

<style scoped>
.home-view {
	display: flex;
	flex-direction: column;
	min-height: 100dvh;
}

.home-content {
	flex: 1;
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

/* Empty state */
.empty-state {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 2rem 1rem;
	gap: 0.5rem;
}

.empty-icon {
	color: var(--color-text-secondary);
	opacity: 0.4;
	margin-bottom: 0.5rem;
}

.empty-title {
	font-size: 1.15rem;
	font-weight: 600;
	color: var(--color-text);
}

.empty-text {
	font-size: 0.875rem;
	color: var(--color-text-secondary);
	max-width: 280px;
	line-height: 1.5;
}

/* Lists grid */
.lists-grid {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

/* Error */
.error-msg {
	padding: 0.5rem 0.75rem;
	font-size: 0.85rem;
	color: var(--color-danger);
	background: var(--color-error-bg);
	border-radius: 8px;
}

/* Inline forms */
.inline-form {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 10px;
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.form-label {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--color-text-secondary);
	text-transform: uppercase;
	letter-spacing: 0.03em;
}

.form-row {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.form-row .input {
	flex: 1;
	min-width: 0;
}

.cancel-btn {
	align-self: flex-start;
	padding: 0.25rem 0;
	font-size: 0.8rem;
}

/* Action buttons */
.actions {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-top: 0.25rem;
}

.action-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	width: 100%;
	padding: 0.7rem 1rem;
	font-size: 0.9rem;
}

/* Transition */
.form-fade-enter-active,
.form-fade-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.form-fade-enter-from,
.form-fade-leave-to {
	opacity: 0;
	transform: translateY(-6px);
}
</style>
