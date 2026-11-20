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
		<!--
			Vue Router reuses a view when only its params change. ListView opens
			its list on mount, so give each list its own instance: navigating
			straight from one list to another then closes the old list and opens
			the new one. Other routes keep one instance per route (ImportView
			clears its code from the URL without being remounted).
		-->
		<RouterView v-slot="{ Component, route }">
			<component
				:is="Component"
				:key="route.name === 'list' ? route.params.syncId : route.name"
			/>
		</RouterView>
	</div>
</template>

<style scoped>
.app {
	min-height: 100dvh;
}
</style>
