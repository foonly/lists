# Changelog

### 1.2.3 (2026-04-12)

#### Bug Fixes

- listview: adjust layout to prevent editor/footer overlap and restore scrolling (0cfd144)

### v1.2.2 (2026-04-12)

#### Bug Fixes

- list: compute done, stale and active items from items instead of nonDeletedItems (45be6e3)

### v1.2.1 (2026-04-12)

#### Bug Fixes

- list: skip background sync during in-progress edits (054c165)

## v1.2.0 (2026-04-12)

#### Features

- app: remove per-user backend override and add theme/version UI (523ba60)

### v1.1.2 (2026-04-12)

#### Bug Fixes

- app: re-register local state when backend record is missing (e3deb73)

### v1.1.1 (2026-04-12)

#### Maintenance

- config: add foonver.toml to enable push and changelog (dabc3b3)

## v1.1.0 (2026-04-12)

#### Features

- list: add confirm dialog and remove UI; implement debounced push and 30s poll sync (e59c342)
- frontend: add initial Vue 3 app with Pinia, router, PWA and sync client (2b06ec6)

#### Documentation

- readme: add comprehensive project README (11e5969)

#### Continuous Integration

- release: add GitHub Actions release workflow and Makefile (634870d)

#### Maintenance

- gitignore: ignore tsconfig.tsbuildinfo and *.log and remove tsconfig.tsbuildinfo (62f554c)

### Misc
- Initial commit (9065f1c)

