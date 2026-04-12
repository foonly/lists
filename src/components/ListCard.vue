<script setup lang="ts">
import { computed } from 'vue'
import type { ListCredentials } from '@/models/app-state'

const props = defineProps<{
  credentials: ListCredentials
}>()

const emit = defineEmits<{
  click: []
}>()

const relativeTime = computed(() => {
  const now = Date.now()
  const diff = now - props.credentials.lastAccessedAt
  const seconds = Math.floor(diff / 1000)

  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
})
</script>

<template>
  <button class="list-card" @click="emit('click')">
    <div class="list-card-content">
      <span class="list-card-name">{{ credentials.name }}</span>
      <span class="list-card-time">{{ relativeTime }}</span>
    </div>
    <svg
      class="list-card-arrow"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 3L11 8L6 13"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped>
.list-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.875rem 1rem;
  background: var(--color-surface, #ffffff);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--color-text, #333333);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.list-card:hover {
  background: var(--color-hover, #f0f0f0);
  border-color: var(--color-primary, #4a90d9);
  box-shadow: 0 2px 8px rgba(74, 144, 217, 0.1);
}

.list-card:active {
  background: var(--color-border, #e0e0e0);
}

.list-card-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.list-card-name {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-card-time {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #888888);
  line-height: 1.2;
}

.list-card-arrow {
  flex-shrink: 0;
  color: var(--color-text-secondary, #888888);
  transition: transform 0.15s ease;
}

.list-card:hover .list-card-arrow {
  transform: translateX(2px);
  color: var(--color-primary, #4a90d9);
}
</style>
