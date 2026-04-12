<script setup lang="ts">
defineProps<{
  name: string
}>()
</script>

<template>
  <div class="group-header">
    <span class="group-name">{{ name }}</span>
    <hr class="group-rule" />
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
</style>
