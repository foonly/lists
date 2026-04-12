<script setup lang="ts">
import { ref, nextTick, watch } from "vue";

const props = defineProps<{
	groups: string[];
	editItem?: {
		id: string;
		text: string;
		quantity: number | null;
		unit: string | null;
		group: string | null;
	} | null;
}>();

const emit = defineEmits<{
	add: [
		payload: { text: string; quantity?: number; unit?: string; group?: string },
	];
	update: [
		payload: {
			id: string;
			text: string;
			quantity: number | null;
			unit: string | null;
			group: string | null;
		},
	];
	"cancel-edit": [];
}>();

const text = ref("");
const quantity = ref<string>("");
const unit = ref("");
const group = ref("");
const expanded = ref(false);

const textInput = ref<HTMLInputElement | null>(null);

function clearForm() {
	text.value = "";
	quantity.value = "";
	unit.value = "";
	group.value = "";
	expanded.value = false;
}

function handleCancel() {
	clearForm();
	emit("cancel-edit");
}

function handleEscape(e: KeyboardEvent) {
	if (props.editItem && e.key === "Escape") {
		handleCancel();
	}
}

watch(
	() => props.editItem,
	(item) => {
		if (item) {
			text.value = item.text;
			quantity.value = item.quantity !== null ? String(item.quantity) : "";
			unit.value = item.unit ?? "";
			group.value = item.group ?? "";
			expanded.value = true;
			nextTick(() => textInput.value?.focus());
		} else {
			clearForm();
		}
	},
	{ immediate: true },
);

function handleSubmit() {
	const trimmedText = text.value.trim();
	if (!trimmedText) return;

	const parsedQty = parseFloat(quantity.value);
	const trimmedUnit = unit.value.trim();
	const trimmedGroup = group.value.trim();

	if (props.editItem) {
		emit("update", {
			id: props.editItem.id,
			text: trimmedText,
			quantity: !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : null,
			unit: trimmedUnit || null,
			group: trimmedGroup || null,
		});
	} else {
		const payload: {
			text: string;
			quantity?: number;
			unit?: string;
			group?: string;
		} = {
			text: trimmedText,
		};

		if (!isNaN(parsedQty) && parsedQty > 0) {
			payload.quantity = parsedQty;
		}

		if (trimmedUnit) {
			payload.unit = trimmedUnit;
		}

		if (trimmedGroup) {
			payload.group = trimmedGroup;
		}

		emit("add", payload);
	}

	clearForm();

	nextTick(() => {
		textInput.value?.focus();
	});
}

function toggleExpanded() {
	expanded.value = !expanded.value;
}
</script>

<template>
	<form
		class="item-editor"
		:class="{ editing: editItem }"
		@submit.prevent="handleSubmit"
		@keydown="handleEscape"
	>
		<!-- Edit mode banner -->
		<div v-if="editItem" class="edit-banner">
			<span class="edit-label">Editing item</span>
			<button type="button" class="cancel-link" @click="handleCancel">
				Cancel
			</button>
		</div>

		<div class="editor-main-row">
			<input
				ref="textInput"
				v-model="text"
				type="text"
				class="editor-input text-input"
				:placeholder="editItem ? 'Item text…' : 'Add an item…'"
				autocomplete="off"
				autofocus
			/>
			<button
				v-if="!editItem"
				type="button"
				class="expand-btn"
				:class="{ active: expanded }"
				aria-label="More options"
				@click="toggleExpanded"
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 18 18"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M9 3V15M3 9H15"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</button>
			<button type="submit" class="add-btn" :disabled="!text.trim()">
				{{ editItem ? "Save" : "Add" }}
			</button>
		</div>

		<Transition name="options-slide">
			<div v-if="expanded || editItem" class="editor-options">
				<div class="option-row">
					<div class="option-field qty-field">
						<label class="option-label" for="editor-qty">Qty</label>
						<input
							id="editor-qty"
							v-model="quantity"
							type="number"
							class="editor-input"
							placeholder="1"
							min="0"
							step="any"
							inputmode="decimal"
						/>
					</div>
					<div class="option-field unit-field">
						<label class="option-label" for="editor-unit">Unit</label>
						<input
							id="editor-unit"
							v-model="unit"
							type="text"
							class="editor-input"
							placeholder="kg, pcs…"
							autocomplete="off"
						/>
					</div>
					<div class="option-field group-field">
						<label class="option-label" for="editor-group">Group</label>
						<input
							id="editor-group"
							v-model="group"
							type="text"
							class="editor-input"
							placeholder="Produce…"
							list="group-suggestions"
							autocomplete="off"
						/>
						<datalist id="group-suggestions">
							<option v-for="g in groups" :key="g" :value="g" />
						</datalist>
					</div>
				</div>
			</div>
		</Transition>
	</form>
</template>

<style scoped>
.item-editor {
	background: var(--color-surface);
	border-top: 1px solid var(--color-border);
	padding: 0.75rem 1rem;
	flex-shrink: 0;
}

.item-editor.editing {
	border-top-color: var(--color-primary);
	box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);
}

.edit-banner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-bottom: 0.5rem;
}

.edit-label {
	font-size: 0.75rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	color: var(--color-primary);
}

.cancel-link {
	border: none;
	background: none;
	color: var(--color-text-secondary);
	font-size: 0.8rem;
	cursor: pointer;
	padding: 0.2rem 0.4rem;
	border-radius: 4px;
}

.cancel-link:hover {
	color: var(--color-text);
	background: var(--color-hover);
}

.editor-main-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.editor-input {
	padding: 0.55rem 0.7rem;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	font-size: 0.9rem;
	background: var(--color-bg);
	color: var(--color-text);
	outline: none;
	transition: border-color 0.15s;
	width: 100%;
}

.editor-input:focus {
	border-color: var(--color-primary);
}

.editor-input::placeholder {
	color: var(--color-text-secondary);
}

.text-input {
	flex: 1;
	min-width: 0;
}

.expand-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	padding: 0;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-bg);
	color: var(--color-text-secondary);
	cursor: pointer;
	flex-shrink: 0;
	transition:
		background 0.15s,
		color 0.15s,
		transform 0.2s;
	-webkit-tap-highlight-color: transparent;
}

.expand-btn:hover {
	background: var(--color-hover);
}

.expand-btn.active {
	color: var(--color-primary);
	transform: rotate(45deg);
}

.add-btn {
	padding: 0.55rem 1rem;
	border: none;
	border-radius: 8px;
	background: var(--color-primary);
	color: #ffffff;
	font-size: 0.9rem;
	font-weight: 600;
	cursor: pointer;
	flex-shrink: 0;
	transition: opacity 0.15s;
	-webkit-tap-highlight-color: transparent;
}

.add-btn:hover:not(:disabled) {
	opacity: 0.9;
}

.add-btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.editor-options {
	padding-top: 0.6rem;
	overflow: hidden;
}

.option-row {
	display: flex;
	gap: 0.5rem;
}

.option-field {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.qty-field {
	flex: 0 0 4rem;
}

.unit-field {
	flex: 0 0 5rem;
}

.group-field {
	flex: 1;
	min-width: 0;
}

.option-label {
	font-size: 0.7rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	color: var(--color-text-secondary);
	padding-left: 0.15rem;
}

/* Hide number input spinners */
.editor-input[type="number"]::-webkit-inner-spin-button,
.editor-input[type="number"]::-webkit-outer-spin-button {
	-webkit-appearance: none;
	margin: 0;
}

.editor-input[type="number"] {
	-moz-appearance: textfield;
}

.options-slide-enter-active,
.options-slide-leave-active {
	transition:
		max-height 0.2s ease,
		opacity 0.2s ease;
	max-height: 80px;
}

.options-slide-enter-from,
.options-slide-leave-to {
	max-height: 0;
	opacity: 0;
}
</style>
