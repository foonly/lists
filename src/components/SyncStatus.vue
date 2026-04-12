<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  status: string
  lastSyncedAt: number | null
  error: string | null
}>()

const showDetails = ref(false)

const statusColor = computed(() => {
  switch (props.status) {
    case 'idle': return 'var(--color-success)'
    case 'error': return 'var(--color-danger)'
    default: return 'var(--color-warning)'
  }
})

const isSpinning = computed(() =>
  ['pulling', 'pushing', 'merging'].includes(props.status)
)

const statusLabel = computed(() => {
  switch (props.status) {
    case 'idle': return 'Synced'
    case 'pulling': return 'Pulling…'
    case 'pushing': return 'Pushing…'
    case 'merging': return 'Merging…'
    case 'error': return 'Sync error'
    default: return props.status
  }
})

const lastSyncedLabel = computed(() => {
  if (!props.lastSyncedAt) return 'Never synced'
  const diff = Date.now() - props.lastSyncedAt
  const seconds = Math.floor(diff / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
})

function toggle() {
  showDetails.value = !showDetails.value
}
</script>

<template>
  <button class="sync-status" @click="toggle" :title="statusLabel">
    <span
      class="status-dot"
      :class="{ spinning: isSpinning }"
      :style="{ backgroundColor: statusColor }"
    ></span>
    <span class="status-text">{{ statusLabel }}</span>

    <Transition name="details-fade">
      <div v-if="showDetails" class="details-popup" @click.stop>
        <p class="details-time">{{ lastSyncedLabel }}</p>
        <p v-if="error" class="details-error">{{ error }}</p>
      </div>
    </Transition>
  </button>
</template>

<style scoped>
.sync-status {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1;
  transition: background 0.15s;
}

.sync-status:hover {
  background: var(--color-hover);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.spinning {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.status-text {
  white-space: nowrap;
}

.details-popup {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 160px;
  padding: 0.6rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  text-align: left;
}

.details-time {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.details-error {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--color-danger);
  word-break: break-word;
}

.details-fade-enter-active,
.details-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.details-fade-enter-from,
.details-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
