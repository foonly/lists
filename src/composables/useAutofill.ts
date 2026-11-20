import { computed, ref, type Ref } from "vue";
import { useLocalMemoryStore, type Suggestion } from "@/stores/local-memory";
import { useListStore } from "@/stores/list";

/**
 * Autofill suggestions for an item text input.
 *
 * @param text  the text being typed
 * @param group the group the item is entered under (null = ungrouped, which
 *              suggests from every group)
 * @param itemId the item being edited, so its own text is not hidden as a
 *               duplicate of something already on the list
 */
export function useAutofill(
	text: Ref<string>,
	group: () => string | null,
	itemId?: () => string | undefined,
) {
	const memory = useLocalMemoryStore();
	const listStore = useListStore();

	const activeIndex = ref(-1);
	/**
	 * Suggestions only show while the user is typing: closed initially (so
	 * loading an existing item's text doesn't pop the menu), by Escape and by
	 * a pick, and reopened by the next input event.
	 */
	const dismissed = ref(true);

	function onInput(): void {
		dismissed.value = false;
		activeIndex.value = -1;
	}

	const suggestions = computed<Suggestion[]>(() => {
		if (dismissed.value || !listStore.credentials) return [];
		const self = itemId?.();
		// Don't offer what is already waiting on this list.
		const onList = listStore.activeItems
			.filter((i) => i.id !== self)
			.map((i) => i.text.value);
		return memory.suggest(
			listStore.credentials.syncId,
			text.value,
			group(),
			onList,
		);
	});

	const open = computed(() => suggestions.value.length > 0);

	function close(): void {
		dismissed.value = true;
		activeIndex.value = -1;
	}

	/**
	 * Handle navigation keys while suggestions are open. Returns the picked
	 * suggestion on Enter, `true` when the key was otherwise consumed, and
	 * `false` when the caller should handle it.
	 */
	function handleKeydown(e: KeyboardEvent): Suggestion | boolean {
		if (!open.value) return false;
		const count = suggestions.value.length;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				activeIndex.value = (activeIndex.value + 1) % count;
				return true;
			case "ArrowUp":
				e.preventDefault();
				activeIndex.value =
					activeIndex.value <= 0 ? count - 1 : activeIndex.value - 1;
				return true;
			case "Escape":
				e.preventDefault();
				e.stopPropagation();
				close();
				return true;
			case "Enter": {
				const picked = suggestions.value[activeIndex.value];
				if (!picked) return false;
				e.preventDefault();
				return picked;
			}
			default:
				return false;
		}
	}

	return { suggestions, open, activeIndex, onInput, close, handleKeydown };
}
