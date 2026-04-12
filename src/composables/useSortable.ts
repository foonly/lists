import { onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import Sortable from "sortablejs";
import type { SortableEvent } from "sortablejs";

export interface SortableOptions {
	/** CSS selector for the drag handle. If not set, the whole item is draggable. */
	handle?: string;
	/** Shared group name to allow dragging between containers. */
	group?: string | Sortable.GroupOptions;
	/** CSS class applied to the ghost element. */
	ghostClass?: string;
	/** CSS class applied to the chosen element. */
	chosenClass?: string;
	/** CSS class applied to the drag placeholder. */
	dragClass?: string;
	/** Animation speed in ms. */
	animation?: number;
}

export interface MoveEvent {
	/** The item ID that was moved (from data-id attribute). */
	itemId: string;
	/** Old index within the source container. */
	oldIndex: number;
	/** New index within the target container. */
	newIndex: number;
	/** The group identifier of the source container (from data-group attribute). */
	fromGroup: string;
	/** The group identifier of the target container (from data-group attribute). */
	toGroup: string;
}

export function useSortable(
	containerRef: Ref<HTMLElement | null>,
	options: SortableOptions = {},
	onMove: (event: MoveEvent) => void,
) {
	let sortableInstance: Sortable | null = null;

	function init() {
		if (!containerRef.value) return;

		sortableInstance = Sortable.create(containerRef.value, {
			handle: options.handle,
			group: options.group,
			ghostClass: options.ghostClass ?? "sortable-ghost",
			chosenClass: options.chosenClass ?? "sortable-chosen",
			dragClass: options.dragClass ?? "sortable-drag",
			animation: options.animation ?? 150,
			onEnd(evt: SortableEvent) {
				const itemId = evt.item.dataset.id;
				if (!itemId) return;

				const fromGroup = (evt.from as HTMLElement).dataset.group ?? "";
				const toGroup = (evt.to as HTMLElement).dataset.group ?? "";

				// Revert the DOM mutation — Vue will re-render from reactive data.
				// SortableJS physically moves the DOM node, so we need to put it back.
				if (evt.from !== evt.to) {
					// Cross-container: remove from target, insert back into source
					evt.item.remove();
					const refNode = evt.from.children[evt.oldIndex!];
					evt.from.insertBefore(evt.item, refNode || null);
				} else {
					// Same container: revert position
					evt.item.remove();
					const refNode = evt.from.children[evt.oldIndex!];
					evt.from.insertBefore(evt.item, refNode || null);
				}

				onMove({
					itemId,
					oldIndex: evt.oldIndex!,
					newIndex: evt.newIndex!,
					fromGroup,
					toGroup,
				});
			},
		});
	}

	function destroy() {
		if (sortableInstance) {
			sortableInstance.destroy();
			sortableInstance = null;
		}
	}

	onMounted(() => init());
	onBeforeUnmount(() => destroy());

	// Re-initialize if the container ref changes (e.g. v-if toggling the element)
	watch(containerRef, (newEl, oldEl) => {
		if (newEl !== oldEl) {
			destroy();
			init();
		}
	});

	return {
		destroy,
		reinit: () => {
			destroy();
			init();
		},
	};
}
