<script setup lang="ts">
import type { ListItem } from '@/models/list'

const props = defineProps<{
  item: ListItem
  checksumMatch: boolean | null
}>()

const emit = defineEmits<{
  'toggle-done': []
  'delete': []
  'edit': []
}>()

function isDone(): boolean {
  return props.checksumMatch === true
}

function isStale(): boolean {
  return props.checksumMatch === false
}

function isActive(): boolean {
  return props.checksumMatch === null
}

function displayText(): string {
  const parts: string[] = []
  if (props.item.quantity.value !== null) {
    const q = props.item.quantity.value
    const u = props.item.unit.value
    parts.push(u ? `${q} ${u}` : `${q}×`)
  }
  parts.push(props.item.text.value)
  return parts.join(' ')
}

function lastEditor(): string {
  let latest = props.item.text
  const fields = [props.item.text, props.item.quantity, props.item.unit, props.item.group, props.item.done] as const
  for (const f of fields) {
    if (f.timestamp > latest.timestamp) {
      latest = f as typeof latest
    }
  }
  return latest.username
}
</script>

<template>
  <div
    class="list-item-row"
    :class="{
      'is-done': isDone(),
      'is-stale': isStale(),
    }"
  >
    <button
      class="checkbox-btn"
      :class="{
        checked: isDone(),
        stale: isStale(),
      }"
      :aria-label="isDone() ? 'Mark as not done' : isStale() ? 'Item changed since checked off' : 'Mark as done'"
      @click="emit('toggle-done')"
    >
      <svg v-if="isDone()" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="16" height="16" rx="4" fill="var(--color-primary)" stroke="var(--color-primary)" stroke-width="1.5"/>
        <path d="M5 9.5L7.5 12L13 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <svg v-else-if="isStale()" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="16" height="16" rx="4" fill="var(--color-warning)" stroke="var(--color-warning)" stroke-width="1.5"/>
        <path d="M9 5.5V9.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <circle cx="9" cy="12" r="1" fill="#fff"/>
      </svg>
      <svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="16" height="16" rx="4" stroke="var(--color-border)" stroke-width="1.5"/>
      </svg>
    </button>

    <div class="item-content" @click="emit('edit')">
      <span class="item-text">{{ displayText() }}</span>
      <span v-if="isStale()" class="stale-hint">Changed since checked off</span>
      <span class="item-meta">{{ lastEditor() }}</span>
    </div>

    <button
      class="delete-btn"
      aria-label="Delete item"
      @click="emit('delete')"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.list-item-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.15s ease;
}

.list-item-row:last-child {
  border-bottom: none;
}

.list-item-row.is-done .item-text {
  text-decoration: line-through;
  color: var(--color-text-secondary);
}

.list-item-row.is-stale {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  margin: 0 -1rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: 6px;
  border-bottom-color: transparent;
}

.checkbox-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin-top: -0.1rem;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s;
}

.checkbox-btn:hover {
  background: var(--color-hover);
}

.checkbox-btn:active {
  background: var(--color-border);
}

.item-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-top: 0.2rem;
}

.item-text {
  font-size: 0.95rem;
  line-height: 1.4;
  word-break: break-word;
  color: var(--color-text);
}

.stale-hint {
  font-size: 0.7rem;
  color: var(--color-warning);
  font-weight: 500;
  line-height: 1.2;
}

.item-meta {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  line-height: 1.2;
}

.delete-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin-top: -0.1rem;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s, background-color 0.15s;
  opacity: 0;
}

.list-item-row:hover .delete-btn,
.list-item-row:focus-within .delete-btn {
  opacity: 1;
}

/* always visible on touch devices */
@media (hover: none) {
  .delete-btn {
    opacity: 1;
  }
}

.delete-btn:hover {
  color: var(--color-danger);
  background: var(--color-hover);
}

.delete-btn:active {
  background: var(--color-border);
}
</style>
