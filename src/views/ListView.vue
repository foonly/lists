<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListStore } from "@/stores/list";
import { useAppStore } from "@/stores/app";
import { encodeShareString } from "@/models/app-state";
import type { ListCredentials } from "@/models/app-state";
import type { ListItem } from "@/models/list";
import Sortable from "sortablejs";
import type { SortableEvent } from "sortablejs";
import AppBar from "@/components/AppBar.vue";
import SyncStatus from "@/components/SyncStatus.vue";
import GroupHeader from "@/components/GroupHeader.vue";
import ListItemRow from "@/components/ListItemRow.vue";
import ListItemEditor from "@/components/ListItemEditor.vue";

const route = useRoute();
const router = useRouter();
const listStore = useListStore();
const appStore = useAppStore();

const creds = ref<ListCredentials | null>(null);
const editingName = ref(false);
const nameInput = ref("");
const nameInputEl = ref<HTMLInputElement | null>(null);
const showDone = ref(false);
const toastMessage = ref("");
const toastTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

// Editing state
const editingItemId = ref<string | null>(null);

const editingItem = computed(() => {
	if (!editingItemId.value) return null;
	const item = listStore.blob?.items.find((i) => i.id === editingItemId.value);
	if (!item) return null;
	return {
		id: item.id,
		text: item.text.value,
		quantity: item.quantity.value,
		unit: item.unit.value,
		group: item.group.value,
	};
});

function handleEdit(id: string) {
	editingItemId.value = id;
	listStore.editing = true;
}

function handleCancelEdit() {
	editingItemId.value = null;
	listStore.editing = false;
}

async function handleUpdate(payload: {
	id: string;
	text: string;
	quantity: number | null;
	unit: string | null;
	group: string | null;
}) {
	await listStore.updateItem(payload.id, {
		text: payload.text,
		quantity: payload.quantity,
		unit: payload.unit,
		group: payload.group,
	});
	editingItemId.value = null;
	listStore.editing = false;
}

const syncId = computed(() => route.params.syncId as string);

const listName = computed(() => creds.value?.name ?? "List");

// Group active items by their group field
const groupedActiveItems = computed(() => {
	const groups = new Map<string, ListItem[]>();
	for (const item of listStore.activeItems) {
		const groupName = item.group.value ?? "";
		if (!groups.has(groupName)) {
			groups.set(groupName, []);
		}
		groups.get(groupName)!.push(item);
	}
	return groups;
});

const groupedStaleItems = computed(() => {
	const groups = new Map<string, ListItem[]>();
	for (const item of listStore.staleItems) {
		const groupName = item.group.value ?? "";
		if (!groups.has(groupName)) {
			groups.set(groupName, []);
		}
		groups.get(groupName)!.push(item);
	}
	return groups;
});

const groupedDoneItems = computed(() => {
	const groups = new Map<string, ListItem[]>();
	for (const item of listStore.doneItems) {
		const groupName = item.group.value ?? "";
		if (!groups.has(groupName)) {
			groups.set(groupName, []);
		}
		groups.get(groupName)!.push(item);
	}
	return groups;
});

const hasStaleItems = computed(() => listStore.staleItems.length > 0);
const hasDoneItems = computed(() => listStore.doneItems.length > 0);
const hasAnyItems = computed(() => listStore.items.length > 0);

function getChecksumMatch(item: ListItem): boolean | null {
	if (item.done.value === null) return null;
	const cached = listStore.checksumCache.get(item.id);
	if (cached === undefined) return null;
	return item.done.value === cached;
}

function showToast(message: string, duration = 2000) {
	toastMessage.value = message;
	if (toastTimeout.value) clearTimeout(toastTimeout.value);
	toastTimeout.value = setTimeout(() => {
		toastMessage.value = "";
	}, duration);
}

async function handleShare() {
	if (!creds.value) return;
	const shareString = encodeShareString(creds.value);
	try {
		await navigator.clipboard.writeText(shareString);
		showToast("Copied!");
	} catch {
		showToast("Failed to copy");
	}
}

function startEditName() {
	nameInput.value = listName.value;
	editingName.value = true;
	setTimeout(() => {
		nameInputEl.value?.focus();
		nameInputEl.value?.select();
	}, 0);
}

function saveName() {
	editingName.value = false;
	const newName = nameInput.value.trim();
	if (newName && newName !== listName.value && creds.value) {
		appStore.updateListName(creds.value.syncId, newName);
		creds.value = { ...creds.value, name: newName };
	}
}

function cancelEditName() {
	editingName.value = false;
}

function handleNameKeydown(e: KeyboardEvent) {
	if (e.key === "Enter") {
		saveName();
	} else if (e.key === "Escape") {
		cancelEditName();
	}
}

async function handleSync() {
	await listStore.sync();
}

async function handleToggleDone(id: string) {
	await listStore.toggleDone(id);
}

async function handleDelete(id: string) {
	await listStore.toggleDelete(id);
}

async function handleAdd(payload: {
	text: string;
	quantity?: number;
	unit?: string;
	group?: string;
}) {
	await listStore.addItem(payload.text, {
		quantity: payload.quantity,
		unit: payload.unit,
		group: payload.group,
	});
}

// ---------------------------------------------------------------------------
// Drag & drop — per-group sortable instances
// ---------------------------------------------------------------------------

const groupRefs = new Map<string, HTMLElement>();
const sortableInstances = new Map<string, Sortable>();

function setGroupRef(groupName: string, el: unknown) {
	if (el instanceof HTMLElement) {
		groupRefs.set(groupName, el);
	} else {
		groupRefs.delete(groupName);
	}
}

function initSortables() {
	// Destroy old instances
	for (const [, instance] of sortableInstances) {
		instance.destroy();
	}
	sortableInstances.clear();

	// Create new instances for each group container
	for (const [groupName, el] of groupRefs) {
		const instance = Sortable.create(el, {
			group: "list-items",
			handle: ".drag-handle",
			ghostClass: "sortable-ghost",
			chosenClass: "sortable-chosen",
			dragClass: "sortable-drag",
			animation: 150,
			onEnd(evt: SortableEvent) {
				const itemId = evt.item.dataset.id;
				if (!itemId) return;

				const fromGroup = (evt.from as HTMLElement).dataset.group ?? "";
				const toGroup = (evt.to as HTMLElement).dataset.group ?? "";
				const oldIndex = evt.oldIndex ?? 0;
				const newIndex = evt.newIndex ?? 0;

				// Revert the DOM mutation — Vue will re-render from reactive data.
				evt.item.remove();
				const refChild = evt.from.children[oldIndex];
				evt.from.insertBefore(evt.item, refChild || null);

				// Convert empty string back to null for the ungrouped group
				const targetGroup = toGroup || null;
				listStore.reorderItem(itemId, targetGroup, newIndex);
			},
		});
		sortableInstances.set(groupName, instance);
	}
}

function destroySortables() {
	for (const [, instance] of sortableInstances) {
		instance.destroy();
	}
	sortableInstances.clear();
}

// Re-initialize sortables when the grouped items change (groups added/removed)
watch(
	groupedActiveItems,
	() => {
		nextTick(() => initSortables());
	},
	{ flush: "post" },
);

onMounted(async () => {
	const found = appStore.lists.find((l) => l.syncId === syncId.value);
	if (!found) {
		router.replace("/");
		return;
	}
	creds.value = found;
	await listStore.openList(found);
	appStore.touchList(syncId.value);

	nextTick(() => initSortables());
});

onUnmounted(async () => {
	destroySortables();
	await listStore.closeList();
});

// Update creds if the store's list data changes (e.g. after name update)
watch(
	() => appStore.lists.find((l) => l.syncId === syncId.value),
	(updated) => {
		if (updated) creds.value = updated;
	},
);
</script>

<template>
	<div class="list-view">
		<AppBar :title="listName" show-back>
			<template #title>
				<template v-if="editingName">
					<input
						ref="nameInputEl"
						v-model="nameInput"
						class="name-edit-input"
						type="text"
						@blur="saveName"
						@keydown="handleNameKeydown"
					/>
				</template>
				<h1 v-else class="name-display" @click="startEditName">
					{{ listName }}
				</h1>
			</template>
			<template #actions>
				<SyncStatus
					:status="listStore.syncMeta.status"
					:last-synced-at="listStore.syncMeta.lastSyncedAt"
					:error="listStore.syncMeta.error"
				/>
				<button class="btn-icon" aria-label="Sync" @click="handleSync">
					<svg
						width="18"
						height="18"
						viewBox="0 0 18 18"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2.5 9A6.5 6.5 0 0 1 14.35 5M15.5 9A6.5 6.5 0 0 1 3.65 13"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
						<path
							d="M14.35 2V5H11.35"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M3.65 16V13H6.65"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
				<button class="btn-icon" aria-label="Share list" @click="handleShare">
					<svg
						width="18"
						height="18"
						viewBox="0 0 18 18"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M6.75 8.25L11.25 5.75M6.75 9.75L11.25 12.25"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
						<circle
							cx="5"
							cy="9"
							r="2"
							stroke="currentColor"
							stroke-width="1.5"
						/>
						<circle
							cx="13"
							cy="4.5"
							r="2"
							stroke="currentColor"
							stroke-width="1.5"
						/>
						<circle
							cx="13"
							cy="13.5"
							r="2"
							stroke="currentColor"
							stroke-width="1.5"
						/>
					</svg>
				</button>
			</template>
		</AppBar>

		<!-- Main items area -->
		<div class="items-container">
			<!-- Empty state -->
			<div v-if="!hasAnyItems" class="empty-state">
				<p class="empty-icon">📝</p>
				<p class="empty-title">No items yet</p>
				<p class="empty-hint">Add your first item below</p>
			</div>

			<template v-else>
				<!-- Active items -->
				<section v-if="listStore.activeItems.length > 0" class="items-section">
					<template
						v-for="[groupName, items] in groupedActiveItems"
						:key="'active-' + groupName"
					>
						<GroupHeader v-if="groupName" :name="groupName" />
						<div
							:ref="(el) => setGroupRef(groupName, el)"
							class="sortable-group"
							:data-group="groupName"
						>
							<div
								v-for="item in items"
								:key="item.id"
								class="sortable-item"
								:data-id="item.id"
							>
								<div class="drag-handle" aria-label="Drag to reorder">
									<svg
										width="12"
										height="18"
										viewBox="0 0 12 18"
										fill="none"
										aria-hidden="true"
									>
										<circle cx="3" cy="3" r="1.5" fill="currentColor" />
										<circle cx="9" cy="3" r="1.5" fill="currentColor" />
										<circle cx="3" cy="9" r="1.5" fill="currentColor" />
										<circle cx="9" cy="9" r="1.5" fill="currentColor" />
										<circle cx="3" cy="15" r="1.5" fill="currentColor" />
										<circle cx="9" cy="15" r="1.5" fill="currentColor" />
									</svg>
								</div>
								<ListItemRow
									:item="item"
									:checksum-match="getChecksumMatch(item)"
									@toggle-done="handleToggleDone(item.id)"
									@delete="handleDelete(item.id)"
									@edit="handleEdit(item.id)"
								/>
							</div>
						</div>
					</template>
				</section>

				<!-- Stale items -->
				<section v-if="hasStaleItems" class="items-section stale-section">
					<div class="section-label warning-label">
						<svg
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M7 1L13 12H1L7 1Z"
								stroke="currentColor"
								stroke-width="1.2"
								stroke-linejoin="round"
							/>
							<path
								d="M7 5.5V8"
								stroke="currentColor"
								stroke-width="1.2"
								stroke-linecap="round"
							/>
							<circle cx="7" cy="10" r="0.5" fill="currentColor" />
						</svg>
						Changed since checked off
					</div>
					<template
						v-for="[groupName, items] in groupedStaleItems"
						:key="'stale-' + groupName"
					>
						<GroupHeader v-if="groupName" :name="groupName" />
						<ListItemRow
							v-for="item in items"
							:key="item.id"
							:item="item"
							:checksum-match="getChecksumMatch(item)"
							@toggle-done="handleToggleDone(item.id)"
							@delete="handleDelete(item.id)"
							@edit="handleEdit(item.id)"
						/>
					</template>
				</section>

				<!-- Done items (collapsible) -->
				<section v-if="hasDoneItems" class="items-section done-section">
					<button class="section-toggle" @click="showDone = !showDone">
						<svg
							class="toggle-chevron"
							:class="{ open: showDone }"
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M5 3L10 7L5 11"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						Done ({{ listStore.doneItems.length }})
					</button>

					<Transition name="done-expand">
						<div v-if="showDone" class="done-items-list">
							<template
								v-for="[groupName, items] in groupedDoneItems"
								:key="'done-' + groupName"
							>
								<GroupHeader v-if="groupName" :name="groupName" />
								<ListItemRow
									v-for="item in items"
									:key="item.id"
									:item="item"
									:checksum-match="getChecksumMatch(item)"
									@toggle-done="handleToggleDone(item.id)"
									@delete="handleDelete(item.id)"
									@edit="handleEdit(item.id)"
								/>
							</template>
						</div>
					</Transition>
				</section>
			</template>
		</div>

		<!-- Editor at bottom -->
		<ListItemEditor
			:groups="listStore.groups"
			:edit-item="editingItem"
			@add="handleAdd"
			@update="handleUpdate"
			@cancel-edit="handleCancelEdit"
		/>

		<!-- Toast -->
		<Transition name="toast-fade">
			<div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
		</Transition>
	</div>
</template>

<style scoped>
.list-view {
	display: flex;
	flex-direction: column;
	height: 100dvh;
	overflow: hidden;
	position: relative;
}

.name-display {
	font-size: 1.125rem;
	font-weight: 600;
	text-align: center;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	line-height: 1.3;
	margin: 0;
	cursor: pointer;
}

.name-edit-input {
	width: 100%;
	font-size: 1.125rem;
	font-weight: 600;
	text-align: center;
	padding: 0.15rem 0.5rem;
	border: 1px solid var(--color-primary);
	border-radius: 6px;
	background: var(--color-surface);
	color: var(--color-text);
	outline: none;
	font-family: inherit;
}

.items-container {
	flex: 1;
	min-height: 0;
	padding: 0 1rem 1rem;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
}

.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 3rem 1rem;
	text-align: center;
}

.empty-icon {
	font-size: 2.5rem;
	margin-bottom: 0.5rem;
}

.empty-title {
	font-size: 1.05rem;
	font-weight: 600;
	color: var(--color-text);
	margin-bottom: 0.25rem;
}

.empty-hint {
	font-size: 0.85rem;
	color: var(--color-text-secondary);
}

.items-section {
	margin-bottom: 0.5rem;
}

.section-label {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.5rem 0 0.3rem;
	font-size: 0.75rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
}

.warning-label {
	color: var(--color-warning);
}

.section-toggle {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.6rem 0;
	background: none;
	border: none;
	color: var(--color-text-secondary);
	font-size: 0.85rem;
	font-weight: 600;
	cursor: pointer;
	font-family: inherit;
	-webkit-tap-highlight-color: transparent;
}

.section-toggle:hover {
	color: var(--color-text);
}

.toggle-chevron {
	transition: transform 0.2s ease;
	flex-shrink: 0;
}

.toggle-chevron.open {
	transform: rotate(90deg);
}

.done-items-list {
	overflow: hidden;
}

/* Sortable / drag & drop styles */
.sortable-group {
	min-height: 2rem;
}

.sortable-item {
	display: flex;
	align-items: flex-start;
}

.sortable-item :deep(.list-item-row) {
	flex: 1;
	min-width: 0;
}

.drag-handle {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 1.5rem;
	flex-shrink: 0;
	cursor: grab;
	color: var(--color-text-secondary);
	opacity: 0.4;
	padding-top: 0.7rem;
	touch-action: none;
	-webkit-tap-highlight-color: transparent;
}

.drag-handle:hover {
	opacity: 0.8;
}

.drag-handle:active {
	cursor: grabbing;
}

.sortable-ghost {
	opacity: 0.4;
	background: var(--color-primary);
	border-radius: 6px;
}

.sortable-chosen {
	background: var(--color-surface);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	border-radius: 6px;
}

.sortable-drag {
	opacity: 0.9;
}

/* Toast */
.toast {
	position: absolute;
	bottom: 4.5rem;
	left: 50%;
	transform: translateX(-50%);
	padding: 0.5rem 1.25rem;
	background: var(--color-text);
	color: var(--color-bg);
	border-radius: 20px;
	font-size: 0.85rem;
	font-weight: 500;
	z-index: 200;
	pointer-events: none;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.toast-fade-enter-from {
	opacity: 0;
	transform: translateX(-50%) translateY(8px);
}

.toast-fade-leave-to {
	opacity: 0;
	transform: translateX(-50%) translateY(-4px);
}

/* Done section expand */
.done-expand-enter-active,
.done-expand-leave-active {
	transition:
		max-height 0.25s ease,
		opacity 0.2s ease;
	max-height: 2000px;
}

.done-expand-enter-from,
.done-expand-leave-to {
	max-height: 0;
	opacity: 0;
}
</style>
