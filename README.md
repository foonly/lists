# Lists

A collaborative shopping-list PWA built with Vue 3, Pinia, and TypeScript. Lists are end-to-end encrypted and synced through a zero-knowledge backend — the server never sees your data.

## Features

- **Multiple lists** — create as many lists as you need, each synced independently.
- **Real-time collaboration** — share a list with others using a credential string. Concurrent edits are merged automatically with per-field last-writer-wins resolution.
- **End-to-end encryption** — all data is encrypted client-side with AES-GCM before it leaves the device. The backend stores opaque blobs and never has access to your decryption keys.
- **Offline-first** — the app shell is cached by a service worker, and all data is persisted locally (app state in localStorage, list blobs in IndexedDB). Changes sync when connectivity returns.
- **Grouped items** — organise items into groups (e.g. "Produce", "Dairy") with drag-and-drop reordering via SortableJS.
- **Smart done tracking** — checking off an item stores a content checksum. If someone else changes the quantity or text after check-off, the item shows a "stale" warning so you can re-confirm.
- **Dark mode** — automatic, light, or dark theme via system preference or manual override.
- **Installable PWA** — add to your home screen for a native app experience.

## Tech Stack

| Package | Purpose |
|---|---|
| [Vue 3](https://vuejs.org/) | UI framework |
| [Pinia](https://pinia.vuejs.org/) | State management |
| [Vue Router](https://router.vuejs.org/) | Client-side routing |
| [Zod](https://zod.dev/) | Runtime validation of data blobs and API responses |
| [Vite](https://vite.dev/) | Build tooling and dev server |
| [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) | PWA manifest, service worker, offline caching |
| [nanoid](https://github.com/ai/nanoid) | Compact unique ID generation |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-and-drop item and group reordering |

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- A running instance of the sync backend (see [Backend](#backend) below)

## Getting Started

```sh
# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

The app will be available at `http://localhost:5173` by default.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Base URL of the sync backend API. Set this to your backend's address during development (e.g. `http://localhost:8080/api/v1`). |

Create a `.env.local` file in the project root to override:

```
VITE_API_BASE_URL=http://localhost:8080/api/v1
```

## Building for Production

```sh
pnpm build
```

Output is written to `dist/`. Serve it with any static file server — the service worker handles offline caching automatically.

## Project Structure

```
src/
├── main.ts                  # App entry point
├── App.vue                  # Root component
├── router.ts                # Vue Router setup with auth guard
├── lib/
│   └── sync-client/         # Reusable encrypted-blob sync library
│       ├── index.ts         # Public API (pullBlob, pushBlob)
│       ├── client.ts        # SyncClient class (HTTP layer)
│       ├── crypto.ts        # AES-GCM encrypt/decrypt, HMAC signing, key generation
│       ├── types.ts         # Shared TypeScript types
│       └── schemas.ts       # Zod schemas for API responses
├── models/
│   ├── app-state.ts         # App state blob schema & share-string codec
│   └── list.ts              # List blob schema & tracked-field helpers
├── stores/
│   ├── app.ts               # App-level state (lists, settings, credentials)
│   └── list.ts              # Currently-open list (items, sync loop, merge)
├── views/
│   ├── HomeView.vue         # Dashboard — list of lists, create, import
│   ├── ListView.vue         # Single list — items, groups, drag-and-drop
│   ├── SettingsView.vue     # Username, backend URL, theme, credentials
│   └── SetupView.vue        # First-time setup / restore flow
├── components/
│   ├── AppBar.vue           # Top navigation bar
│   ├── ConfirmDialog.vue    # Reusable modal confirmation dialog
│   ├── GroupHeader.vue      # Group separator header
│   ├── ListCard.vue         # List summary card for the dashboard
│   ├── ListItemEditor.vue   # Add / edit item form
│   ├── ListItemRow.vue      # Single item row
│   └── SyncStatus.vue       # Sync state indicator
├── composables/
│   └── useSortable.ts       # SortableJS composable
└── styles/
    └── main.css             # Global styles and CSS custom properties
```

## How It Works

### Data Model

There are two kinds of encrypted blobs:

- **App state blob** (one per user) — stores your username, settings, and the credentials for every list you have access to. Persisted in localStorage and synced to a dedicated backend slot.
- **List blob** (one per list) — stores all items in the list. Persisted in IndexedDB and synced to its own backend slot.

Every mutable field on a list item is a **tracked field** carrying a value, a timestamp, and the username of who last changed it. This enables per-field last-writer-wins merging when multiple users edit concurrently.

### Sync

- When a list is open, changes are synced to the backend with a **5-second debounce** after any mutation.
- A **30-second polling interval** checks for remote changes while a list is open. The debounced sync resets this timer so the two don't overlap.
- All changes are persisted to IndexedDB immediately, so nothing is lost if the page is closed before sync completes.
- The merge algorithm operates at the field level: for each item present in both local and remote, every tracked field is resolved independently by timestamp. Equal timestamps prefer the remote value.

### Encryption & Authentication

- List data is encrypted client-side with **AES-256-GCM**. The encryption key never leaves the client.
- Backend writes are authenticated with **HMAC-SHA256** signed requests using a per-slot signing secret.
- On first write to a new slot, the signing secret is registered with the backend. Subsequent writes are verified against it.

### Sharing

Lists are shared by exchanging a credential string in the format `name|syncId|cryptKey|secret`. Anyone with this string has full read/write access to the list. The string can be copied from the list view and pasted into another user's app via the import flow on the home screen.

## Backend

The app communicates with an encrypted blob storage API. The backend is a separate Go service defined in [`BACKEND.md`](BACKEND.md). It is a generic, zero-knowledge storage vault — it stores opaque versioned blobs and authenticates writes via HMAC, but never possesses decryption keys.

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/sync/:id` | Fetch the latest encrypted blob |
| `POST` | `/sync/:id` | Upload a new encrypted blob (HMAC-signed) |
| `GET` | `/sync/:id/history` | List available historical versions |
| `GET` | `/sync/:id/:timestamp` | Fetch a specific historical version |

See [`BACKEND.md`](BACKEND.md) for the full API specification, authentication details, rate limits, and deployment instructions.

## License

[GPL-3.0-only](https://www.gnu.org/licenses/gpl-3.0.html)
