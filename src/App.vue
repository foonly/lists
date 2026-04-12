<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useAppStore } from "@/stores/app";

const appStore = useAppStore();

onMounted(async () => {
	await appStore.init();
});

watch(
	() => appStore.settings?.theme,
	(theme) => {
		if (theme === "auto" || !theme) {
			document.documentElement.removeAttribute("data-theme");
		} else {
			document.documentElement.setAttribute("data-theme", theme);
		}
	},
	{ immediate: true },
);
</script>

<template>
	<div class="app">
		<RouterView />
	</div>
</template>

<style scoped>
.app {
	min-height: 100dvh;
}
</style>
