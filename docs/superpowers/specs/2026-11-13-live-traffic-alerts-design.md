# Platform phase 2a: live traffic and alerts

## Context

Phase 1 (done, PR #6) made FossFLOW a self-hosted platform: logins, projects with roles, landscapes stored in Postgres, and encrypted credentials for pluggable live-data connectors. The only connector is Beszel, which shows server vitals and containers on boxes.

That doesn't cover a landscape like fitseveneleven's (`Systemlandschaft IT`):
- websites and apps on one side;
- **MagicLine**, a SaaS, at the core;
- Azure DB, then the DWH, then BI on the other side.

Most boxes are not machines the team runs. The arrows are **API calls and database queries**, and **nothing records them today**.

The user wants three things:
- **that map, live:** data visibly flowing as it happens, with the real stats of each system;
- **a Sentry/GlitchTip-like hook-up:** each service reports the calls it makes and their results;
- **alerts by email and chat** when something goes wrong.

Audiences, from phase 1:
1. engineers watching what is going on;
2. people asking what is connected and why data flows where it does;
3. a manager who wants to read the landscape quickly.

**Agreed in conversation (2026-11-10 to 2026-11-13):**
- **Option C of the mockups:** calm motion, and only trouble is labelled.
  - Healthy arrows stay quiet.
  - A slow or failing arrow turns colour and says why, and the affected box says it too.
  - Hairline style; colour only for trouble.
- **Motion is real.** One dot per call, drawn when the call happened. When nothing is being sent, nothing moves. The map runs a few seconds behind, keeping the real spacing between calls.
- **Slow calls travel slower** (a minimum and maximum travel time keep them readable).
- **The arrow panel**, opened by clicking an arrow, shows:
  - calls per minute, % failed, typical (median) time and the slowest 5 % (p95);
  - the last hour, with failing minutes in red;
  - the busiest calls;
  - the most recent failures.
- **"Seen, not on the map":** systems that services call but nobody has placed yet. The user places them and draws the arrows, so placement is never automatic.
- **Hook-up uses OpenTelemetry, with no home-made SDK.** Services are mostly **Node and Next.js**, and it must stay extensible to other languages and source types.
- **FossFLOW receives the data itself**, so it is still one `docker compose up`.
- **Alerts: yes**, by email and chat.
- **The workbench** (documented flows, step playback, sequence view) moves to **phase 2b**, which can later replay real traffic from 2a.

**Prior art:**
- Azure Application Insights' Application Map, and Grafana Tempo's service graphs: an uninstrumented callee becomes a "virtual node" named from the call's attributes. That is our "seen, not on the map".
- Sentry and GlitchTip: the hook-up experience.

## Goals

1. A team connects a Node or Next.js service in a few minutes: one key, a ready-to-paste block of settings, and no code changes for Node.
2. Every arrow between boxes that carry traffic shows **one dot per real call**, a few seconds behind reality. Failures show as red dots, and nothing moves when nothing happens.
3. **Real numbers** for every arrow and box: calls/min, % failed, median and p95, the busiest operations and recent failures. This includes SaaS and managed databases, seen from their callers.
4. **Unknown systems surface** in a "seen, not on the map" list, and so do calls between placed boxes that have no arrow, so the map can be completed by hand in a few clicks.
5. **Alerts** when an arrow or box is failing, slow or silent, sent by email, Slack, Microsoft Teams or a generic webhook. There is one message when an alert starts, one when it clears, and a reminder while it lasts.
6. Anything that speaks **OTLP** (any language with an OpenTelemetry SDK, or an OpenTelemetry Collector) works without changes on our side.

## Non-goals (for 2a)

- **Error tracking** with exception messages and stack traces stays with GlitchTip/Sentry.
- **Distributed-trace views:** waterfalls, span search, or pairing client and server spans into one trace.
- **Metrics and logs ingestion.** Prometheus, Azure Monitor and similar can come later as connectors.
- **Browser instrumentation (RUM).** Calls made from visitors' browsers, such as an embedded booking widget, are not seen.
- **Messaging spans** (producer and consumer, e.g. queues) are ignored for now.
- **Automatic placement or connection** of discovered systems.
- On-call schedules, escalation, PagerDuty, and per-user notification preferences.
- Discord as a named channel type; the generic webhook covers it.
- Running several FossFLOW server instances behind a load balancer.
- The phase 2b workbench.

## Anti-goals (failure even if it works)

- **Member or customer data ends up stored.** This includes IDs in URLs, query strings, SQL literals and exception messages, and alerts must not carry any of it either.
- **Fake motion.** Dots that loop on a timer instead of showing real calls.
- **Alert spam.** For example, a message every minute while something stays broken, or false "silent" alerts after FossFLOW itself restarts.
- **FossFLOW slows the services it watches.** Ingest must answer fast, and exporters batch.
- **Plain FossFLOW regresses.** Local mode, the static build, Beszel live data and saved landscapes must behave exactly as before.

## Constraints

- Phase 1's stack and patterns: NestJS 12 ESM, Drizzle 0.45 with migrations on boot, Postgres 18, zod 4, Vitest with Testcontainers, React Router 7 with TanStack Query in the app, and the hairline design tokens.
- **No new infrastructure.** No Collector, Tempo, Redis or message queue is required. Postgres is the only store.
- **A single server process.** In-memory fan-out is fine. *Ponytail:* it moves to Postgres `LISTEN/NOTIFY` if FossFLOW ever runs as several instances.
- Instrumented Node services need **Node ≥ 22.15** for the current `@opentelemetry/auto-instrumentations-node` (0.83.x).
- **Docs verified 2026-11-13:**
  - OTLP/HTTP spec;
  - semantic conventions for HTTP and database client spans;
  - `@opentelemetry/auto-instrumentations-node` 0.83.1;
  - Next.js 16.4 OpenTelemetry guide;
  - Slack incoming webhooks;
  - Teams Workflows webhooks.

  **Office 365 connectors in Teams were retired in May 2026**, so Teams goes through a Workflows webhook carrying an Adaptive Card.

## Design

### 1. Connecting a service (ingest keys)

- **Monitoring tab.** Each project gets a new tab, **Monitoring**, with two sections: **Services** and **Alerts**.
- **"Connect a service"** asks for a name. It creates an **ingest key** and shows it **once**, together with setup blocks for **Node (CommonJS)**, **Node (ES modules)** and **Next.js**.
  - The blocks are filled in with the key, the endpoint, and the name as `OTEL_SERVICE_NAME`.
  - The key belongs to the project: everything sent with it lands in that project.
- **A key is not bound to one service name** *(my call)*. Like a Sentry DSN, one key may be shared by several services, for example per team or environment, and the caller identity always comes from the span's `service.name`.
  - To make mismatches visible, each key lists the **service names actually seen** with it, with last-seen times.
  - These come from a small `ingest_service` table (`keyId, serviceName, lastSeenAt`), upserted at most once a minute per pair.
- **The key itself:**
  - Format: `ffi_` plus 32 random bytes, base64url-encoded.
  - Only its SHA-256 hash is stored, plus a short prefix for display.
  - The list shows the label, prefix, creator, created date, **last used**, and the service names seen. Keys can be revoked; there is no editing.
- **Scopes:** new project scopes `ingestKey:create|read|delete`. They go to project admins and editors (with `CONTENT_SCOPES`). Viewers see the list but no keys.
- **Node setup block** (zero-code):
  - `npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node`
  - CommonJS: `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`.
  - ES modules: `--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register`.
  - Environment variables:
    - `OTEL_SERVICE_NAME=<name>`, `OTEL_TRACES_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`;
    - `OTEL_EXPORTER_OTLP_ENDPOINT=<FOSSFLOW_URL>/api/otlp`;
    - `OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=<key>`;
    - `OTEL_BSP_SCHEDULE_DELAY=1000`, `OTEL_TRACES_SAMPLER=always_on`;
    - `OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=none`. FossFLOW accepts traces only, so the other exporters would just log 404s.
- **Next.js setup block:** an `instrumentation.ts` that, when `NEXT_RUNTIME === 'nodejs'`, imports an `instrumentation.node.ts` which starts OpenTelemetry's `NodeSDK` with `getNodeAutoInstrumentations()`.
  - The same env vars apply, plus `NEXT_OTEL_FETCH_DISABLED=1`. Next's own fetch span uses old attribute names and would double-count with the undici instrumentation.
  - `@vercel/otel` is **not** used: its peer range conflicts with the current instrumentation packages.
  - *Builder:* verify the exact snippet against the Next.js 16.4 guide and a real Next app before shipping the text.
- **Header choice:** a custom header (`x-fossflow-key`) instead of `Authorization: Bearer`. It needs no percent-encoded space in the env var, and it doesn't collide with nginx Basic Auth.

### 2. Receiving calls (OTLP/HTTP)

- **Endpoint:** `POST /api/otlp/v1/traces`, following the OTLP/HTTP spec.
  - Accepts `application/x-protobuf` and `application/json`, with optional `Content-Encoding: gzip`.
  - Answers in the request's content type with an empty `ExportTraceServiceResponse`.
  - `/v1/metrics` and `/v1/logs` answer 404.
- **Auth and guards:**
  - The route is `@Public()` (no session). A new opt-out decorator for the **OriginGuard** is needed, since exporters send no `Origin`.
  - Its own guard checks `x-fossflow-key` against the hashed keys (constant-time compare on the hash) and updates `lastUsedAt` at most once a minute.
  - A missing or revoked key answers **401**. Exporters treat that as "drop".
- **Limits:**
  - 16 MB after decompression. Decompression is capped, never unbounded, and anything larger answers **413**.
  - Throttled per key, not per IP: about 1200 requests per minute. Over the limit answers **429** with `Retry-After`.
  - Bad payloads answer **400**.
- **Decoding:** `protobufjs` with a **vendored, pinned** copy of the `opentelemetry-proto` definitions (v1.11.1): `collector/trace/v1`, `trace/v1`, `common/v1` and `resource/v1`.
  - JSON follows the OTLP JSON rules: hex ids, int64 as strings, lowerCamelCase, unknown fields ignored.
  - `@opentelemetry/otlp-transformer` is not used: it has no request decoder and is marked internal.
- **nginx:** a `location /api/otlp/` block with `auth_basic off` (the ingest key is the auth there) and `client_max_body_size 16m`. Everything else stays as it is.
- **Speed:** the handler decodes, scrubs and hands the spans to the in-memory aggregator, then answers. Database writes happen in the background (section 4).
- **Spans used:**
  - **CLIENT spans (`kind = 3`)** with HTTP or database attributes become **calls** on an arrow, caller → callee.
  - **SERVER spans (`kind = 2`)** become **incoming requests** on the box of the service that reported them. That gives instrumented services their own numbers, including traffic from callers nobody instrumented.
  - INTERNAL, PRODUCER and CONSUMER spans are ignored.
  - Client and server spans are **not paired**, which avoids Tempo-style matching. Arrows count client spans only, so nothing is counted twice.
- **Attribute names:** both the old and the stable semantic-convention names are accepted, because the instrumentations are mid-migration:
  - `db.system` / `db.system.name`
  - `db.name` / `db.namespace`
  - `db.operation` / `db.operation.name`
  - `http.method` / `http.request.method`
  - `http.url` / `url.full`
  - `net.peer.name` / `server.address`
  - `http.status_code` / `http.response.status_code`

### 3. Identities and scrubbing

- **Caller:** `service:<service.name>`, taken from the span's resource.
- **Callee:**
  - HTTP calls: `host:<server.address>`, lower-cased.
  - Database calls: `db:<server.address>/<db.namespace>`. When the namespace is missing it is `db:<server.address>`.
  - Hosts and database servers are named from attributes, never from IP lookups.
- **Aliases for instrumented services** *(my call)*. When service A calls service B, A's client span only names B's host (`host:b.internal`), while B's box is bound to `service:B`.
  - B's own SERVER spans carry the host they were addressed to: `server.address`, or the older `net.host.name`/`http.host`. FossFLOW learns from them that `host:b.internal` is an **alias** of `service:B`.
  - Aliases are kept in `traffic_alias` (`projectId, host, service, lastSeenAt`).
  - A box bound to `service:B` then also matches its aliases, so the arrow A → B draws and the host doesn't show up as "seen, not on the map". No manual step is needed.
  - A host claimed by **more than one** service within 24 hours (e.g. a gateway or shared ingress) is not auto-aliased. It is offered as a suggestion instead.
  - B's box card shows B's own incoming numbers. The arrow shows the caller's view, labelled "as seen by <caller>". The two can differ, for example by network time or retries, and that is expected.
- **Operation** (what a call did):
  - HTTP: `METHOD /templated/path`.
  - Database: `OPERATION collection`, from `db.operation.name` plus `db.collection.name`, or `db.query.summary`.
  - Server spans: `METHOD route` from `http.route` when present, otherwise the templated path.
- **Scrubbing happens before anything is kept:**
  - Query strings and fragments are dropped. User info in URLs is dropped.
  - Path segments that look like identifiers become `{id}`: numbers, UUIDs, hex strings of 16 or more characters, long mixed-case or base64-like tokens, and anything containing `@`.
  - `db.query.text` and `db.statement` are **never stored**, not even with placeholders.
  - **Failure details** keep only the HTTP status code or `error.type`, never exception messages.
  - No other span attributes are stored.
- **Limits per arrow:**
  - Distinct operations are capped at 200 per caller → callee pair. The rest are counted as `other`.
  - Identity strings are capped at 300 characters, the same as live keys.
- **Failed:** a call counts as failed when the span status is `ERROR`. For HTTP client spans that includes 4xx and 5xx, per the semantic conventions. The panel shows the status, so a 404-heavy arrow is easy to recognise.

### 4. Storing numbers

- **Live aggregation in memory:** per `(project, caller, callee, operation, minute)` the server keeps:
  - calls;
  - failures;
  - the duration sum;
  - a **fixed-bucket duration histogram**, from which the median and p95 are computed. The bucket bounds are the builder's choice; roughly logarithmic from 5 ms to 30 s works.

  The aggregates are flushed to Postgres every few seconds with batched upserts.
- **Tables:**
  - `ingest_key`: `id`, `projectId`, `name`, `keyHash` (unique), `prefix`, `createdBy`, `createdAt`, `lastUsedAt`, `revokedAt`.
  - `traffic_minute`: the key above plus `kind` (`call` or `incoming`), with the counters and the histogram (`int[]`). Index `(projectId, minute)`.
  - `traffic_hour`: the same shape, rolled up from minutes.
  - `traffic_failure`: the recent failed calls, with `projectId, caller, callee, operation, at, durationMs, status`. Capped per arrow (the builder chooses, about 500) and by retention.
  - Small helper tables from sections 1, 3 and 6:
    - `ingest_service`: the service names seen per key;
    - `traffic_alias`: host to service aliases;
    - `ingest_gap`: FossFLOW downtime, used by silent alerts.

    Plus `alert_rule` and `alert_event` (section 6).
- **Retention:**
  - per-minute data: **7 days**;
  - hourly data: **90 days**;
  - failures: **7 days**.

  Each is set by an env var: `TRAFFIC_MINUTES_DAYS`, `TRAFFIC_HOURS_DAYS`, `TRAFFIC_FAILURES_DAYS`. Pruning and the hourly roll-up run as a job.
- **Where it shows:**
  - The arrow panel shows "last hour" from minutes, and longer ranges from hours.
  - "Seen, not on the map" and the box suggestions are derived from the last 24 hours of `traffic_minute`. There is no extra table.

### 5. Showing it on the map

- **Binding boxes to identities.** Model items get an optional `traffic: { ids: string[] }` in the lib schema, next to the existing `live` binding. It holds up to 20 identities of up to 300 characters each.
  - Examples: `service:sync-service`, `host:api.magicline.com`, `host:*.magicline.com` (a leading `*.` wildcard), `db:members.database.windows.net/members`.
  - A box can have both a Beszel `live` binding and `traffic` ids. For example, the Sync service container on a host.
  - It is plain model data, so it round-trips through JSON export and import, and local mode ignores it.
- **Arrows need no new field.** An arrow carries traffic when its two end anchors reference items whose ids match a call's caller and callee. The direction comes from the data, not from how the arrow was drawn: dots always travel caller → callee. If several arrows connect the same two boxes, the first one in the view gets the dots.
- **Editing identities:** the box's settings panel gets a **Live traffic** section.
  - Identity chips can be added and removed.
  - An "add" picker suggests identities seen in the project in the last 24 hours that aren't bound yet.
  - Editors only; Viewers see the chips read-only.
- **"Seen, not on the map"** is a small tray in the editor listing two kinds of entries:
  - identities that carry traffic but match no box. **Place** creates a box with that identity at the view centre;
  - calls between two placed boxes that have no arrow. **Draw arrow** creates the connector.

  Both are ordinary model edits, so they autosave and can be undone like any edit.
- **Dots: SSE.**
  - **Stream.** `GET /api/landscapes/:id/traffic/stream` (requires `landscape:read`) is Server-Sent Events with the project's calls as small batches: `{caller, callee, start, durationMs, failed, weight}`.
    - A heartbeat comment goes out every 25 s.
    - The handler sets `X-Accel-Buffering: no` so nginx doesn't buffer.
  - **Busy arrows.** The server caps the stream per arrow, at about 20 dots a second. When it thins a busy arrow, each dot carries a `weight`, and the arrow panel says "1 dot ≈ N calls". The numbers always count every call.
  - **Clocks** *(my call)*. The server's clock is the reference, so skew between service hosts and browsers doesn't matter.
    - Each received batch is anchored on arrival: a span's streamed `start` is `receivedAt − (latest span end in the batch − span start)`.
    - Spacing inside a batch comes from the service's own clock, which is consistent with itself. The batch as a whole is placed on the server's clock. The error is at most the exporter's batch delay, about 1 s.
    - Every SSE message carries the server's `sentAt`. The browser estimates its offset to the server as the minimum of `browserNow − sentAt` over recent messages, and converts `start` to its own clock.
  - **Timing.** The browser plays each call at `start + lag`, so the real gaps between calls are kept.
    - `lag` is a constant: a little above the delivery delay seen in the stream (`sentAt − start`), clamped to roughly 2–15 s.
    - A dot's travel time is the call's duration, clamped to 0.8–4 s.
    - When the tab is hidden, incoming events are dropped. Coming back starts from now, with no backlog.
  - **Scope.** The stream sends all of the project's calls; the lib matches identities to boxes. Anyone who can read a landscape in the project may see the project's traffic.
- **Numbers.** `GET /api/landscapes/:id/traffic/summary` returns, for the last 5 minutes:
  - per caller → callee pair: calls/min, failed %, median, p95 and the last call time;
  - per box identity: incoming stats;
  - the "seen, not on the map" entries;
  - the active alerts.

  It is polled every 15 s, like Beszel live data. Detail comes from `GET /api/landscapes/:id/traffic/edge?caller=&callee=&range=1h|24h|7d`, which returns the series, the busiest operations and recent failures.
- **Lib rendering:** a new `traffic` prop on `<Isoflow>` and a new `TrafficLayer` scene layer drawn above the connectors.
  - **Dots** are animated along the connector's on-screen path, from `getConnectorPath`, `connectorPathTileToGlobal` and `getTilePosition`. They are updated imperatively in one `requestAnimationFrame` loop: **no React render per dot**. SVG or canvas is the builder's choice.
  - **Trouble:**
    - A failing or slow arrow gets an overlay stroke in red or amber, plus a label pill, e.g. `210/min · 95 ms · 4.1% failed`. The connector's own colour in the model is never changed.
    - The affected box gets one status line, e.g. `4.1% of calls from Member app fail`.
    - Healthy arrows have no labels.
  - **When an arrow counts as trouble:**
    - **failing:** at least 5 % failed **and** at least 5 failures in the last 5 minutes. This is built in and needs no rule;
    - **any arrow or box with a firing alert rule:** red for failing or silent, amber for slow;
    - **"slow" only shows when a slow rule exists.** There is no sensible universal threshold.
  - **Arrow panel:** clicking an arrow that carries traffic opens a card in the style of `VitalsCard`, rendered by the lib. It gets its data through a loader function on the `traffic` prop. The content is the one in the mockup, plus "Alert me when…".
  - **Box card:** for instrumented services it shows the incoming stats. For uninstrumented systems, such as SaaS or a database, it shows the totals of the arrows into them, labelled "seen by callers".
- **App:** `LandscapeEditor` opens the stream and polls the summary only while the landscape has bound identities or the project has ingest keys. The existing live pill shows `Traffic · live` or `connecting`.

### 6. Alerts

- **Rules** are project-level and are created from the arrow or box card ("Alert me when…") or from Monitoring → Alerts.
- **What a rule targets** *(my call)*: identity patterns, not boxes.
  - **Arrow rule:** `from` and `to`, each an identity. A `*.` wildcard is allowed, and a wildcard matches all hosts under it. It covers client calls from → to.
  - **Box rule:** one identity.
    - For a `service:` identity it uses that service's incoming numbers (server spans).
    - For a `host:` or `db:` identity it uses all client calls into it, from any caller.
  - Created from a card, the patterns are prefilled from the box's identities (the first one, with the others to pick from), and can be changed.
  - Rules don't follow boxes. Renaming or deleting a box changes nothing about the rule.
  - Each rule has a **name**, prefilled from the box or arrow names at creation (e.g. `Member app → MagicLine`) and editable. Messages always use this name, so they never depend on which landscapes exist.
  - **Failing:** failed % ≥ X over N minutes, with at least M calls (default M = 10, so 1 failure out of 2 calls doesn't trigger).
  - **Slow:** p95 ≥ T ms over N minutes, with at least M calls.
  - **Silent:** no calls for N minutes. This catches the nightly job that didn't run (N can be up to 48 hours).
  - Each rule has a name, the channels to notify, and an enabled flag.
  - Scopes: new `alertRule:create|update|delete` for admins and editors. Viewers see rules and alerts.
- **Evaluation:** every 60 s from `traffic_minute`, plus the in-memory current minute.
  - States: `ok`, then `firing`, then `ok`. Each firing is stored in `alert_event` with `ruleId, startedAt, resolvedAt, lastNotifiedAt, value, deliveries`.
  - **Messages:** one when an alert starts, one when it is resolved, and a **reminder every 4 hours** while it is still firing.
  - **Silent rules and FossFLOW's own downtime** *(my call)*:
    - The server writes an "ingest alive" heartbeat to `meta` every minute. On start-up, the gap since the last heartbeat is recorded in a small `ingest_gap` table (`from, to`).
    - A silent rule fires when the last matching call is at least N minutes old (from `traffic_minute`, which covers 7 days, more than the 48 h maximum for N), **unless** a recorded gap of more than 5 minutes falls inside that window.
    - In that case the rule waits until N minutes have passed since the gap ended. A short restart therefore only delays a silent alert by the restart itself, not by N.
    - A target that has **never** carried traffic stays `waiting` and doesn't fire. Silent alerts only start after the first call.
- **Channels are credentials** of a new kind. The registry gains a `kind`: `source` (today's connectors) or `channel`.
  - Channel types define `send(settings, message)`; their test on save sends a test message.
  - The credentials UI groups credentials by kind, and the sources picker lists sources only.
  - **Channel types:**
    - **Email:** `to` (a list of addresses). It is only offered when SMTP is configured. It needs a new generic `sendAlert` method on the mailer, plain text like the others.
    - **Slack:** an incoming-webhook URL on `hooks.slack.com` (secret), sending `{text}`.
    - **Microsoft Teams:** a Workflows webhook URL (secret), on `*.logic.azure.com` or `*.powerplatform.com`, sending `{type: "message", attachments: [AdaptiveCard]}`.
      - *Builder:* confirm the current Workflows host names against a freshly created Teams workflow before fixing the allowlist.
    - **Webhook:** any `https` URL (secret), sending a documented JSON body: `{rule, state, target, value, threshold, startedAt, url}`.
- **Delivery:**
  - HTTPS only and no redirects.
  - Slack and Teams URLs must match their host allowlist. Slack and Teams addresses that resolve to private, loopback or link-local IPs are refused.
  - The generic webhook may target internal addresses. This is the same accepted outbound-request risk as Beszel URLs in phase 1: only editors create channels, and the response body is never shown, only the status.
  - 3 attempts with backoff, honouring `Retry-After` on 429. Failed deliveries are recorded on the alert event and shown in the UI.
- **Message content:** the rule's name, the state and the numbers, plus a link to Monitoring → Alerts. For example: `Failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)`. **Operations, member data and failure details never appear in messages.**
- **Monitoring → Alerts** shows:
  - active alerts first;
  - history (paged);
  - rules (create, edit, enable/disable, delete).

### 7. Extensibility

- **More languages:** anything with an OpenTelemetry SDK, or a Collector, can send OTLP/HTTP to the same endpoint. The docs list the Python, .NET, Java and PHP equivalents of the Node block as links, not as tested snippets.
- **More sources:** the connector registry stays the place for pull sources (Beszel today, Prometheus or Azure Monitor later). The `source`/`channel` kind split leaves room for both.
- **Phase 2b** can replay a time window of real calls. It would need raw calls kept longer than the stream; that is out of scope here and can be decided in 2b.

## Left to the builder

- Histogram bucket bounds, flush interval, and the exact lag algorithm, within the stated ranges.
- SVG or canvas for dots, and dot size.
- The exact UI layout of the Monitoring tab, the tray and the cards, within the hairline design system and the mockups in `.superpowers/brainstorm/` (`live-traffic.html`, option C; `live-traffic-v2.html`, real timing).
- The `{id}` heuristics beyond the listed cases. They need a unit-test table of real-looking paths.
- Whether `Place` from the tray uses a generic block icon or picks one by identity type.

## Milestones (each tested, committed and pushed, with a check-in)

Branch `feat/live-traffic`, from `feat/platform-foundation`.

1. **Ingest.**
   - Ingest keys (API and Monitoring → Services with the setup blocks).
   - The OTLP endpoint: protobuf, JSON and gzip, with limits, the guard and nginx.
   - Scrubbing, aggregation, tables, retention and roll-up.
   - Test: a **real OpenTelemetry Node SDK exporter** in the test suite sends to the test app over HTTP. Assert the stored minutes and failures, and that no query strings, IDs or SQL text are stored.
2. **Live map.**
   - The lib `traffic` binding and its schema.
   - `TrafficLayer` (dots, trouble overlays, cards).
   - SSE stream, summary and edge endpoints.
   - Identity editing, the "seen, not on the map" tray, and app wiring.
3. **Alerts.**
   - Channel credential kind (email, Slack, Teams, webhook) with the test message.
   - Rules, the evaluator, events, delivery and the UI.
4. **Docs and walkthrough.**
   - `docs/PLATFORM.md` (Monitoring, ingest keys, alerts, retention) and a new `docs/TRAFFIC.md` (hook-up per platform, troubleshooting).
   - `.env.example`, the audit entry.
   - A Docker walkthrough with a small instrumented Node service and a Next.js app calling a fake API and Postgres.

## Verification

- **Server (Vitest with Testcontainers):**
  - the OTLP spec behaviours: content types, gzip, 400, 401, 413 and 429;
  - old and new attribute names produce the same result;
  - the scrub table;
  - the operation cap;
  - aggregation and percentiles against known inputs;
  - retention and roll-up;
  - the SSE stream (calls arrive, weights under load, heartbeat);
  - alert state transitions (start, reminder, resolve, no false silent after restart);
  - channel payloads against recorded fixtures;
  - SSRF refusals;
  - every route's 403/404 per role.
- Target ≥ 80 % coverage of the new server code.
- **Lib:**
  - identity matching (wildcards, direction, several arrows between the same boxes);
  - the dot scheduler (lag, clamps, hidden tab);
  - schema round trip.
- **App:** a browser walkthrough:
  - connect a service and paste the block into the sample service;
  - watch dots and quiet periods;
  - place an unknown system and draw an arrow;
  - open the arrow panel;
  - create a failing rule;
  - break the fake API;
  - receive Slack/Teams/webhook/email (test endpoints);
  - get the resolve message;
  - check that a Viewer can't edit.
- **Local mode and Beszel:** unchanged. The existing tests stay green, and a manual check of the static build.
- **Each milestone:** `/verify`, a security review on a subagent, an audit entry, commits, a push and a check-in.
