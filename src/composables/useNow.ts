import { onScopeDispose, ref, type Ref } from "vue";

/**
 * A reactive "current time" that ticks every `intervalMs`, so computed
 * relative times ("5m ago") keep updating while they are on screen.
 */
export function useNow(intervalMs = 15_000): Ref<number> {
	const now = ref(Date.now());
	const timer = setInterval(() => {
		now.value = Date.now();
	}, intervalMs);
	onScopeDispose(() => clearInterval(timer));
	return now;
}
