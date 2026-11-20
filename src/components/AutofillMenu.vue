<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { Suggestion } from "@/stores/local-memory";

const props = defineProps<{
	suggestions: Suggestion[];
	activeIndex: number;
	/** Show each suggestion's group (used when entering ungrouped). */
	showGroups: boolean;
	placement?: "above" | "below";
}>();

const emit = defineEmits<{
	pick: [suggestion: Suggestion];
}>();

const menuEl = ref<HTMLElement | null>(null);

// A menu opening below an input near the bottom of the scrolling list would be
// cut off; scroll just enough to show it.
watch(
	() => props.suggestions.length,
	async (count, prev) => {
		if (count === 0 || count === prev || props.placement === "above") return;
		await nextTick();
		menuEl.value?.scrollIntoView({ block: "nearest" });
	},
);
</script>

<template>
	<ul
		v-if="suggestions.length > 0"
		ref="menuEl"
		class="autofill-menu"
		:class="placement ?? 'below'"
		role="listbox"
	>
		<!-- mousedown.prevent keeps focus (and the edit) in the input -->
		<li
			v-for="(s, i) in suggestions"
			:key="s.text"
			class="autofill-option"
			:class="{ active: i === activeIndex }"
			role="option"
			:aria-selected="i === activeIndex"
			@mousedown.prevent
			@click="emit('pick', s)"
		>
			<span class="autofill-text">{{ s.text }}</span>
			<span v-if="showGroups && s.group" class="autofill-group">{{
				s.group
			}}</span>
		</li>
	</ul>
</template>

<style scoped>
.autofill-menu {
	position: absolute;
	left: 0;
	right: 0;
	z-index: 50;
	list-style: none;
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: var(--radius-md);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
	overflow: hidden;
}

.autofill-menu.below {
	top: calc(100% + 4px);
}

.autofill-menu.above {
	bottom: calc(100% + 4px);
}

.autofill-option {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.6rem 0.75rem;
	font-size: 0.9rem;
	color: var(--color-text);
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}

.autofill-option + .autofill-option {
	border-top: 1px solid var(--color-border);
}

.autofill-option:hover,
.autofill-option.active {
	background: var(--color-hover);
}

.autofill-text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.autofill-group {
	flex-shrink: 0;
	font-size: 0.7rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	color: var(--color-text-secondary);
}
</style>
