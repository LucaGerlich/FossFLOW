# Live traffic, milestone 2: live map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor shows real traffic. Arrows between bound boxes carry one dot per real call, a few seconds behind reality, and nothing moves when nothing happens. Failing arrows and boxes say why. Clicking an arrow or a box opens a card with real numbers. A "Seen, not on the map" tray completes the map in a few clicks.

**Architecture:**
- **Server.** A `TrafficHub` receives every OTLP batch right after the aggregator (milestone 1) and fans the calls out, thinned per arrow, to Server-Sent Event streams per project. Two read endpoints compute the 5-minute summary and the arrow detail from `traffic_minute`, `traffic_hour` and `traffic_failure`.
- **Lib.**
  - A `traffic` binding goes on model items, next to `live`.
  - A pure matcher maps identities to boxes and arrows, and a pure scheduler times dots.
  - `TrafficLayer` moves the dots imperatively in one `requestAnimationFrame` loop. `TrafficOverlay` draws trouble, the cards and the tray.
- **App.** It polls the summary, owns the `EventSource` and hands both to `<Isoflow traffic={…}>`.

**Tech Stack:** NestJS 12 (ESM), Express 5, Drizzle 0.45 and Postgres 18, Vitest and Testcontainers on the server. React 19, MUI and zod 3 in the lib, tested with Jest and Testing Library. React Router 7 and TanStack Query in the app. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-live-traffic-alerts-design.md`, section 5 and milestone 2. Milestone 1 (`docs/superpowers/plans/2026-11-13-live-traffic-m1-ingest.md`) is done. Alerts, including "slow" trouble and "Alert me when…", are milestone 3.

**Mockups:** `.superpowers/brainstorm/70672-1794567803/content/live-traffic.html` (option C, calm and hairline) and `live-traffic-v2.html` (real timing). They are the reference for dots, pills, the box status line, the arrow card and the tray.

## My calls (veto any when approving)

1. **The summary returns every identity seen; the lib works out the tray.** Wildcards and aliases live in one matcher, in the lib, instead of being duplicated on the server.
2. **The summary is polled on every platform landscape (15 s), and the stream opens only once the summary shows traffic in the last 24 h.** This replaces the spec's "landscape has bindings or project has ingest keys". The cost is the same (one cheap query per 15 s), with one condition fewer.
3. **Viewers see a box's identities in its card**, read-only. The settings panel where editors edit them doesn't exist in read-only mode.
4. **Cards open by selection in the editor and by click in read-only mode.** For viewers, invisible hit areas lie over traffic arrows and bound boxes. In the editor they would steal clicks from normal editing, so there it's selection.
5. **Stream guard rails beyond the spec:**
   - at most 10 open streams per user;
   - each stream ends after 10 minutes, and `EventSource` reconnects by itself, which re-checks access, so a removed member drops off within 10 minutes;
   - a client that stops reading is cut off at 1 MiB buffered;
   - at most 400 dots per second per project, on top of the spec's 20 per arrow.
6. **Box totals for uninstrumented boxes** ("seen by callers") add up calls and failures. When a box matches several callee identities, the median is the busiest identity's and p95 is the highest.
7. **Lag:** p90 of the recent delivery delay plus 0.5 s, rounded up to 0.5 s and clamped to 2–15 s. A call that arrives after its play time plays at once instead of being dropped, so slow calls still show.
8. **A minute or hour bar in the arrow card is red** when it has failures and at least 5 % of its calls failed.

## Global Constraints

- **Git:**
  - Branch `feat/live-traffic`.
  - Conventional commits (`feat(server): …`, `feat(lib): …`, `feat(app): …`) with identity `LucaGerlich <lucagerlich@gmail.com>`, **no Co-Authored-By line and no mention of Claude**.
  - Run `/verify` before every non-docs commit. Never commit `.env` files.
- **Code style:**
  - match the existing files: 2-space indent in `.ts`/`.tsx`, 4-space in the app's i18n JSON;
  - ESM `.js` import suffixes in the backend;
  - TypeScript strict with no `any`;
  - errors name the field and rule, never the value.
- **Wire types are mirrored:** `packages/fossflow-backend/src/traffic/wire.ts` and `packages/fossflow-lib/src/traffic/types.ts` declare the same shapes, each with a "keep both in sync" header (the `live` types do the same).
- **Numbers:**
  - summary window 5 minutes, and "seen" means the last 24 hours;
  - summary polled every 15 s;
  - **failing** means at least 5 % failed **and** at least 5 failures in the window.
- **Stream limits:**
  - 20 dots per second per caller → callee pair, and 400 per second per project;
  - heartbeat comment every 25 s;
  - `retry: 2000`;
  - each stream ends after 10 minutes;
  - 1 MiB buffered at most;
  - 10 open streams per user.
- **Dots:**
  - travel time = call duration clamped to 800–4000 ms;
  - lag clamped to 2000–15000 ms;
  - at most 2000 pending dots in the browser;
  - **no React render per dot**: dot elements are moved imperatively in one `requestAnimationFrame` loop.
- **Bindings:** at most 20 identities per box, each 1–300 characters, matching `^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$`. A leading `*.` after the prefix is the only wildcard.
- **Edge requests:** 1–20 caller/callee pairs, each identity 1–300 characters; `range` is `1h`, `24h` or `7d`.
- **Privacy:** nothing new is stored. The stream, the summary and the edge detail carry only what milestone 1 already scrubbed (identities, operations, statuses, numbers).
- **UI text:**
  - Lib text goes through a new `traffic` namespace in `LocaleProps`, in **all 13** lib locale files (`packages/fossflow-lib/src/i18n/*.ts`). en-US is authoritative; the others are translated, as `live` was.
  - App text goes into **both** `packages/fossflow-app/src/i18n/en-US.json` and `packages/fossflow-app/public/i18n/app/en-US.json`; the two files stay byte-identical.
- **Look:** hairline. Use colour only for trouble, through `LIVE_TOKENS` in `packages/fossflow-lib/src/live/tokens.ts`. Healthy arrows have no labels.
- **Nothing regresses:** local mode, the static build, Beszel live data and saved landscapes behave as before. All existing tests stay green, and app `tsc` stays at its 7 known errors (`src/index.tsx`, `src/reportWebVitals.ts`).
- **Walkthroughs:**
  - Never touch the user's processes on ports 3000 and 3001 or the dev database `fossflow-db-1` (port 54320).
  - Walkthrough backends run from a scratch working directory, so they don't load `packages/fossflow-backend/.env`, on ports 4101 and 4102 with throwaway databases.
  - Test logins live only in the scratchpad.

## Review Focus

1. **A very busy arrow.** 5,000 calls in one batch must reach the browser as at most 20 dots, with weights adding up to 5,000, and the tab must stay smooth. → Task 1, "a flood is thinned to 20 dots with full weight".
2. **A browser clock several minutes off.** Dots must still play about one lag after the call, not minutes early or late. → Task 5, "a browser 5 minutes ahead still plays one lag after the call".
3. **The model is edited while dots are in flight** (the arrow is deleted, a box is moved, an identity is removed). Dots without a route must vanish without errors, and moved paths are used on the next frame. → Task 6, "dots without a route are skipped".
4. **A viewer is removed from the project, or signed out, while the stream is open.** The reconnect is refused (404 or 401), and the app backs off instead of hammering. → Task 2, "a removed member is refused on reconnect"; Task 9 backoff.
5. **Two boxes claim the same identity, or a wildcard overlaps an exact identity.** The exact identity wins, then the first box in model order, every time. → Task 4 matching table.

---

### Task 1: Percentiles, the traffic hub, and publishing from ingest

**Files:**
- Modify:
  - `packages/fossflow-backend/src/traffic/histogram.ts`
  - `src/ingest/otlp-handler.ts`
  - `src/ingest/ingest.module.ts`
  - `src/app.ts`
- Create:
  - `src/traffic/hub.ts`
  - `src/traffic/wire.ts`
- Test:
  - `src/traffic/histogram.test.ts`
  - new `src/traffic/hub.test.ts`
  - `src/ingest/ingest.test.ts`

**Interfaces:**
- Consumes: `TrafficEvent` and `TrafficBatch` from `src/ingest/spans.ts`; `DURATION_BOUNDS_MS` (21 bounds, 22 buckets, the last being overflow).
- Produces:
  - `percentileMs(histogram: readonly number[], q: number): number | null`.
    - Null when there are no calls.
    - Otherwise it finds the bucket holding rank `q × total` and interpolates linearly between the bucket's lower bound (0 for the first) and its upper bound.
    - The overflow bucket returns `30000`.
    - No rounding.
  - In `wire.ts`:
    - `TrafficDot = { caller: string; callee: string; start: number; durationMs: number; failed: boolean; weight: number }`. `start` is epoch ms on the server clock, i.e. `TrafficEvent.at`, which milestone 1 already anchors.
    - `TrafficStreamMessage = { sentAt: number; dots: TrafficDot[] }`.
  - `TrafficHub` (`@Injectable`), provided and exported by `IngestModule`:
    - `subscribe(projectId: string, listener: (message: TrafficStreamMessage) => void): () => void`;
    - `publish(projectId: string, events: readonly TrafficEvent[], now = Date.now()): void`.
  - Exported constants `DOTS_PER_ARROW_PER_SECOND = 20` and `DOTS_PER_PROJECT_PER_SECOND = 400`.
  - `createOtlpHandler(deps: { keys; aggregator; hub: TrafficHub })`. After `aggregator.add`, it calls `deps.hub.publish(key.projectId, batch.events)` with the same batch.

**How `publish` thins** (the spec leaves the algorithm open):
- Only `kind === 'call'` events become dots. If the project has no subscribers, return immediately and keep no state.
- Budgets run per project per wall-clock second `Math.floor(now / 1000)`: a map of arrow (`caller\0callee`) to dots sent, plus a project total. Both reset when the second changes. Drop the project's state when its last subscriber leaves.
- For each arrow, with its events sorted by `at`, `n` is the event count and `b = min(20 − arrowSent, 400 − projectSent)`.
  - If `b ≤ 0`, the arrow sends nothing this second; the numbers still count every call.
  - If `n ≤ b`, every event becomes a dot with weight 1.
  - Otherwise, dot `i` (0 ≤ i < b) is the event at index `floor(i·n/b)` and carries weight `floor((i+1)·n/b) − floor(i·n/b)`, so the weights add up to `n`.
- Send one message `{ sentAt: now, dots }` to every listener, and none when `dots` is empty. A listener that throws is caught and logged by error name only, and the others still receive the message.

- [ ] **Step 1: Write the failing tests**
  - `histogram.test.ts`:
    - an empty histogram → `null`;
    - 10 calls in bucket 6 (75–100 ms): p50 `87.5`, p95 `98.75`;
    - 90 calls in bucket 0 and 10 in bucket 21: p50 ≈ `2.78` (`toBeCloseTo(2.78, 2)`), p95 `30000`.
  - `hub.test.ts`:
    - "sends calls only to the project's subscribers": one call and one incoming event for project A. A's listener gets exactly one dot equal to `{ caller, callee, start: at, durationMs, failed, weight: 1 }`. B's listener gets nothing.
    - "a flood is thinned to 20 dots with full weight": 5,000 events on one arrow give 20 dots, the weights sum to 5,000, and `start` never decreases.
    - "the project cap holds": 30 arrows × 20 events give 400 dots in total.
    - "budgets reset each second": 30 events at `now = 1000` give 20 dots; 30 more at `1500` send no message; 30 more at `2000` give 20 dots.
    - "unsubscribe stops delivery, and a throwing listener doesn't stop the others".
  - `ingest.test.ts` (it already runs a listening app with the real exporter): subscribe to the project through `t.app.get(TrafficHub)`. After a real export of one client span, the listener has received one dot with that span's caller and callee.
- [ ] **Step 2: Run them.** Run `cd packages/fossflow-backend && npx vitest run src/traffic src/ingest`. Expected: FAIL.
- [ ] **Step 3: Implement** `percentileMs`, `wire.ts`, `TrafficHub`, the extra handler dependency and its wiring in `app.ts` and `IngestModule`.
- [ ] **Step 4: Run all backend tests.** Run `npm test` in the backend. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): traffic hub with per-arrow thinning, fed from ingest`

---

### Task 2: The SSE stream

**Files:**
- Create:
  - `packages/fossflow-backend/src/traffic/stream.ts`
  - `src/traffic/traffic.controller.ts`
  - `src/traffic/traffic.module.ts`
  - `src/test/stream.ts` (a test helper)
- Modify: `src/app.module.ts` (import `TrafficModule`)
- Test:
  - `src/traffic/stream.test.ts` (unit)
  - `src/traffic/traffic.test.ts` (end to end)

**Interfaces:**
- Consumes: `TrafficHub.subscribe` (Task 1); `RequireProjectScope('landscape:read', { target: 'landscape' })`; `CurrentProject` and `CurrentSession` (`src/auth/guards.ts`, `session.user.id`).
- Produces:
  - Constants: `HEARTBEAT_MS = 25_000`, `MAX_STREAM_MS = 600_000`, `RETRY_MS = 2_000`, `MAX_BUFFERED_BYTES = 1_048_576`, `MAX_STREAMS_PER_USER = 10`.
  - `StreamTarget`: `{ writeHead(status: number, headers: Record<string, string>): void; write(chunk: string): boolean; end(): void; on(event: 'close', listener: () => void): void; readonly writableLength: number }`. An Express `Response` satisfies it.
  - `openTrafficStream(target: StreamTarget, subscribe: (listener: (message: TrafficStreamMessage) => void) => () => void, timing = { heartbeatMs: HEARTBEAT_MS, maxMs: MAX_STREAM_MS }): void`. It does the following:
    - `writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })`, then writes `retry: 2000\n\n`;
    - writes each message as `data: <JSON>\n\n`, and `: ping\n\n` every `heartbeatMs`;
    - calls `end()` after `maxMs`, or as soon as `writableLength` exceeds `MAX_BUFFERED_BYTES` (checked before each write);
    - on `close`, unsubscribes and clears both timers, and writes nothing afterwards.
  - `TrafficModule` (not global) with `TrafficController` at `@Controller('landscapes/:id/traffic')`. `GET stream` needs `landscape:read`.
    - It counts open streams per user in memory. The 11th answers **429** `{ error: 'Too many open traffic streams' }`, and the count drops on close.
    - Then it calls `openTrafficStream(res, (l) => hub.subscribe(access.projectId, l))`.
    - It uses `@Res()`. The global throttler stays on, which also slows reconnect storms.
  - `src/test/stream.ts`: `openStream(baseUrl: string, path: string, cookie: string): Promise<{ status: number; headers: Headers; next(): Promise<string>; close(): void }>`. It uses `fetch` and reads the body stream; `next()` resolves with the next complete event block. It also exports a way to get a person's session cookie for `fetch`: sign in through `/api/auth/sign-in/email` with `fetch` against the listening server and take `set-cookie`, or read the supertest agent's jar. Whichever is simpler; keep it in this helper.

- [ ] **Step 1: Write the failing tests**
  - `stream.test.ts` uses a fake `StreamTarget` that records writes, `vi.useFakeTimers()` and a fake subscribe that captures the listener:
    - the head and headers exactly as above, and the first write is `retry: 2000\n\n`;
    - a message arrives as `data: {"sentAt":…,"dots":[…]}\n\n`;
    - a heartbeat `: ping\n\n` is written after 25 s;
    - after 10 minutes, `end()` is called and the unsubscribe function has run;
    - after `close`, publishing writes nothing and no timer fires;
    - with `writableLength` above 1 MiB, the next message ends the stream instead of writing.
  - `traffic.test.ts` uses a listening app (`t.app.listen(0, '127.0.0.1')`, as `ingest.test.ts` does) and an ingest key created through the API:
    - a project viewer opens the stream and gets 200, `text/event-stream` and `x-accel-buffering: no`. After an OTLP/JSON POST with one client span (build the payload as `otlp-handler.test.ts` does), the next `data:` block holds that dot;
    - an outsider gets 404 and a signed-out request gets 401;
    - "the 11th stream is refused": ten streams of one user stay open, the 11th gets 429, and after closing one a new one opens;
    - "a removed member is refused on reconnect": a member opens a stream, the owner removes them from the project, and a new stream request gets 404.
- [ ] **Step 2: Run them.** Run `npx vitest run src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** `stream.ts`, the controller, the module and the test helper.
- [ ] **Step 4: Run all backend tests.** Run `npm test`. Expected: PASS. No test leaves an open handle: every stream test closes its streams.
- [ ] **Step 5: Commit.** `feat(server): live traffic stream over server-sent events`

---

### Task 3: Summary and arrow detail

**Files:**
- Create: `packages/fossflow-backend/src/traffic/traffic-queries.ts`
- Modify:
  - `src/traffic/wire.ts`
  - `src/traffic/traffic.controller.ts`
  - `src/traffic/traffic.module.ts`
- Test:
  - new `src/traffic/traffic-queries.test.ts` (rows inserted directly, with a fixed `now`)
  - `src/traffic/traffic.test.ts` (routes)

**Interfaces:**
- Consumes: the milestone 1 tables (`trafficMinute`, `trafficHour`, `trafficFailure`, `trafficAlias`), `int_array_sum`, and `percentileMs` (Task 1).
  - Incoming rows have `caller = ''` and `callee = 'service:<name>'`.
  - Alias rows hold the **bare** host and service name, for example `b.internal` and `B`.
- Produces, in `wire.ts`:

```ts
export interface TrafficPair { caller: string; callee: string }
export interface TrafficStats {
  calls: number; failures: number; callsPerMin: number; failedPct: number; // 0–100
  p50Ms: number | null; p95Ms: number | null;
}
export interface TrafficAlias { host: string; service: string } // 'host:b.internal', 'service:B'
export interface TrafficSummary {
  generatedAt: string; windowMinutes: number;
  edges: (TrafficPair & TrafficStats & { lastSeenAt: string })[];
  callees: ({ callee: string } & TrafficStats)[];
  services: ({ service: string } & TrafficStats)[];
  aliases: TrafficAlias[];
}
export type TrafficRange = '1h' | '24h' | '7d';
export interface TrafficEdgeDetail {
  range: TrafficRange; stepSeconds: 60 | 3600; totals: TrafficStats;
  series: { at: string; calls: number; failures: number; p95Ms: number | null }[];
  operations: { operation: string; calls: number; failures: number; p50Ms: number | null; p95Ms: number | null }[];
  failures: { at: string; caller: string; callee: string; operation: string; status: string; durationMs: number }[];
}
```

- `TrafficQueries` (`@Injectable`, uses `DB`):
  - `summary(projectId: string, now: Date): Promise<TrafficSummary>`;
  - `edge(projectId: string, pairs: TrafficPair[], range: TrafficRange, now: Date): Promise<TrafficEdgeDetail>`.
- Routes on `TrafficController`, both needing `landscape:read` and sending `Cache-Control: no-store`:
  - `GET summary`;
  - `GET edge?caller=…&callee=…[&caller=…&callee=…]&range=1h`. Repeated keys arrive as arrays; zod checks equal lengths, 1–20 pairs, each identity 1–300 characters, and `range` (default `1h`). A bad query answers 400.

**What the numbers mean:**
- **Window.**
  - The summary window starts at `floorMinute(now) − 4 min`.
  - `windowMinutes = (now − start) / 60_000`, which lies in (4, 5].
  - `callsPerMin = calls / windowMinutes`.
  - `failedPct = 100 · failures / calls`, or 0 when there are no calls.
  - p50 and p95 come from the summed histogram.
- **`edges`.** Every `call` pair seen in the last 24 h, with its stats over the window (zeros and `null` when quiet). Ordered by window calls, then `lastSeenAt` descending; at most 2000.
  - "Seen" = `traffic_hour` rows with `hour ≥ floorHour(now) − 24 h` and `hour < cut`, plus `traffic_minute` rows with `minute ≥ cut`, where `cut = floorHour(now) − 1 h`.
  - `lastSeenAt` is the newest minute, or hour start, of those rows.
- **`callees`** sums `call` rows per callee in the window, for "seen by callers". **`services`** sums `incoming` rows per callee (a `service:` identity) in the window. Both include only identities with calls in the window.
- **`aliases`.** Hosts that exactly one service claimed in the last 24 h, returned in identity form: `{ host: 'host:' + host, service: 'service:' + service }`.
- **Edge ranges.**
  - `1h` is 60 minute points from `floorMinute(now) − 59 min`.
  - `24h` is 24 hour points from `floorHour(now) − 23 h`; `7d` is 168 from `floorHour(now) − 167 h`.
  - Hour points before `cut` come from `traffic_hour`; hour points at or after `cut` come from `traffic_minute` grouped by `date_trunc('hour', minute, 'UTC')`. That way nothing is counted twice: the roll-up runs every 10 minutes, well inside an hour.
  - All points are zero-filled.
  - `totals` covers the whole range, with `callsPerMin` over 60, 1440 or 10080 minutes.
  - `operations` is the top 10 by calls over the range.
  - `failures` is the newest 20 `traffic_failure` rows for the pairs since the range start.
  - Everything is filtered to the pairs and to the landscape's project.

- [ ] **Step 1: Write the failing tests**
  - `traffic-queries.test.ts`:
    - "summary stats": with `now = 12:02:30`, insert minute rows for one pair at 11:58–12:02: 300 calls and 15 failures, with a known histogram. The pair shows `callsPerMin = 300 / 4.5`, `failedPct = 5`, and p50/p95 equal to `percentileMs` of the summed histogram.
    - "quiet pairs still appear": a pair with only an hour row 03:00 three hours earlier is in `edges`, with `calls: 0`, `p50Ms: null` and `lastSeenAt` at that hour.
    - "incoming and callees": incoming rows give `services[0].service = 'service:billing'`, and call rows from two callers into one host give one `callees` entry with their sum.
    - "aliases": a host claimed by one service comes back prefixed; a host claimed by two services in 24 h is left out.
    - "other projects are invisible": rows of another project change nothing.
    - "edge 1h": 60 points; a minute with 2 failures has `failures: 2`; `operations` is sorted by calls, at most 10; `failures` is newest first and capped at 20.
    - "edge 24h counts each hour once": an old hour exists both as a `traffic_hour` row and as its minute rows and is counted once; the current hour comes from minutes.
    - "edge takes several pairs": two pairs, including `service:billing api` → `db:sql.example.net/members`, are summed in `totals`.
  - `traffic.test.ts`:
    - a viewer gets 200 for both routes; an outsider gets 404 and a signed-out request gets 401;
    - 400 for `range=2h`, for 2 callers with 1 callee, for 21 pairs and for a 301-character identity;
    - the encoded identity `service:billing api` round-trips through the query string.
- [ ] **Step 2: Run them.** Run `npx vitest run src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** `TrafficQueries`, using Drizzle `sql` with `int_array_sum(histogram)` and a `(caller, callee) IN (…)` filter built with `sql.join`, plus the two routes.
- [ ] **Step 4: Run all backend tests and coverage.** Run `npm test` and `npm run test:coverage`. Expected: PASS, with at least 80 % coverage of `src/traffic/*` from this milestone.
- [ ] **Step 5: Commit.** `feat(server): traffic summary and arrow detail endpoints`

---

### Task 4: The lib binding, wire types and identity matching

**Files:**
- Modify:
  - `packages/fossflow-lib/src/schemas/common.ts`
  - `src/schemas/modelItems.ts`
  - `src/standaloneExports.ts` (`export * from 'src/traffic'`)
- Create:
  - `src/traffic/types.ts`
  - `src/traffic/match.ts`
  - `src/traffic/index.ts`
- Test:
  - `src/traffic/__tests__/match.test.ts`
  - `src/schemas/__tests__/traffic.test.ts`

**Interfaces:**
- Produces:
  - `trafficIdentity = z.string().min(1).max(300).regex(/^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$/)`;
  - `trafficBinding = z.object({ ids: z.array(trafficIdentity).max(20) })`;
  - `modelItemSchema` gains `traffic: trafficBinding.optional()`. The backend's model check already keeps unknown item fields (`.loose()` records), so the server needs no change.
  - Use only zod calls that behave the same in zod 3 and 4 (`string`, `min`, `max`, `regex`, `array`, `object`, `optional`). A separate session is moving the lib to zod 4.
  - `types.ts` mirrors every type in `wire.ts` (Tasks 1 and 3) and adds the `<Isoflow>` prop type:

```ts
export interface TrafficFeed {
  summary: TrafficSummary | undefined;
  subscribe: (listener: (message: TrafficStreamMessage) => void) => () => void;
  loadEdge: (pairs: TrafficPair[], range: TrafficRange) => Promise<TrafficEdgeDetail>;
}
```

  - In `match.ts`:
    - `matchesIdentity(pattern: string, id: string): boolean`. An exact match always counts. A pattern `T:*.REST` matches an id `T:X.REST` where `X` is non-empty: same prefix, and a suffix check on `.REST`.
    - `TrafficIndex = { boxes: { itemId: string; exact: Set<string>; wildcards: string[] }[] }`, built by `buildTrafficIndex(items: ModelItem[], aliases: TrafficAlias[]): TrafficIndex`. Boxes appear in model order. A box's `exact` set also gets every alias host whose service the box binds exactly.
    - `boxOf(index: TrafficIndex, identity: string): string | null` returns the first box with an exact match, else the first box with a matching wildcard.
    - `findArrow(connectors: Connector[], a: string, b: string): { connectorId: string; reversed: boolean } | null` returns the first connector, in view order, whose first and last anchors have `ref.item` equal to `a` and `b` in either order. `reversed` is true when the first anchor is `b`. It ignores ends anchored to tiles or other anchors, and returns null for `a === b`.
    - `createRouter(index: TrafficIndex, connectors: Connector[]): (caller: string, callee: string) => { connectorId: string; reversed: boolean } | null` caches `boxOf` per identity in a `Map`.

- [ ] **Step 1: Write the failing tests**
  - `match.test.ts`:
    - wildcard table: `host:*.magicline.com` matches `host:api.magicline.com` and `host:a.b.magicline.com`, but not `host:magicline.com`, `host:evilmagicline.com` or `service:x.magicline.com`;
    - an alias makes a box bound to `service:sync` own `host:sync.internal`;
    - "exact beats wildcard": box 1 has `host:*.example.com` and box 2 has `host:api.example.com`, so `boxOf('host:api.example.com')` is box 2;
    - "first box wins": two boxes bind `service:a`, and box 1 (model order) wins;
    - `findArrow` works in both directions, with `reversed` correct;
    - with two connectors between the same boxes, the first in the view wins;
    - a connector whose end is a tile is ignored, and the same box twice gives null;
    - the router returns null when either box is missing.
  - `schemas/__tests__/traffic.test.ts`:
    - a model whose item has `traffic: { ids: ['service:a', 'host:*.b.com', 'db:x.net/members'] }` passes `modelSchema` and survives `JSON.parse(JSON.stringify(...))` unchanged;
    - 21 ids fail, `ftp:x` fails, a 301-character id fails, and `host:a*b` fails;
    - a model without `traffic` is still valid.
- [ ] **Step 2: Run them.** Run `cd packages/fossflow-lib && npx jest src/traffic src/schemas`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the types, the matcher and the exports.
- [ ] **Step 4: Run all lib tests and the type check.** Run `npm test` and `npm run lint` in the lib. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(lib): traffic identities on boxes and identity matching`

---

### Task 5: The dot scheduler and path geometry

**Files:**
- Create:
  - `packages/fossflow-lib/src/traffic/scheduler.ts`
  - `src/traffic/geometry.ts`
- Test: `src/traffic/__tests__/scheduler.test.ts`, `geometry.test.ts`

**Interfaces:**
- Consumes: `TrafficStreamMessage` (Task 4 types).
- Produces:
  - Constants: `MIN_TRAVEL_MS = 800`, `MAX_TRAVEL_MS = 4000`, `MIN_LAG_MS = 2000`, `MAX_LAG_MS = 15000`, `MAX_PENDING = 2000`.
  - `ActiveDot = { id: number; caller: string; callee: string; failed: boolean; weight: number; progress: number }`, with `progress` from 0 to 1.
  - `createDotScheduler(): DotScheduler`, where `DotScheduler = { receive(message: TrafficStreamMessage, browserNow: number): void; due(browserNow: number): ActiveDot[]; clear(): void; readonly lagMs: number; readonly offsetMs: number }`.
  - `pointAlong(points: Coords[], progress: number): Coords`: by arc length, with `progress` clamped to 0–1. A single point returns itself.
  - `connectorScenePoints(tiles: Coords[], origin: Coords): Coords[]`: each path tile goes through `connectorPathTileToGlobal(tile, origin)` and then `getTilePosition({ tile })`. Follow `components/SceneLayers/ConnectorLabels/ConnectorLabel.tsx`, which places labels the same way.

**Timing (pinned):**
- **Offset.** `offsetMs` is the minimum of `browserNow − sentAt` over the last 20 messages.
- **Lag samples.** Each dot with `durationMs ≤ 2000` contributes `sentAt − start`; keep the last 200.
- **Lag.** `lagMs = clamp(ceilTo500(p90(samples) + 500), 2000, 15000)`, and 2000 while there are no samples.
- **Play time.** `playAt = start + offsetMs + lagMs`. If that is already past, `playAt = browserNow`, so late dots play at once.
- **Travel.** `travelMs = clamp(durationMs, 800, 4000)`.
- **Pending.** At most 2000 dots wait; the oldest are dropped first.
- **`due(now)`.** Returns dots with `playAt ≤ now < playAt + travelMs`, where `progress = (now − playAt) / travelMs`, and forgets dots that have finished.
- **`clear()`.** Empties the queue. The layer calls it when the tab is hidden, so coming back starts from now.

- [ ] **Step 1: Write the failing tests**
  - `scheduler.test.ts`:
    - "a browser 5 minutes ahead still plays one lag after the call": with `sentAt = 1_000_000` and `browserNow = 1_300_000`, a dot with `start = 999_800` and a duration of 100 ms gets `playAt = 999_800 + 300_000 + 2000`;
    - lag clamps: delays around 300 ms keep `lagMs` at 2000, and delays of 30 s cap it at 15000;
    - a dot whose play time has passed gets `playAt = browserNow`;
    - travel clamps 50 ms to 800 and 10 s to 4000;
    - `due` halfway through the travel gives `progress` 0.5, and finished dots are gone on the next `due`;
    - `clear()` leaves `due` empty;
    - 2500 received dots keep the newest 2000.
  - `geometry.test.ts`:
    - the midpoint of a two-point line;
    - an L-shaped path with segments of 1 and 3 units: `progress` 0.5 lands on the second segment;
    - `progress` −1 and 2 clamp to the ends.
- [ ] **Step 2: Run them.** Run `npx jest src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** the scheduler and the geometry helpers.
- [ ] **Step 4: Run the lib tests.** Run `npm test` in the lib. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(lib): dot scheduler with server-clock offset and lag`

---

### Task 6: The `traffic` prop, dots and trouble

**Files:**
- Modify:
  - `packages/fossflow-lib/src/types/isoflowProps.ts` (adds the `traffic?: TrafficFeed` prop and a `traffic` namespace in `LocaleProps`)
  - all 13 `src/i18n/*.ts`
  - `src/Isoflow.tsx`
  - `src/components/Renderer/Renderer.tsx`
- Create:
  - `src/traffic/TrafficContext.tsx`
  - `src/traffic/stats.ts`
  - `src/traffic/format.ts`
  - `src/traffic/TrafficLayer.tsx`
  - `src/traffic/TrafficOverlay.tsx`
- Test: `src/traffic/__tests__/stats.test.ts`, `format.test.ts`, `TrafficLayer.test.tsx`, `TrafficOverlay.test.tsx`

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces:
  - `TrafficProvider({ feed?: TrafficFeed; children })`, and `useTraffic(): TrafficState | null` with `TrafficState = { feed: TrafficFeed; index: TrafficIndex; arrows: Map<string, ArrowTraffic>; weights: Map<string, number> }`.
    - `index` is rebuilt from the model store's items and `summary.aliases`.
    - `arrows` is rebuilt from the summary and the current view's connectors.
    - `weights` holds the latest dot weight per connector; `TrafficLayer` writes it.
    - The value is `null` without a feed. `<Isoflow>` then behaves exactly as today.
  - In `stats.ts`:
    - `ArrowTraffic = { connectorId: string; pairs: TrafficPair[]; callers: string[]; calls: number; failures: number; callsPerMin: number; failedPct: number; p50Ms: number | null; p95Ms: number | null }`. It covers every summary edge routed to that connector, in both directions. p50 comes from the busiest pair, and p95 is the highest.
    - `arrowTraffic(summary: TrafficSummary, index: TrafficIndex, connectors: Connector[]): Map<string, ArrowTraffic>`.
    - `isFailing(stats: { calls: number; failures: number }): boolean` is `failures >= 5 && 100 * failures / calls >= 5`.
    - `boxTrouble(itemId: string, state: TrafficState, names: Map<string, string>): { failedPct: number; callerName: string | null } | null`. It picks the worst failing arrow into the box (`callerName` = the caller box's name). Without one, it falls back to the box's own failing `services` entry (`callerName: null`).
  - In `format.ts`:
    - `formatRate(perMin)`: `210/min`, one decimal below 10, e.g. `4.2/min`;
    - `formatMs(ms)`: `95 ms`, or `1.2 s` from 1000;
    - `formatPct(pct)`: `4.1%`;
    - `fill(template: string, vars: Record<string, string>): string` replaces `{name}`. The lib's `t()` has no interpolation.
  - `drawFrame(dots: ActiveDot[], route: (caller: string, callee: string) => { connectorId: string; reversed: boolean } | null, pathOf: (connectorId: string) => Coords[] | null): { id: number; x: number; y: number; failed: boolean }[]`. Pure: dots without a route or a path are skipped, and a reversed route uses `1 − progress`.
  - `TrafficLayer` (no props; it reads the scene's connectors).
    - It sits in a `SceneLayer` right after `Connectors` and renders one SVG in scene coordinates with `overflow: visible` and `pointer-events: none`. It holds:
      - red overlay polylines (`LIVE_TOKENS.critical`, 2 px) over failing arrows. The connector's own colour never changes;
      - a `<g>` of dot circles: radius 3, `LIVE_TOKENS.ink`, or `LIVE_TOKENS.critical` when failed.
    - An effect subscribes to `feed.subscribe`, feeds the scheduler and records weights. It runs one `requestAnimationFrame` loop: `due(now)` → `drawFrame` → it reuses or creates circle elements and sets `cx`/`cy` directly. It clears the scheduler on `visibilitychange` to hidden, and cleans everything up on unmount.
  - `TrafficOverlay({ nodes })` sits in a `SceneLayer` right after `LiveLayer`. In this task it draws:
    - **a pill on each failing arrow**, at the path's midpoint: `{rate} · {median} · {pct} failed` in `LIVE_TOKENS.criticalDeep`, styled like LiveLayer's `Chip`;
    - **one status line under each troubled box**, positioned like LiveLayer's chip: `{pct} of calls from {caller} fail` or `{pct} of incoming requests fail`.
    - Healthy arrows and boxes get nothing.
  - **Locale namespace `traffic`** (en-US), with every key Tasks 7 and 8 need, so the 13 locale files change only once:
    - **Map:**
      - `pillFailed: '{pct} failed'`;
      - `boxFailingFrom: '{pct} of calls from {caller} fail'`;
      - `boxFailingIncoming: '{pct} of incoming requests fail'`.
    - **Cards:**
      - `seenBy: 'As seen by {caller}'`, `seenByCallers: 'Seen by callers'`, `incoming: 'Incoming'`;
      - `dotWeight: '1 dot ≈ {n} calls'`;
      - `callsPerMin: 'Calls/min'`, `failed: 'Failed'`, `median: 'Median'`, `p95: 'Slowest 5%'`;
      - `range1h: '1h'`, `range24h: '24h'`, `range7d: '7d'`;
      - `busiest: 'Busiest calls'`, `recentFailures: 'Recent failures'`, `noFailures: 'No failures'`;
      - `noTraffic: 'No calls in the last 5 minutes'`, `loading: 'Loading…'`, `loadFailed: 'Could not load traffic'`;
      - `close: 'Close'`, `identities: 'Identities'`.
    - **Identity editing:**
      - `section: 'Live traffic'`, `addIdentity: 'Add an identity'`;
      - `identityHint: 'service:name, host:api.example.com, host:*.example.com or db:server/database'`;
      - `invalidIdentity: 'Start with service:, host: or db:, then a name. A leading *. is the only wildcard.'`;
      - `tooManyIdentities: 'At most 20 identities'`.
    - **Tray:**
      - `seenTitle: 'Seen, not on the map'`, `seenCount: 'Seen, not on the map · {n}'`;
      - `unplacedTitle: 'Not on the map'`, `unconnectedTitle: 'Calls without an arrow'`;
      - `place: 'Place'`, `drawArrow: 'Draw arrow'`.

    The spec fixes the wording of `pillFailed`, `boxFailingFrom`, `seenBy`, `seenByCallers`, `dotWeight`, `section`, `seenTitle`, `place` and `drawArrow`.

- [ ] **Step 1: Write the failing tests**
  - `stats.test.ts`:
    - A→B and B→A edges routed to one connector are summed, with both pairs listed;
    - `isFailing`: 4 of 10 → false; 5 of 100 → true; 5 of 101 → false;
    - `boxTrouble` picks the worst arrow and falls back to `services`.
  - `format.test.ts`: `formatRate(210)` → `210/min`, `formatRate(4.2)` → `4.2/min`, `formatMs(95)` → `95 ms`, `formatMs(1234)` → `1.2 s`, `formatPct(4.1)` → `4.1%`, and `fill('{a}-{b}', {a: '1', b: '2'})` → `1-2`.
  - `TrafficLayer.test.tsx`:
    - "dots without a route are skipped": `drawFrame` with one routable dot, one dot whose route is null (identity removed) and one whose path is null (arrow deleted) returns one position, without throwing;
    - a reversed route at `progress` 0.25 sits at 75 % of the path;
    - mounting `<Isoflow traffic={fakeFeed}>` subscribes once, and unmounting unsubscribes.
  - `TrafficOverlay.test.tsx`:
    - with a summary edge of 1050 calls, 43 failures and p50 95 ms over a 5-minute window, routed to an arrow, the pill reads `210/min · 95 ms · 4.1% failed`;
    - a healthy edge renders no pill;
    - without `traffic`, nothing from the traffic layers renders.
- [ ] **Step 2: Run them.** Run `npx jest src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** the prop, the provider (`<TrafficProvider feed={traffic}>` wrapping `Renderer` and `UiOverlay` inside `LiveProvider`), the stats, the formats, both layers, the `Renderer` placement and the locale keys.
- [ ] **Step 4: Run all lib tests, the type check and the build.** Run `npm test`, `npm run lint` and `npm run build` in the lib. Expected: PASS. The existing live and connector tests are unchanged.
- [ ] **Step 5: Commit.** `feat(lib): live traffic dots and trouble on the map`

---

### Task 7: Arrow and box cards

**Files:**
- Create:
  - `packages/fossflow-lib/src/traffic/ArrowCard.tsx`
  - `src/traffic/BoxCard.tsx`
  - `src/traffic/useTrafficSelection.ts`
- Modify: `src/traffic/TrafficOverlay.tsx`
- Test: `src/traffic/__tests__/ArrowCard.test.tsx`, `BoxCard.test.tsx`

**Interfaces:**
- Consumes: `TrafficState`, `ArrowTraffic`, `fill` and the formats (Task 6); `feed.loadEdge` (Task 4).
- Produces:
  - `useTrafficSelection(): { selection: { type: 'arrow'; connectorId: string } | { type: 'box'; itemId: string } | null; select(next): void; close(): void; readOnly: boolean }`.
    - In `EDITABLE` mode it follows `uiState.itemControls`: a `CONNECTOR` that carries traffic means an arrow, and an `ITEM` with `traffic` ids or a matching summary entry means a box. `select` does nothing there.
    - Otherwise it is local state. `TrafficOverlay` then renders invisible hit areas, which toggle the selection: a 16 px `pointer-events: stroke` polyline over each traffic arrow, and a 48 px circle over each bound box.
    - Escape and the card's close button call `close()`.
  - `ArrowCard({ arrow: ArrowTraffic; anchor: Coords; title: string; onClose })` is a 280 px card on a leader line, styled like `VitalsCard`. It shows:
    - the title `Caller box → Callee box`;
    - `As seen by {caller}`, joined when there are several callers;
    - stats from the summary: calls/min, failed, median and p95;
    - `1 dot ≈ {n} calls` when `weights.get(connectorId) > 1`;
    - range tabs `1h | 24h | 7d`;
    - a bar series where a bar is red when `failures > 0 && failures / calls ≥ 0.05`, marked `data-failing="true"`;
    - the busiest calls (top 5 of `operations`), and recent failures (top 5: time, operation, status, duration).

    It calls `loadEdge(arrow.pairs, range)` on open and on range change, and again every 15 s while open. It shows loading and error states (`traffic.loadFailed`).
  - `BoxCard({ itemId: string; anchor: Coords; onClose })`:
    - **A box binding a `service:` id with a `services` entry** shows `Incoming` and those stats.
    - **Otherwise** it sums the matching `callees` (`Seen by callers`), with p50 from the busiest and p95 the highest.
    - **With no calls in the window** it shows `traffic.noTraffic`.
    - It always lists the box's identities, read-only. This is how viewers see them.

- [ ] **Step 1: Write the failing tests** (Testing Library, with a fake feed whose `loadEdge` is a `jest.fn`)
  - `ArrowCard.test.tsx`:
    - on open, `loadEdge` is called with the arrow's pairs and `'1h'`;
    - the resolved detail's operations and failures render;
    - clicking `24h` calls `loadEdge(..., '24h')`;
    - a rejected promise shows the error text;
    - a bar with 3 of 20 calls failed has `data-failing="true"`, and one with 1 of 100 doesn't;
    - with weight 12 recorded, `1 dot ≈ 12 calls` shows.
  - `BoxCard.test.tsx`:
    - a `service:billing` box shows its incoming numbers;
    - a box with `host:*.magicline.com` sums two matching callees;
    - the identities are listed.
- [ ] **Step 2: Run them.** Run `npx jest src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** the selection hook, both cards, and their placement in `TrafficOverlay`, anchored at the arrow's path midpoint or the box's tile centre.
- [ ] **Step 4: Run all lib tests and the type check.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(lib): arrow and box traffic cards`

---

### Task 8: Editing identities and the "Seen, not on the map" tray

**Files:**
- Create:
  - `packages/fossflow-lib/src/traffic/seen.ts`
  - `src/traffic/TrafficIdentities.tsx`
  - `src/traffic/SeenTray.tsx`
- Modify:
  - `src/components/ItemControls/NodeControls/NodeSettings/NodeSettings.tsx` (adds the section after Description)
  - `src/components/UiOverlay/UiOverlay.tsx` (shows the tray in `EDITABLE` only)
- Test: `src/traffic/__tests__/seen.test.ts`, `TrafficIdentities.test.tsx`, `SeenTray.test.tsx`

**Interfaces:**
- Consumes: `trafficIdentity` and `boxOf`/`findArrow` (Task 4); `useTraffic` (Task 6); `useScene().placeIcon` and `createConnector`; `screenToIso`; `findNearestUnoccupiedTile`; `HAIRLINE_ICONS` and `HAIRLINE_ICON_IDS`.
- Produces:
  - `seenEntries(summary: TrafficSummary, index: TrafficIndex, connectors: Connector[]): { unplaced: { identity: string; calls: number; lastSeenAt: string }[]; unconnected: { fromItemId: string; toItemId: string; calls: number }[] }`.
    - `unplaced` holds every caller, callee and service identity with no box. A host aliased to a service is left out, since the service stands for it.
    - `unconnected` holds pairs whose two boxes are placed, are different and have no arrow in either direction. They are deduplicated per unordered box pair, with `from` = the caller's box.
    - Both are sorted by window calls, then `lastSeenAt` descending, and capped at 50.
  - `suggestIdentities(summary, index): string[]` is the `unplaced` identities.
  - `TrafficIdentities({ ids: string[]; onChange(ids: string[] | undefined): void })` is the `Live traffic` section:
    - MUI chips with delete;
    - an `Autocomplete` with `freeSolo`, whose options are `suggestIdentities`;
    - Enter adds a valid, new id;
    - an invalid id or a 21st id shows an inline error and changes nothing;
    - removing the last id calls `onChange(undefined)`.

    `NodeSettings` wires it to `onModelItemUpdated({ traffic: ids ? { ids } : undefined })`.
  - `SeenTray`: a chip in the bottom-right, `Seen, not on the map · N`, which expands to the two lists. Hidden when both are empty.
    - **Place** for an identity:
      - adds the hairline icon if the model lacks it, the way `live/sync.ts` `ensureIcon` does. The icon is `container` for `service:`, `globe` for `host:` and `database` for `db:`;
      - names the box after the identity without its prefix, cut to 100 characters;
      - puts it at `findNearestUnoccupiedTile(screenToIso(viewport centre), scene)`, or at the centre tile;
      - calls `placeIcon({ modelItem: { id, name, icon, traffic: { ids: [identity] } }, viewItem: { id, tile, labelHeight } })`. That is one undo step.
    - **Draw arrow** calls `createConnector({ id, color: scene.colors[0].id, anchors: [{ id, ref: { item: from } }, { id, ref: { item: to } }] })`, as `interaction/modes/Connector.ts` builds connectors.

- [ ] **Step 1: Write the failing tests**
  - `seen.test.ts`:
    - placed identities are excluded;
    - an aliased host is hidden behind its service;
    - a pair with an arrow in either direction is not `unconnected`;
    - same-box pairs are excluded;
    - the sort order and the cap of 50 hold.
  - `TrafficIdentities.test.tsx`:
    - typing `host:*.magicline.com` and Enter calls `onChange(['service:a', 'host:*.magicline.com'])`;
    - `ftp:x` shows the error and doesn't call `onChange`;
    - a 21st id is refused;
    - deleting the only chip calls `onChange(undefined)`.
  - `SeenTray.test.tsx`, with `useScene` mocked:
    - Place on `db:sql.example.net/members` calls `placeIcon` with that `traffic` binding and the `hairline-database` icon;
    - Draw arrow calls `createConnector` with both item refs;
    - the tray is absent in `EXPLORABLE_READONLY`.
- [ ] **Step 2: Run them.** Run `npx jest src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files and the two placements.
- [ ] **Step 4: Run all lib tests, the type check and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(lib): edit traffic identities and place what's seen but not on the map`

---

### Task 9: App wiring

**Files:**
- Create:
  - `packages/fossflow-app/src/platform/traffic.ts`
  - `src/components/TrafficIndicator.tsx`
- Modify:
  - `src/platform/pages/LandscapeEditor.tsx`
  - `src/i18n/en-US.json`
  - `public/i18n/app/en-US.json`

**Interfaces:**
- Consumes: `api()` and `ApiError` (`src/platform/api.ts`); the lib's `TrafficFeed`, `TrafficSummary`, `TrafficStreamMessage`, `TrafficPair`, `TrafficRange` and `TrafficEdgeDetail` (exported by Task 4).
- Produces:
  - `trafficSummaryKey(landscapeId)`, and `useTrafficSummary(landscapeId: string)`: a `useQuery` on `/api/landscapes/:id/traffic/summary` with `refetchInterval: 15_000`.
  - `loadTrafficEdge(landscapeId: string, pairs: TrafficPair[], range: TrafficRange): Promise<TrafficEdgeDetail>`. It builds the query with `URLSearchParams.append('caller' | 'callee', …)` per pair.
  - `useTrafficStream(landscapeId: string, enabled: boolean): { subscribe: TrafficFeed['subscribe']; status: 'off' | 'connecting' | 'live' }`:
    - one `EventSource` on `/api/landscapes/:id/traffic/stream` while `enabled` and the tab is visible;
    - `onopen` → `live`;
    - `onmessage` parses JSON. It drops messages that lack a numeric `sentAt` or a `dots` array, and fans out to a `Set` of listeners;
    - on `onerror` with `readyState === CLOSED` (a 401, 404 or 429): status `connecting`, then reopen after a backoff of 2 s, doubling up to 120 s, reset on `onopen`. While the browser itself reconnects (`CONNECTING`), the status is `connecting`;
    - closed on hide, reopened on show, closed on unmount;
    - `subscribe` keeps the same identity for the hook's lifetime.
  - `useTrafficFeed(landscapeId: string): { feed: TrafficFeed | undefined; status }`:
    - `enabled` = the summary has any `edges` or `services`;
    - `feed` is `undefined` until the first summary arrives.
  - `TrafficIndicator({ status })` returns null for `off`. Otherwise it renders a badge like `LiveIndicator`: `badge` with `live.trafficLive` = `Traffic · live`, or `badge badge--muted` with `live.trafficConnecting` = `Traffic · connecting`.
  - `LandscapeEditor`: calls `useTrafficFeed(landscape.id)`, renders `TrafficIndicator` next to `LiveIndicator`, and passes `traffic={traffic.feed}` to `<Isoflow>`.

- [ ] **Step 1: Implement.** The app has no test runner, so this task is checked by types, the build and Task 10's walkthrough.
- [ ] **Step 2: Check types and build.**
  - `npm run build -w fossflow-lib` first, so the app sees the new lib.
  - In `packages/fossflow-app`, `npx tsc --noEmit` shows exactly the 7 known errors.
  - `npm run build` passes.
  - `cmp src/i18n/en-US.json public/i18n/app/en-US.json` reports no difference.
- [ ] **Step 3: Commit.** `feat(app): live traffic in the landscape editor`

---

### Task 10: Real walkthrough, Docker check and wrap-up

**Files:**
- Modify: `docs/AUDIT.md` (the milestone 2 entry)
- Scratch only: everything else (sample services, env files, logins).

- [ ] **Step 1: Real services.**
  - Start a throwaway Postgres and the backend on port 4102, from a scratch working directory, with the app served on port 4101.
  - Create a project, an ingest key and a landscape.
  - Paste the Node setup block unchanged into a small sample service (the milestone 1 scratch apps can be reused) that calls a fake HTTP API and Postgres on a timer, with pauses.
- [ ] **Step 2: Browser walkthrough, as editor.** Use the built-in browser, and take a screenshot at each point:
  1. dots appear on the bound arrow within about the lag;
  2. nothing moves during the sample service's pauses;
  3. the tray lists the fake API host. **Place** puts a box with that identity, and undo removes it again;
  4. with two placed boxes, **Draw arrow** connects them, and dots start;
  5. clicking the arrow opens its card with numbers, the series, operations and failures; switching range works;
  6. making the fake API fail (500) turns the arrow red with a pill, and the box shows its status line;
  7. adding and removing identity chips in the box settings works;
  8. the pill shows `Traffic · live`.
- [ ] **Step 3: Browser walkthrough, as viewer.**
  - Dots and trouble show.
  - Clicking an arrow and a box opens their cards, and the box card lists its identities.
  - There is no tray and no identity editing.
- [ ] **Step 4: Nothing regressed.**
  - A Beszel-bound landscape still shows live data.
  - The static build (local mode) loads and edits without any `/api/landscapes/*/traffic` request.
  - A JSON export and import of a landscape with bindings keeps them.
- [ ] **Step 5: Docker.**
  - Build the image and start it with the real `compose.yml` in a scratch project directory.
  - `curl -N` the stream through nginx with a session cookie: `retry: 2000` arrives at once, and a dot arrives within about a second of a POSTed span, so nginx isn't buffering.
  - Then `docker compose down -v` and delete the scratch directory.
- [ ] **Step 6: Wrap up.**
  - Run `/verify`, then a security review of the milestone diff on a Sonnet subagent. Focus on the stream's access checks and resource limits, and on query building in `traffic-queries.ts`.
  - Add the `docs/AUDIT.md` entry: what changed, the calls above, and accepted risks.
  - Commit (`docs: live traffic milestone 2 audit`) and push.
  - Update the draft PR #7 body: M2 ✅, with the decisions and the verification.
  - Stop every server started here.
