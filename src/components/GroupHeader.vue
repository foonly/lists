<script setup lang="ts">
defineProps<{
	name: string;
	/** Show a remove button (for empty groups kept visible on this device). */
	removable?: boolean;
}>();

const emit = defineEmits<{
	add: [];
	remove: [];
}>();
</script>

<template>
	<div class="group-header">
		<span class="group-name">{{ name }}</span>
		<hr class="group-rule" />
		<button
			v-if="removable"
			class="header-btn remove-btn"
			:aria-label="`Remove empty group ${name}`"
			title="Remove empty group"
			@click="emit('remove')"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M4 4L12 12M12 4L4 12"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
		<button
			class="header-btn add-inline-btn"
			aria-label="Add item to this group"
			@click="emit('add')"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M8 3V13M3 8H13"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.group-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0 0.25rem;
	margin-top: 0.75rem;
}

.group-header:first-child {
	margin-top: 0;
}

.group-name {
	font-size: 0.75rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--color-primary, #4a90d9);
	white-space: nowrap;
	flex-shrink: 0;
}

.group-rule {
	flex: 1;
	border: none;
	border-top: 1px solid var(--color-border, #e0e0e0);
}

.header-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 1.5rem;
	height: 1.5rem;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-primary);
	cursor: pointer;
	border-radius: 4px;
	transition: background-color 0.15s;
	flex-shrink: 0;
}

.header-btn:hover {
	background: var(--color-hover);
}

.remove-btn {
	color: var(--color-text-secondary);
}

.remove-btn:hover {
	color: var(--color-danger);
}
</style>
