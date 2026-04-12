# Lists app plan

This will be a PWA built with Vue and pinia. It will use typescript, and Zod for validation. We will use pnpm as the package manager.

The backend will be an encrypted blob storage API, originally designed for a different app, but it is generic in nature. It's built with Go, and defined in BACKEND.md. We will try to make a reusable library to access the backend, for now just in a separate file in the project, but designed so that it can be made into it's own npm package later.

## The app

The app will be a "shopping list" app, where you can have many different lists, that can be shared with different users.

Each list will have it's own encrypted blob synced to the backend.

There will also be an "app" blob that keeps track of everything. This has all the settings for the app, as well as a "username" that you define. It will also contain info about all the lists you have, and their credentials (id:crypt_key:secret).

## The lists

The lists will be fairly simple "shopping list" type of lists, but can of course be used for anything.

Each item uses **per-field change tracking** — every mutable field carries its own `timestamp` and `username`, enabling independent last-writer-wins merging. This means User A can change quantity while User B checks the item off, and both changes survive the merge.

Each item will have the following info:

- **ID** : `string` — a unique ID for the item (immutable, not tracked).
- **Text** : `TrackedField<string>` — the item description.
- **Quantity** : `TrackedField<number | null>` — optional quantity.
- **Unit** : `TrackedField<string | null>` — optional unit (e.g. "kg", "pcs").
- **Group** : `TrackedField<string | null>` — optional grouping (e.g. "fruits", "vegetables").
- **Done** : `TrackedField<string | null>` — done marker. When checked off, stores a checksum of the content fields (text, quantity, unit) at that moment. `null` means not done. If the stored checksum no longer matches the current content, the item is in a "stale done" state (content changed since check-off).
- **Deleted** : `TrackedField<boolean>` — soft-delete flag. Deleted items are kept in the blob for sync consistency and garbage-collected after 30 days.

Where `TrackedField<T>` is:

- **value** : `T` — the field's current value.
- **timestamp** : `number` — Unix ms when this specific field was last changed.
- **username** : `string` — who made this specific change.

## List management

When creating a list, sync credentials (id:crypt_key:secret) will be generated and stored in the app blob. These credentials can be shared to other users to allow them to access the list. The app will also have a "recently accessed lists" section, where you can quickly access the lists you use most often.

When sharing a list, the credentials will be copied to the clipboard in a format that can be easily pasted into the app by the other user. The format will be something like `listname:sync_id:crypt_key:secret`.

The names of the lists are only for organizational purposes in the app, they are not stored in the backend and can be changed without affecting the syncing. The sync_id is the unique identifier for the list in the backend, and the crypt_key and secret are used for encryption and authentication when accessing the backend.

---

## Architecture

### Project structure

```
lists/
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── vite-env.d.ts
├── public/
│   ├── manifest.json
│   ├── favicon.ico
│   └── icons/              # PWA icons in various sizes
├── src/
│   ├── main.ts             # App entry point
│   ├── App.vue             # Root component
│   ├── router.ts           # Vue Router setup
│   ├── lib/
│   │   └── sync-client/    # Reusable backend client library
│   │       ├── index.ts        # Public API barrel export
│   │       ├── client.ts       # SyncClient class (fetch, push, history)
│   │       ├── crypto.ts       # AES-GCM encrypt/decrypt + HMAC signing
│   │       ├── types.ts        # Shared TypeScript types
│   │       └── schemas.ts      # Zod schemas for API responses
│   ├── models/
│   │   ├── app-state.ts    # Zod schema + types for the app blob
│   │   └── list.ts         # Zod schema + types for a list blob
│   ├── stores/
│   │   ├── app.ts          # Pinia store for app-level state
│   │   └── list.ts         # Pinia store for the currently open list
│   ├── composables/
│   │   ├── useSync.ts      # Auto-sync polling / push logic
│   │   └── useShare.ts     # Share/import credential helpers
│   ├── views/
│   │   ├── HomeView.vue    # Dashboard: list of lists
│   │   ├── ListView.vue    # Single list view
│   │   └── SettingsView.vue
│   ├── components/
│   │   ├── ListCard.vue        # List summary card for the dashboard
│   │   ├── ListItem.vue        # Single item row in a list
│   │   ├── ListItemEditor.vue  # Inline add/edit form for an item
│   │   ├── GroupHeader.vue     # Group separator/header in a list
│   │   ├── ShareDialog.vue     # Share / import list dialog
│   │   ├── SyncStatus.vue      # Small indicator for sync state
│   │   └── AppBar.vue          # Top bar / navigation
│   └── styles/
│       └── main.css        # Global styles (minimal, utility-first)
└── PLAN.md
└── BACKEND.md
```

### Key dependencies

| Package           | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `vue`             | UI framework                                        |
| `pinia`           | State management                                    |
| `vue-router`      | Client-side routing                                 |
| `zod`             | Runtime validation of blobs and API responses       |
| `vite`            | Build tooling                                       |
| `vite-plugin-pwa` | PWA manifest, service worker, offline support       |
| `nanoid`          | Compact unique ID generation for items and sync IDs |

No UI component library — we will keep the UI simple with custom CSS. The app should feel fast and native on mobile.

---

## Data models

### App state blob (one per user, synced to its own backend slot)

This blob is the "root of trust" for the user. It stores all list credentials and app-wide settings. It is encrypted with the user's own app-level crypt_key and synced using their own app-level sync credentials.

```ts
// models/app-state.ts
import { z } from "zod";

export const ListCredentialsSchema = z.object({
	name: z.string(), // Local display name (not synced inside list blob)
	syncId: z.string(), // Backend blob ID
	cryptKey: z.string(), // Base64-encoded AES-GCM key for the list blob
	secret: z.string(), // HMAC signing secret for backend auth
	lastAccessedAt: z.number(), // Unix timestamp, for "recently accessed" sorting
	createdAt: z.number(), // Unix timestamp
	order: z.number(), // Manual sort order on the dashboard
});

export const AppStateSchema = z.object({
	version: z.literal(1),
	username: z.string().min(1),
	lists: z.array(ListCredentialsSchema),
	settings: z.object({
		syncIntervalSeconds: z.number().default(30),
		backendUrl: z.string().url(),
		theme: z.enum(["light", "dark", "auto"]).default("auto"),
	}),
});

export type ListCredentials = z.infer<typeof ListCredentialsSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
```

### List blob (one per shared list, synced to backend)

```ts
// models/list.ts
import { z } from "zod";

// Generic tracked field — each mutable field carries its own timestamp and author
const TrackedFieldSchema = <T extends z.ZodTypeAny>(inner: T) =>
	z.object({
		value: inner,
		timestamp: z.number(), // Unix ms when THIS field was last changed
		username: z.string(), // Who made THIS specific change
	});

export const ListItemSchema = z.object({
	id: z.string(), // Immutable, not tracked

	// Content fields — independently mergeable
	text: TrackedFieldSchema(z.string()),
	quantity: TrackedFieldSchema(z.number().nullable()), // null = not set
	unit: TrackedFieldSchema(z.string().nullable()), // null = not set
	group: TrackedFieldSchema(z.string().nullable()), // null = ungrouped

	// Done marker — stores checksum of (text, quantity, unit) at time of check-off
	// null = not done, string = checksum of content when marked done
	done: TrackedFieldSchema(z.string().nullable()),

	// Soft delete
	deleted: TrackedFieldSchema(z.boolean()),
});

export const ListBlobSchema = z.object({
	version: z.literal(1),
	items: z.array(ListItemSchema),
});

export type ListItem = z.infer<typeof ListItemSchema>;
export type ListBlob = z.infer<typeof ListBlobSchema>;
```

#### Done-state semantics

The `done` field uses a checksum to track _what_ was marked as complete:

| `done.value` | Matches current content? | Display state                                 |
| ------------ | ------------------------ | --------------------------------------------- |
| `null`       | —                        | **Not done** — normal item                    |
| checksum     | ✅ Yes                   | **Done** ✓ — fully checked off                |
| checksum     | ❌ No                    | **Stale** ⚠ — content changed since check-off |

The "stale" state lets the UI warn the user (e.g. "quantity changed since you checked this off") so they can re-confirm. The content checksum covers `text`, `quantity`, and `unit` but deliberately **excludes `group`** — moving an item to a different aisle shouldn't invalidate a check-off.

### Credential share format

When sharing, credentials are encoded as a single colon-separated string:

```
listname:syncId:cryptKey:secret
```

Because `listname` can contain colons (unlikely but possible), we will base64-encode the name segment, or alternatively use a fixed 3-split-from-the-right approach. Simplest: we'll use a `|` (pipe) delimiter instead, which is not valid in base64, making parsing unambiguous:

```
listname|syncId|cryptKey|secret
```

This string is what gets copied to clipboard and pasted by the recipient.

---

## Sync client library (`src/lib/sync-client/`)

This module is designed to be self-contained and framework-agnostic so it can be extracted into its own npm package later. It depends only on the Web Crypto API and `zod`.

### `crypto.ts`

Responsible for all cryptographic operations using the Web Crypto API (available in browsers and service workers).

| Function                                                                 | Description                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `generateCryptKey(): Promise<string>`                                    | Generate a new random 256-bit AES-GCM key, return as base64                           |
| `generateSecret(): Promise<string>`                                      | Generate a random signing secret (32 bytes), return as base64                         |
| `generateSyncId(): string`                                               | Generate a random sync ID using nanoid (URL-safe, 21 chars)                           |
| `encrypt(plaintext: string, base64Key: string): Promise<string>`         | AES-GCM encrypt → base64 blob (prepends random 12-byte IV)                            |
| `decrypt(base64Blob: string, base64Key: string): Promise<string>`        | AES-GCM decrypt from base64 blob                                                      |
| `sign(secret: string, timestamp: number, body: string): Promise<string>` | Compute `HMAC-SHA256(secret, timestamp + sha256(body))` for POST auth                 |
| `contentChecksum(item): string`                                          | SHA-256 hex of (text + quantity + unit), used for the `done` field. Excludes `group`. |

### `client.ts`

A stateless API client class.

```ts
class SyncClient {
	constructor(private baseUrl: string) {}

	async fetch(
		syncId: string,
	): Promise<{ data: string; timestamp: number } | null>;
	async push(
		syncId: string,
		secret: string,
		data: string,
		isNew?: boolean,
	): Promise<void>;
	async history(syncId: string): Promise<{ timestamp: number }[]>;
	async fetchVersion(
		syncId: string,
		timestamp: number,
	): Promise<{ data: string; timestamp: number }>;
}
```

- `fetch` wraps `GET /sync/:id`, returns `null` on 404.
- `push` wraps `POST /sync/:id`, handles signing via `crypto.ts`, includes `registration_secret` if `isNew`.
- `history` wraps `GET /sync/:id/history`.
- `fetchVersion` wraps `GET /sync/:id/:timestamp`.

### High-level helpers (exported from `index.ts`)

```ts
async function pullBlob<T>(
	syncId: string,
	cryptKey: string,
	schema: ZodType<T>,
	client: SyncClient,
): Promise<{ data: T; timestamp: number } | null>;
async function pushBlob<T>(
	syncId: string,
	cryptKey: string,
	secret: string,
	data: T,
	client: SyncClient,
	isNew?: boolean,
): Promise<void>;
```

These combine fetch/push with decrypt/encrypt and Zod validation in one step.

---

## Sync strategy

### Polling model

- Each open list polls the backend at a configurable interval (default 30s).
- The app state blob also syncs periodically (lower frequency, e.g. every 60s, or on list changes).
- On push, we immediately write; on conflict (stale timestamp), we pull first, merge, then push.

### Merge algorithm (per list) — per-field last-writer-wins

Because multiple users can edit the same list concurrently, we need a deterministic merge. Since every mutable field carries its own timestamp, we merge at the **field level** rather than the item level:

1. **Pull** the remote blob and decrypt it.
2. **Build a map** of remote items keyed by `id`.
3. **For each item ID present in either local or remote**:
   - **Only in local** → keep local (locally-added item).
   - **Only in remote** → keep remote (added by another user).
   - **In both** → merge per field:
     - For each tracked field (`text`, `quantity`, `unit`, `group`, `done`, `deleted`):
       - If timestamps differ → take the field with the **later timestamp**.
       - If timestamps are equal → prefer remote (generous tie-break — other user wins).
       - If timestamps equal AND values identical → no conflict.
4. **Push** the merged result.

This per-field approach handles key scenarios correctly:

- **User A checks off "5 apples", User B changes quantity to 8** → After merge, `done` keeps A's checksum (of the old content), `quantity` takes B's new value. The checksum no longer matches → UI shows "stale done" so A can re-confirm.
- **User A changes text, User B changes quantity** → Both fields merge independently, no data loss.
- **User A deletes, User B edits text** → `deleted` and `text` resolve independently by timestamp. The UI can show a "deleted but recently edited" state and allow restoration.

Deleted items are kept in the blob for sync consistency. We periodically garbage-collect items that have been `deleted` for more than 30 days.

### Offline support

- All state is persisted to `localStorage` (app state) and `IndexedDB` (list blobs, for size).
- When the app goes online after being offline, it triggers an immediate sync cycle.
- The service worker (via `vite-plugin-pwa`) caches the app shell for full offline usage.

### Sync state tracking

Each list in the store tracks:

```ts
interface SyncMeta {
	status: "idle" | "pulling" | "pushing" | "merging" | "error";
	lastSyncedAt: number | null; // Unix timestamp of last successful sync
	remoteTimestamp: number | null; // Timestamp from last GET, used for conflict detection
	dirty: boolean; // True if local changes haven't been pushed yet
	error: string | null;
}
```

---

## Pinia stores

### App store (`stores/app.ts`)

Responsibilities:

- Load/save app state from localStorage on startup.
- Sync app state blob to the backend.
- CRUD operations on the list credentials array.
- Manage current username and settings.

Key actions:

- `init()` — Load from localStorage, then pull from backend and merge.
- `createList(name: string)` — Generate syncId + cryptKey + secret, add to `lists`, push empty list blob to backend to register it.
- `importList(shareString: string)` — Parse the `name|syncId|cryptKey|secret` string, add to `lists`.
- `removeList(syncId: string)` — Remove from local `lists` (does NOT delete backend data, others may still use it).
- `saveAndSync()` — Persist to localStorage and push to backend.

### List store (`stores/list.ts`)

Responsibilities:

- Hold the currently open list's items and sync metadata.
- Provide actions to add, edit, check off, and delete items.
- Run the sync loop while a list is open.

Key actions:

- `openList(credentials: ListCredentials)` — Load from IndexedDB cache, then pull and merge from backend.
- `closeList()` — Stop sync loop, persist to IndexedDB.
- `addItem(text, quantity?, unit?, group?)` — Create a new `ListItem` with generated ID. Each provided field gets the current timestamp and username.
- `updateItem(id, fieldChanges)` — Update one or more tracked fields. Only the changed fields get their timestamp and username bumped.
- `toggleDone(id)` — If not done, set `done.value` to `contentChecksum(item)`. If done/stale, set `done.value` to `null`. Bumps `done.timestamp` and `done.username`.
- `toggleDelete(id)` — Flip `deleted.value`, bump `deleted.timestamp` and `deleted.username`.
- `sync()` — Pull, merge, push cycle. Called on interval and after local changes.
- `purgeOldDeleted()` — Remove items with `deleted: true` older than 30 days.

---

## UI & routing

### Routes

| Path            | View           | Description                                                  |
| --------------- | -------------- | ------------------------------------------------------------ |
| `/`             | `HomeView`     | Dashboard showing all lists                                  |
| `/list/:syncId` | `ListView`     | A single list view                                           |
| `/settings`     | `SettingsView` | App settings (username, backend URL, theme, app credentials) |

### HomeView (Dashboard)

- Header with app name and a settings gear icon.
- "Your Lists" section with `ListCard` components for each list, sorted by `lastAccessedAt` or manual `order`.
- Each card shows: name, item count (excluding deleted), last synced time.
- Tap a card → navigate to `/list/:syncId`.
- FAB (floating action button) or "+" button to create a new list.
- An "Import list" button that opens `ShareDialog` in import mode (paste credential string).

### ListView

- Top bar with list name (editable), back button, share button, and sync status indicator.
- Items grouped by `group` field (ungrouped items shown first or under "Other").
- Each `ListItem` row shows:
  - **Three-state checkbox:**
    - ☐ **Not done** (`done.value === null`) — normal item, tap to check off.
    - ☑ **Done** (`done.value` matches current content checksum) — struck-through, tap to un-check.
    - ⚠ **Stale** (`done.value` is non-null but doesn't match) — warning style, indicates content changed since check-off. Shows a hint like "quantity changed since checked off by {done.username}". Tap to re-confirm (updates checksum) or un-check.
  - Text, quantity + unit (if present).
  - Subtle per-field "edited by" label — e.g. "qty changed by Alice 2m ago".
  - Swipe or long-press to delete (sets `deleted.value = true`).
- Done items (fully checked off) are moved to a collapsible "Done" section at the bottom.
- Stale items remain in the main list with a visual warning, since they need attention.
- At the bottom (or top, based on preference): `ListItemEditor` for quickly adding new items.
- Pull-to-refresh triggers a sync.

**"Done" vs "deleted":** Checking off an item stores a content checksum in `done.value` — this means "I've picked this up / completed this." It is different from deletion, which means "remove this from the list entirely." Done items are shown in a collapsible section and can be un-done. Deleted items are hidden and eventually garbage-collected.

### SettingsView

- Username field (required, used in all item edits).
- Backend URL field (with a "test connection" button).
- Theme picker (light / dark / auto).
- Sync interval slider.
- App sync credentials display (for backup/restore — the user can export their app blob credentials to restore on a new device).
- Danger zone: "Reset app" to clear all local data.

### ShareDialog

Two modes:

1. **Share mode**: Shows the credential string for the current list, with a "Copy to clipboard" button.
2. **Import mode**: A text input to paste a credential string, with a "Join list" button that calls `appStore.importList()`.

---

## First-time setup flow

1. User opens the app for the first time.
2. App detects no app state in localStorage.
3. User is prompted to:
   - Enter a username.
   - Optionally enter existing app credentials (for restoring on a new device).
4. If new user: generate app-level `syncId`, `cryptKey`, and `secret`. Save to localStorage and push initial app blob to backend.
5. If restoring: use provided credentials to pull and decrypt the app blob from backend, populating all list credentials.
6. Redirect to the dashboard.

---

## Implementation phases

### Phase 1: Foundation

- [ ] Initialize the project with Vite + Vue + TypeScript + Pinia + Vue Router.
- [ ] Set up `vite-plugin-pwa` with a basic manifest and service worker.
- [ ] Implement `src/lib/sync-client/` (crypto, client, schemas, high-level helpers).
- [ ] Write the Zod schemas for `AppState` and `ListBlob`.
- [ ] Unit test the sync client: encrypt → decrypt round-trip, HMAC signing, client methods against a mock.

### Phase 2: Core state & sync

- [ ] Implement the app Pinia store with localStorage persistence.
- [ ] Implement the list Pinia store with IndexedDB persistence.
- [ ] Build the sync loop (pull → merge → push) for lists.
- [ ] Build app-state syncing.
- [ ] Test the merge algorithm with simulated concurrent edits.

### Phase 3: UI shell

- [ ] Build the router and view scaffolding.
- [ ] Implement `HomeView` with list cards, create, and import.
- [ ] Implement `ListView` with grouped items, add/edit/done/delete.
- [ ] Implement `SettingsView`.
- [ ] Implement `ShareDialog`.
- [ ] Implement `SyncStatus` indicator.

### Phase 4: Polish & PWA

- [ ] Style the app for mobile-first, responsive layout.
- [ ] Add dark mode support.
- [ ] Tune service worker caching for offline reliability.
- [ ] Add pull-to-refresh and online/offline detection.
- [ ] Add "last edited by" display on items.
- [ ] Garbage-collect old deleted items (> 30 days).

### Phase 5: Stretch goals

- [ ] Undo/redo for item changes (local only).
- [ ] List reordering (drag and drop).
- [ ] Item reordering within groups.
- [ ] Conflict notification toast ("X updated 3 items").
- [ ] Version history viewer (pull historical blobs from backend).
- [ ] Export list as plain text.
