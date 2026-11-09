# FossFLOW Live v1: servers, containers and vitals on the map (Beszel)

## Context

You forked FossFLOW, an isometric diagram editor, to turn it into a **system-landscape map for IT teams** with an **optional live layer**. You'll deploy it for your team at fitseveneleven and keep it open source. The brainstorm settled:

- **Plain FossFLOW stays first-class.** Anyone can map systems by hand with no backend and no data source.
- **The live layer is optional and reads from tools teams already run.** The first source is **Beszel**: a hub plus small agents, which exposes servers, containers and history over a PocketBase REST API.
- **v1 scope:** each server is shown with its running Docker containers and the server's vitals. It should be "as easy as possible": configure once and everything appears.
- **Discovery:** new servers and containers are auto-placed. People draw connections by hand; automatic connections come later.
- **Look:** a hairline-ink isometric style taken from your Vercel-inspired `design.md`. Colour appears only for trouble. Vitals use **option B: a callout card on a leader line**.
- **Read-only by design,** and credentials never reach the browser.

## Decisions you confirmed

- Remove the Copilot "Live Analytics" feature, in its own commit. It never worked: the overlay is never mounted, its store is broken, and it fetches with credentials from the browser.
- v1 access control: the existing nginx HTTP Basic Auth (`HTTP_AUTH_USER/PASSWORD`), which already covers `/api/`.
- Git identity: personal (`LucaGerlich <lucagerlich@gmail.com>`), as currently configured.
- Create `docs/AUDIT.md` and add an entry with every change.
- Overnight run: push the feature branch and open a **draft PR into `development`**. Never merge, never deploy. Request keep-awake straight after this plan is approved.
- Subagents run on Haiku or Sonnet only.

## My calls (flagged so you can veto them)

- **Indentation follows the repo's Prettier config (2 spaces), not your tabs preference.** Reformatting would wreck every future upstream merge, and mixing styles is worse.
- **The new backend code is strict TypeScript run directly by Node 24, with no build step.** It uses only syntax Node can strip (`erasableSyntaxOnly`). `tsc --noEmit` checks it, and tests use the built-in `node:test`. No new test framework.
- **Discovery runs inside the lib, not the app.** The lib has no API for the host app to add items, and its `initialData` reload ignores rectangle-only changes. So the lib applies discovery with its own reducers and saves without history entries; the app persists the result through `onModelUpdated` as usual.
- **Polling, not push:** the backend asks Beszel every 30 s, and the app asks the backend every 15 s while the tab is visible. Beszel's agents only report about once a minute, so push (SSE) would add complexity with no gain.
- **No Google Fonts.** Loading fonts from Google's servers is a GDPR problem in Germany. The live UI uses the system font stack and `ui-monospace`. Self-hosted Geist can come later.

## Verified facts this plan relies on

- **Beszel v0.21.1** (MIT).
  - Collections: `systems` (status up/down/paused/pending; `info` carries cpu, memory % `mp`, disk % `dp`, bandwidth `bb`, load `la`, uptime `u`, temperature `dt`) and `containers` (name, image, status text, health 0–3 = none/starting/healthy/unhealthy, cpu %, memory MB, network bytes, an update-available flag, updated time).
  - Auth: `POST /api/collections/users/auth-with-password`.
  - A user with role `readonly` can list the systems they belong to (or all of them with Beszel's `SHARE_ALL_SYSTEMS=true`), plus those systems' containers. They cannot write anything. The rules are set in `internal/hub/collections.go`.
  - The agent only reports **running** containers, so a missing container means stopped or removed.
  - A container's ID changes on every redeploy, so the stable key is `beszel:<systemId>/<containerName>`.
- **Lib (`packages/fossflow-lib/src`):**
  - Zod schemas silently drop unknown keys, and the loader keeps the raw object (`hooks/useInitialDataManager.ts:59-70`). So a new optional `live` field is safe for old and new saved files.
  - The reducers are in `stores/reducers/{modelItem,viewItem,rectangle}.ts`. `useScene().setState` writes without history (`hooks/useScene.ts:141-147`). `utils/findNearestUnoccupiedTile.ts` exists.
  - Overlay pattern: a child of `<SceneLayer>` placed with `getTilePosition` (`utils/renderer.ts:85-110`), as in `ConnectorLabel.tsx`. The tile is 141.5 × 81.9 px.
  - Isometric icons are `<img>` tags 113.2 px wide, centred on the tile (`IsometricIcon.tsx`). Icons enter only through `model.icons`.
- **App (`packages/fossflow-app/src`):**
  - The editor is the `EditorPage` function inside `App.tsx`. `<Isoflow>` receives `initialData, onModelUpdated, editorMode, locale, iconPackManager` (around `App.tsx:795-810`).
  - Core icons are built at `App.tsx:21`.
  - `public/service-worker.js` serves **every same-origin GET from cache first**, `/api` included, so live data would freeze unless `/api` is excluded.
- **Backend:**
  - `server.js` uses ESM and Express 5. It has no auth, no tests and no `trust proxy` setting, so behind nginx every client shares one rate-limit bucket.
  - `docker-entrypoint.sh` only starts the backend when `ENABLE_SERVER_STORAGE=true`.
  - `compose.dev.yml` publishes port 3001 directly, which bypasses Basic Auth. That's for development only and will be documented.

## Architecture

```
Beszel hub ──(readonly user, REST, every 30 s)──▶ fossflow-backend /live module
   normalise → status rules → in-memory snapshot + 60-sample history per server
                     │  GET /api/live/status · GET /api/live/snapshot  (behind nginx Basic Auth)
                     ▼
fossflow-app  useLiveData(): checks status once, polls the snapshot every 15 s while visible
                     │  <Isoflow live={snapshot} />
                     ▼
fossflow-lib  live/ feature folder
   useLiveSync  → auto-places new servers (plate + server node) and containers (EDITABLE mode only, no history)
   LiveLayer    → status lights, metric chips, stopped "ghosts", unhealthy pulse, vitals card (option B)
```

**Binding:** nodes and rectangles get `live?: { key: string }`. A server's key is `beszel:<systemId>`; a container's is `beszel:<systemId>/<containerName>`. Bindings are saved inside the diagram, so moving, renaming and annotating an item all survive.

**Statuses** are decided in the backend; the lib stays source-agnostic.
- Containers: `unhealthy` → critical, `starting` → warning, otherwise ok.
- Servers: `down` → critical, `paused`/`pending` → unknown; any vital ≥ 90 % → critical, ≥ 80 % → warning.
- These thresholds are constants with a `ponytail:` note. Comparing against each thing's own baseline comes later.
- In the lib, a bound container missing from the snapshot shows as **stopped** (a ghost). A server missing from the snapshot dims its nodes as **unknown**.

**Vitals card (option B):**
- Every server node always shows a compact chip: `CPU 34 · MEM 61 · DISK 72`.
- The full card (sparklines for CPU, memory and disk; network, load, uptime and temperature) appears when the server node is **selected**, and **always** when the server is warning or critical.

## Implementation steps

Branch `feat/live-landscape` from `development`. Each step is verified and committed separately with conventional messages and no co-author lines. Each step also adds an entry to `docs/AUDIT.md`.

0. **Setup.**
   - Request keep-awake.
   - Create the branch.
   - Fix `.nvmrc` (16.19.0 → 24).
   - Add `docs/AUDIT.md`.
   - Commit this plan as `docs/superpowers/specs/2026-11-09-live-landscape-design.md`.
1. **Remove Live Analytics.**
   - Delete `components/LiveAnalytics/`, `stores/liveAnalyticsStore.tsx`, `types/liveAnalytics.ts`, `schemas/liveAnalytics.ts` and `docs/LIVE_ANALYTICS.md`.
   - Remove their wiring: the provider and prop in `Isoflow.tsx`, `liveAnalytics` in `types/isoflowProps.ts`, `liveAnalyticsEnabled` in `types/ui.ts` and `stores/uiStateStore.tsx`, the Settings tab in `SettingsDialog.tsx`, the `showLiveDataConfig` branch in `NodeSettings.tsx`, `showLiveAnalytics` in `UiOverlay.tsx`, the exports in `schemas/index.ts`, `types/index.ts` and `standaloneExports.ts`, and the README section.
2. **Backend live source** in `packages/fossflow-backend/live/`:
   - `config.ts`: reads and validates env: `BESZEL_URL` (must be http(s)), `BESZEL_EMAIL`, and `BESZEL_PASSWORD` or `BESZEL_PASSWORD_FILE` (for Docker secrets), plus `LIVE_POLL_SECONDS` (default 30, minimum 10). If anything is missing or invalid, live is disabled with one clear log line that never contains secrets.
   - `beszel.ts`: logs in, reuses the token, logs in again once on a 401, then fetches systems and containers (`perPage=500`, 10 s timeout). It turns Beszel records into the normalised types. Container kind comes from the image name (postgres/mysql/mariadb/mongo → database; redis/valkey/memcached → cache; rabbitmq/nats/kafka → queue; traefik/nginx/caddy/haproxy → gateway; otherwise container).
   - `types.ts`: `LiveSnapshot`, `LiveSystem` and `LiveContainer`. This file mirrors the lib's types; a comment marks it as the wire contract.
   - `hub.ts`: the poll loop, the last good snapshot, the per-source health, and a 60-sample history ring buffer.
   - `routes.ts`: an Express router with `GET /status` → `{enabled, sources:[{id,name,ok,lastSync,error?}]}` and `GET /snapshot`. Both send `Cache-Control: no-store` and are rate-limited (120/min). Errors returned to clients are sanitised.
   - `server.js`: add `app.set('trust proxy', 'loopback')` and mount `/api/live`. `/status` reports `{enabled:false}` when live isn't configured.
   - `live/testing/fakeBeszel.ts`: a tiny fake Beszel server used by the tests and by `npm run dev:fake-beszel`.
   - `package.json`: `test: node --test`, `lint: tsc -p .`, and dev dependencies `@types/node` and `@types/express`.
   - `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`.
3. **Deploy wiring.**
   - `docker-entrypoint.sh` starts the backend when storage is enabled **or** `BESZEL_URL` is set.
   - Add the new variables to `.env.example` and `compose.yml`.
   - `public/service-worker.js` stops intercepting `/api/` requests.
4. **Hairline icon pack** in `fossflow-lib/src/live/hairlineIcons.ts`:
   - Eight icons as inline SVG data URLs, drawn in the mockup style: server, container, database, cache, queue, gateway, globe, cloud.
   - All share one canvas whose centre is the block's footprint centre, so blocks sit exactly on their tile and the lid height of each kind is known.
   - Export `HAIRLINE_ICONS`, and add them to the app's core icons in `App.tsx:21`, so anyone can use them by hand with no backend.
5. **Model binding and discovery** in the lib:
   - Add `live: z.object({ key: z.string().max(300) }).optional()` to `schemas/modelItems.ts` and `schemas/rectangle.ts`.
   - Keep `live` in the compact export (`utils/exportOptions.ts`).
   - Strip `live` from pasted copies (`hooks/useScene.ts` paste) so two nodes never claim one container.
   - `live/types.ts`: the exported live types.
   - `live/layout.ts`: a **pure** `planLiveSync(model, viewId, snapshot)` → items, rectangles and icons to add, and rectangles to grow.
     - A new server gets a plate rectangle (neutral light fill) placed to the right of all existing content with a 2-tile gap, a server node at the plate's corner slot, and containers in a grid of 4 columns with 2-tile spacing.
     - A new container on a known server takes the next free slot on its plate; if none is left, the plate grows by 2 rows.
     - It never moves or deletes anything a person has placed.
   - `live/useLiveSync.ts`: runs when the snapshot changes, in `EDITABLE` mode only. It applies the plan with the existing reducers through `useScene().setState`, so nothing lands in undo history. It adds missing hairline icons to `model.icons`.
6. **Live overlay** in the lib:
   - `live/LiveContext.tsx`: provides a key → status lookup from the `live` prop, which is added to `types/isoflowProps.ts` and `Isoflow.tsx`.
   - `live/LiveLayer.tsx`, mounted in its own `<SceneLayer>` after Nodes in `Renderer.tsx` with `pointer-events: none`, draws:
     - a status light on the lid of hairline icons, or next to the label for other icons;
     - a mono chip under each container (`18% · 1.2 GB`, or `stopped`);
     - an amber pulse ring for unhealthy containers;
     - an `UPDATE` tag when an update is available;
     - each server's chip and `VitalsCard`.
   - `Node.tsx`: stopped or unknown nodes render at 35 % opacity, in greyscale.
   - `live/tokens.ts`: colour tokens from the design file (ink `#171717`, mute `#888`, ok `#29bc9b`, warning `#f5a623`, critical `#ee0000`, hairline `#ebebeb`).
   - Add a `live` section to `LocaleProps` and all 12 locale files, with short labels translated.
7. **App wiring.**
   - `services/liveService.ts` provides `useLiveData()`. It fetches status once, then the snapshot every 15 s while `document.visibilityState === 'visible'`. It backs off (×2 up to 2 min) on errors and does nothing when disabled.
   - Pass `live` to `<Isoflow>` in both the editor and the `/display` routes.
   - Add a small header chip: `● Live · Beszel`, or the source error.
   - Add new strings to the app's `src/i18n/*.json` and the `public/i18n/app` copies.
8. **Documentation.**
   - `docs/LIVE.md`: create a Beszel `readonly` user and give it the servers (or set `SHARE_ALL_SYSTEMS=true`), set the env variables, and the security notes (Basic Auth, never publish 3001, read-only scope).
   - A README section and `docs/AUDIT.md` entries.
9. **Review, push, draft PR.**
   - A code-review and security-review pass on Sonnet; fix anything CRITICAL or HIGH.
   - Push `feat/live-landscape` and open a draft PR into `development`.
   - Write a morning summary of what's done, verified and parked.

## Verification

- `npm ci` → `npm run lint` (lib + backend `tsc`) → `npm test` (lib Jest + backend `node:test`) → `npm run build`, all green before each feature commit.
- **New tests:**
  - Backend: config validation (missing or invalid vars disable live; secrets never logged), login and token reuse, re-login after a 401, record mapping (health, kind, thresholds), `/snapshot` contains no credentials, disabled mode.
  - Lib (Jest): `planLiveSync` (new server, new container goes to the next slot, a full plate grows, already-bound items are never duplicated or moved), the schema accepts `live`, paste strips `live`, a missing container becomes stopped.
- **End to end, locally, against a real Beszel:** run `henrygd/beszel` plus `henrygd/beszel-agent` in Docker on this Mac. The agent reads Docker through a read-only socket mount. Create a readonly user, run the backend with `BESZEL_*`, the app on :3000, and check in the browser pane:
  - (a) With no live config, the app behaves exactly like plain FossFLOW: no chip, no errors.
  - (b) Servers and containers appear on plates with hairline icons and correct statuses.
  - (c) Stopping a test container turns it into a ghost; an unhealthy health check shows the pulse; the vitals card appears on selection.
  - (d) Saving and reloading keeps the bindings without duplicates.
  - If setting up the Beszel user gets stuck, fall back to `fakeBeszel.ts` and park the real test.
- **Docker image:** `docker build` → run with `BESZEL_*` + `HTTP_AUTH_*` → `curl` confirms `/api/live/snapshot` returns 401 without credentials and 200 with them, and that the service worker no longer caches `/api`.

## Out of scope (later)

- Request-flow animation (OpenTelemetry/Tempo).
- Suggested or automatic connections.
- More sources (Portainer, Kubernetes, Prometheus) and our own agent.
- Comparing against each thing's own baseline.
- The chassis vitals variant.
- Detailed illustrated icons.
- Dark mode.
- Accounts and SSO.
- An existing bug where read-only mode still allows keyboard and context-menu edits.
- Removing the dead `EditorPage.tsx` and `usePersistedDiagram.ts`.
