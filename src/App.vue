<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "@/stores/app";

const appStore = useAppStore();

onMounted(async () => {
	await appStore.init();
});
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
