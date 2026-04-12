<script setup lang="ts">
import { ref, watch, nextTick } from "vue";

const props = withDefaults(
	defineProps<{
		open: boolean;
		title: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: "danger" | "default";
	}>(),
	{
		confirmLabel: "Confirm",
		cancelLabel: "Cancel",
		variant: "danger",
	},
);

const emit = defineEmits<{
	confirm: [];
	cancel: [];
}>();

const cancelBtnRef = ref<HTMLButtonElement | null>(null);

watch(
	() => props.open,
	async (isOpen) => {
		if (isOpen) {
			await nextTick();
			cancelBtnRef.value?.focus();
		}
	},
);
</script>

<template>
	<Teleport to="body">
		<Transition name="confirm-dialog">
			<div v-if="open" class="confirm-dialog-backdrop" @click.self="emit('cancel')">
				<div
					class="confirm-dialog-card"
					role="dialog"
					aria-modal="true"
					:aria-label="title"
				>
					<h2 class="confirm-dialog-title">{{ title }}</h2>

					<div class="confirm-dialog-body">
						<slot />
					</div>

					<div class="confirm-dialog-actions">
						<button
							ref="cancelBtnRef"
							class="btn-ghost"
							@click="emit('cancel')"
						>
							{{ cancelLabel }}
						</button>
						<button
							:class="variant === 'danger' ? 'btn-danger' : 'btn-primary'"
							@click="emit('confirm')"
						>
							{{ confirmLabel }}
						</button>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.confirm-dialog-backdrop {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.45);
	z-index: 1000;
	padding: 1rem;
}

.confirm-dialog-card {
	width: 100%;
	max-width: 340px;
	background: var(--color-surface, #ffffff);
	border: 1px solid var(--color-border, #dddddd);
	border-radius: var(--radius-lg, 12px);
	padding: 1.5rem;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}

.confirm-dialog-title {
	font-size: 1.05rem;
	font-weight: 600;
	color: var(--color-text, #1a1a1a);
	line-height: 1.3;
	margin: 0;
}

.confirm-dialog-body {
	font-size: 0.9rem;
	color: var(--color-text-secondary, #666666);
	line-height: 1.5;
}

.confirm-dialog-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5rem;
	margin-top: 0.25rem;
}

/* Transition: backdrop fades, card scales+fades */
.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
	transition: opacity 0.2s ease;
}

.confirm-dialog-enter-active .confirm-dialog-card,
.confirm-dialog-leave-active .confirm-dialog-card {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
	opacity: 0;
}

.confirm-dialog-enter-from .confirm-dialog-card,
.confirm-dialog-leave-to .confirm-dialog-card {
	opacity: 0;
	transform: scale(0.95);
}
</style>
