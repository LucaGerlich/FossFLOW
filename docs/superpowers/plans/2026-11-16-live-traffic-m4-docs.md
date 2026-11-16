# Live traffic (phase 2a), milestone 4: docs and walkthrough — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team can connect a service, put its traffic on the map and set up alerts from the docs alone, and a runnable demo proves those docs against a real Docker install.

**Architecture:** Mostly docs: a new `docs/TRAFFIC.md`, and new sections in `docs/PLATFORM.md`, `README.md`, `.env.example` and `compose.yml`. A self-contained demo lives in `examples/live-traffic/`. It is its own compose project, outside the npm workspaces and the FossFLOW image, and sends real OTLP traffic to any FossFLOW. One backend test keeps `TRAFFIC.md` in step with the in-app setup blocks and the webhook body. Three small app fixes left over from milestone 3's walkthrough.

**Tech Stack:** Markdown, Docker Compose, Node 24 (alpine) with stdlib `http` and `pg`, Next.js 16.4.6, OpenTelemetry zero-code Node instrumentation, Vitest (backend).

**Spec:** `docs/superpowers/specs/2026-11-13-live-traffic-alerts-design.md`, especially:
- Milestones → 4;
- §1 (setup blocks), §6 (channels and delivery), §7 (other languages);
- Verification → App.

## My calls (veto any of these when approving)

1. **The walkthrough becomes a checked-in demo** (`examples/live-traffic/`). It has five parts:
   - a fake members API, standing in for a SaaS like MagicLine;
   - an instrumented Node service;
   - an instrumented Next.js app;
   - Postgres;
   - a load generator.

   `TRAFFIC.md` gets a "try it in five minutes" path, and the milestone walkthrough follows the docs the way a new user would. *Cost:* about a dozen small files to keep current.
2. **No lockfiles in the demo**, only exact pins for top-level packages. The OpenTelemetry tree would add thousands of lockfile lines and advisory noise to the repo. *Cost:* a broken upstream transitive release can break the demo build until the pins move.
3. **A drift test** (`setup-docs.test.ts`) fails when `TRAFFIC.md` no longer matches the setup blocks or the webhook body. *Cost:* changing a setup block means editing the docs in the same commit, which is intended.
4. **Milestone 3's walkthrough leftovers are fixed here:**
   - the credentials empty state says credentials are only data sources;
   - the live-data picker says "no credentials" when a project has only alert channels;
   - rule kind badges are coloured like an alert state while the rule is OK.

   *Cost:* a small app diff in a docs milestone.
5. **English docs only.** The 8 translated READMEs stay unchanged. *Cost:* they don't mention live traffic.
6. **Real Slack and Teams are optional.** If you create test webhooks, you paste them into the channel form in the browser pane yourself, never in chat, when the walkthrough reaches channels. Otherwise they stay verified by fixtures only, as today.
7. **The demo reaches FossFLOW through `host.docker.internal`.** `extra_hosts: host-gateway` makes this work on Linux and Hetzner too, and `FOSSFLOW_OTLP_ENDPOINT` overrides it for a remote FossFLOW. *Cost:* none on Docker Desktop or Docker Engine ≥ 20.10.

## Global Constraints

- **Docs state only behaviour that exists in code.** Numbers come from these constants (as of `ae2ef3a`):

  | Fact | Value | Source |
  |---|---|---|
  | OTLP body limit | 16 MiB (nginx `16m`) | `ingest/otlp-handler.ts` `INGEST_MAX_BYTES` |
  | Requests per key | 1200 per minute, then 429 with `Retry-After` | `otlp-handler.ts` `KEY_LIMIT` |
  | Spans older than | 1 hour are dropped | `ingest/spans.ts` `MAX_AGE_MS` |
  | Keys per project | 50 | `ingest-keys.service.ts` |
  | Operations per arrow | 200, the rest counted as `other` | `traffic/aggregator.ts` |
  | Identity length | 300 characters; 20 identities per box | `ingest/scrub.ts`, lib schema |
  | Dots | 20 per second per arrow, 400 per project; then `1 dot ≈ N calls` | `traffic/hub.ts` |
  | Streams | 10 per user; heartbeat every 25 s | `traffic/stream.ts` |
  | Recent failures kept | 500 per arrow | `traffic/maintenance.ts` |
  | Retention | minutes 7 days (2–90), hours 90 days (1–3650), failures 7 days (1–90) | `config/config.ts` |
  | Alert history | resolved alerts kept 90 days | `maintenance.ts` `ALERT_HISTORY_DAYS` |
  | Built-in "failing" colour | ≥ 5 % failed **and** ≥ 5 failures in the last 5 minutes | spec §5 |
  | Rules | 100 per project, 10 channels per rule, name 1–100 chars | `alerts/rule-input.ts` |
  | Thresholds | failing 0.1–100 %, slow 1–600000 ms | `rule-input.ts` |
  | Windows | failing and slow 1–60 min; silent 5–2880 min | `rule-input.ts` |
  | Minimum calls | default 10 (1–100000) | `rule-input.ts` |
  | Evaluation | every 60 s; reminder every 4 h; resolves after 3 clear minutes | `alerts/evaluator.ts` |
  | Downtime gap | only downtime of more than 5 minutes counts | spec §6 |
  | Delivery | 3 attempts, waits of 2 s and 8 s; `Retry-After` honoured up to 60 s; other 4xx not retried; 10 s timeout; last 50 results kept | `alerts/deliveries.ts`, `connectors/outbound.ts` |
- **Endpoint rule:** `OTEL_EXPORTER_OTLP_ENDPOINT=<FOSSFLOW_URL>/api/otlp`. The SDK appends `/v1/traces`. The header is `x-fossflow-key=<key>`.
- **Doc placeholders, used everywhere:**
  - URL `https://fossflow.example.com`;
  - key `ffi_REPLACE_ME`;
  - service name `member-app`.

  The drift test depends on these exact strings.
- **Identity formats:**
  - `service:<name>`, `host:<host>`, `db:<host>/<database>` (or `db:<host>`);
  - a leading `*.` is the only wildcard.
- **Demo versions, exact pins:**
  - `next` 16.4.6, `react` and `react-dom` 19.3.1, `pg` 8.23.1;
  - `@opentelemetry/api` 1.10.0, `@opentelemetry/auto-instrumentations-node` 0.83.1, `@opentelemetry/sdk-node` 0.301.2;
  - dev: `typescript` 6.0.3 (not 7: Next type-checks through the TS 6 API), `@types/react` and `@types/react-dom` 19.3.0, `@types/node` 24.19.2, `@types/pg` 8.23.1;
  - images: `node:24-alpine` (the instrumentations need Node ≥ 22.15) and `postgres:18-alpine`.
- **No real secrets anywhere.** The demo database password is `demo`, labelled demo-only, and the database is not published.
- **Style:**
  - Docs match the existing ones: short sentences, bold lead-ins, bullets, tables for references, and the spelling of the file being edited.
  - Demo code: 2-space indent and single quotes like the repo. One start-up log line per demo process is fine.
- **Git:**
  - conventional commits, author `LucaGerlich <lucagerlich@gmail.com>`;
  - no `Co-Authored-By` lines and no mention of Claude;
  - never commit `.env`.
- **Leave alone:**
  - ports 3000 and 3001, the container `fossflow-db-1`, and `packages/fossflow-backend/.env`;
  - checks use only the throwaway ports 4010 (members API) and 4318 (stub receiver), and project name `ff-demo-check`.

## Review Focus

1. **Docker Engine on Linux** (the Hetzner case), where `host.docker.internal` doesn't resolve by default. Every exporting demo service needs `extra_hosts: host.docker.internal:host-gateway`. *Pinned by:* Task 1 step 7a.
2. **A Next.js production build**, not just `next dev`. The instrumentation must load and export under `next build` and `next start`. *Pinned by:* Task 1 step 7b, which asserts spans from `demo-web`.
3. **The full trace path as the endpoint.** Someone sets `…/api/otlp/v1/traces`, the SDK appends `/v1/traces` again, and every export 404s. The docs must name this. *Pinned by:* Task 2 step 5.
4. **FossFLOW behind the user's own TLS proxy** (Caddy, Traefik, nginx):
   - a buffered SSE response means no dots;
   - a body limit under 16 MiB means 413;
   - Basic Auth on `/api/otlp` means 401.

   The troubleshooting section must say what to set. *Pinned by:* Task 2 step 5.
5. **Numbers lower than reality**, from head or tail sampling in an SDK or Collector. The docs must say counts reflect the spans FossFLOW receives, and to keep `always_on`. *Pinned by:* Task 2 step 5.

---

## File structure

| File | Task | Responsibility |
|---|---|---|
| `examples/live-traffic/compose.yml` | 1 | The demo stack and its env, wired to the setup blocks |
| `examples/live-traffic/members-api.mjs` | 1 | Fake SaaS with `ok`, `failing` and `slow` modes |
| `examples/live-traffic/load.mjs` | 1 | Uninstrumented caller with quiet pauses |
| `examples/live-traffic/shop/{Dockerfile,package.json,server.js}` | 1 | Node service (CommonJS block): API and Postgres calls |
| `examples/live-traffic/web/{Dockerfile,package.json,next.config.ts,tsconfig.json,instrumentation.ts,instrumentation.node.ts,app/layout.tsx,app/page.tsx,app/api/checkout/route.ts}` | 1 | Next.js app (Next.js block): shop and Postgres calls |
| `.dockerignore` | 1 | Adds `examples` |
| `docs/TRAFFIC.md` | 2 | Hook-up, map, alerts, webhook JSON, limits, troubleshooting |
| `packages/fossflow-backend/src/ingest/setup-docs.test.ts` | 2 | Drift test |
| `docs/PLATFORM.md`, `docs/LIVE.md`, `README.md`, `.env.example`, `compose.yml` | 3 | Platform guide and config |
| `packages/fossflow-app/src/i18n/en-US.json`, `packages/fossflow-app/public/i18n/app/en-US.json`, `src/platform/components/ProjectAlerts.tsx`, `AlertEventRow.tsx` | 4 | Leftover wording and badges |
| `docs/AUDIT.md` | controller | Milestone 4 entry, after the walkthrough |

---

### Task 1: The live-traffic demo

**Files:** everything under `examples/live-traffic/`, and modify `.dockerignore`.

**Interfaces:**
- Consumes: the setup blocks exactly as `packages/fossflow-backend/src/ingest/setup-blocks.ts` produces them.
  - `node-cjs` goes into the shop's env.
  - `nextjs` supplies the two files and the web env.
  - Read that file; don't paraphrase it.
- Produces, for Task 2's "Try it with the demo":
  - identities `service:demo-web`, `service:demo-shop`, `host:members-api` and `db:demo-db/demo`;
  - mode switch `POST http://localhost:4010/admin/mode/{ok|failing|slow}`;
  - env `FOSSFLOW_INGEST_KEY` (required) and `FOSSFLOW_OTLP_ENDPOINT` (default `http://host.docker.internal/api/otlp`).

- [ ] **Step 1: `members-api.mjs`** (stdlib `http`, port 4010, no OpenTelemetry: it plays a SaaS seen only by its callers)
  - `GET /members/:id`: `200 {"id":<id>,"plan":"flex"}` after a random 20–80 ms.
    - Mode `slow` adds a random 1200–2000 ms.
    - Mode `failing` answers `503` on 60 % of calls.
  - `POST /admin/mode/ok|failing|slow`: `204`, and logs `mode: <mode>`.
  - Anything else answers `404`.
- [ ] **Step 2: `shop/`**, CommonJS, port 4020.
  - **On start:** `create table if not exists orders (id serial primary key, member_id int not null, created_at timestamptz not null default now())`, retried every 2 s until Postgres answers.
  - **`GET /order`:**
    1. picks a random id from 1 to 5000;
    2. `fetch`es `http://members-api:4010/members/<id>?email=member<id>@example.com`. The ID and email are deliberately in the URL, so the docs can show them scrubbed;
    3. runs `insert into orders (member_id) values ($1)`;
    4. answers `200 {"ok":true}`.
  - **Errors:** a non-2xx or failed members call answers `502`.
  - **Packaging:**
    - `package.json` has exact pins for `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node` and `pg`;
    - the Dockerfile runs `npm install --omit=dev --no-audit --no-fund` and starts with `CMD ["node","server.js"]`;
    - instrumentation comes only from the env in compose.
- [ ] **Step 3: `web/`**, Next.js App Router.
  - **`instrumentation.ts` and `instrumentation.node.ts`** are byte-for-byte the `nextjs` block's files.
  - **`app/api/checkout/route.ts`** sets `export const dynamic = 'force-dynamic'`.
    - `GET` fetches `http://shop:4020/order`, then runs `select count(*)::int as orders from orders`.
    - It answers `200 {"orders":n}`, or `502` when the shop fails.
  - **`app/page.tsx`** is static text, "FossFLOW live-traffic demo", with a minimal `app/layout.tsx`.
  - **`next.config.ts`** exports `{}`. See the ruling below.
  - **Dockerfile:**
    - `node:24-alpine` with `ENV NEXT_TELEMETRY_DISABLED=1`;
    - `npm install --no-audit --no-fund`, then `npx next build`;
    - `CMD ["npx","next","start","-p","3000"]`.
- [ ] **Step 4: `load.mjs`.**
  - Sends `GET http://web:3000/api/checkout` with random 300–1500 ms gaps.
  - After every 40 requests it pauses 15 s, so quiet periods show on the map.
  - Ignores errors; no OpenTelemetry.
- [ ] **Step 5: `compose.yml`.**
  - **Header comment:** what the demo is, a link to `docs/TRAFFIC.md#try-it-with-the-demo`, and the `up` and `down` commands.
  - **Services:**
    - **`demo-db`:** `postgres:18-alpine`, user, password and database all `demo` (comment: demo only, never published), with a `pg_isready` healthcheck.
    - **`members-api`:** `node:24-alpine`, the file mounted read-only, `ports: ["127.0.0.1:4010:4010"]`.
    - **`shop`:** `build: ./shop`, depends on `demo-db` (healthy) and `members-api`.
      - `extra_hosts: ["host.docker.internal:host-gateway"]`;
      - environment in map form, so `NODE_OPTIONS` needs no shell quotes:
        - every `node-cjs` line, with `OTEL_SERVICE_NAME: demo-shop`;
        - `OTEL_EXPORTER_OTLP_ENDPOINT: ${FOSSFLOW_OTLP_ENDPOINT:-http://host.docker.internal/api/otlp}`;
        - `OTEL_EXPORTER_OTLP_HEADERS: x-fossflow-key=${FOSSFLOW_INGEST_KEY:?Create a key in FossFLOW under Monitoring → Connect a service}`;
        - `DATABASE_URL: postgres://demo:demo@demo-db:5432/demo`.
    - **`web`:** `build: ./web`, depends on `shop`, the same `extra_hosts`.
      - Every `nextjs` env line, with `OTEL_SERVICE_NAME: demo-web` and `NEXT_OTEL_FETCH_DISABLED: "1"`;
      - the same endpoint, header and `DATABASE_URL`.
    - **`load`:** `node:24-alpine`, `load.mjs` mounted, depends on `web`.

  Both services share one key; the spec allows it, and "Seen as" then lists both names.
- [ ] **Step 6: `.dockerignore`.** Add the line `examples`.
- [ ] **Step 7: Verify** (run from the repo root; nothing here is committed).
  - **a. Config.**
    - `FOSSFLOW_INGEST_KEY= docker compose -f examples/live-traffic/compose.yml config -q` fails and prints "Create a key in FossFLOW".
    - With `FOSSFLOW_INGEST_KEY=ffi_test` it passes.
    - `… config | grep -c 'host.docker.internal:host-gateway'` prints `2`.
  - **b. Real export.**
    - Run a stub receiver from the scratchpad on host port 4318. It answers every POST `200` with an empty `application/x-protobuf` body and records the path, the `x-fossflow-key` and `content-type` headers, and whether the body contains `demo-shop` or `demo-web` (protobuf strings are plain UTF-8, and the exporter doesn't gzip by default).
    - Start the demo: `FOSSFLOW_INGEST_KEY=ffi_test FOSSFLOW_OTLP_ENDPOINT=http://host.docker.internal:4318/api/otlp docker compose -p ff-demo-check -f examples/live-traffic/compose.yml up -d --build`.
    - Within 60 s the stub must show:
      - POSTs to `/api/otlp/v1/traces` only (none to `/v1/metrics` or `/v1/logs`);
      - key `ffi_test` and `application/x-protobuf`;
      - bodies containing **both** `demo-shop` and `demo-web`. This is the production Next.js build.
  - **c. Modes.**
    - After `curl -sf -X POST localhost:4010/admin/mode/failing` (expects 204), at least 5 of 20 requests to `http://localhost:3000/api/checkout` made inside `web` (`docker compose … exec web node -e …`) answer 502.
    - After `…/mode/ok`, 20 of 20 answer 200.
    - After `…/mode/slow`, one request takes ≥ 1.2 s.
  - **d. Logs.** `docker compose … logs shop web` shows no OpenTelemetry errors and no stack traces.
  - **e. Clean-up.** `docker compose -p ff-demo-check -f examples/live-traffic/compose.yml down -v --rmi local`, then stop the stub.
  - **f. Root checks.** Root `npm run lint` passes, confirming the examples sit outside the workspaces.
- [ ] **Step 8: Commit.** `feat(examples): live-traffic demo with an instrumented Node service and Next.js app`.

**Ruling if 7b gets no `demo-web` spans:**
1. Add `serverExternalPackages: ['@opentelemetry/sdk-node', '@opentelemetry/auto-instrumentations-node']` to `web/next.config.ts`.
2. If that fixes it, report **DONE_WITH_CONCERNS**: the Next.js setup block then needs the same file step (`setup-blocks.ts`, its test, and Task 2's docs), which the controller schedules.
3. If it doesn't fix it, report **BLOCKED** with the build and runtime logs.

### Task 2: `docs/TRAFFIC.md` and the drift test

**Files:**
- Create: `docs/TRAFFIC.md`;
- Create: `packages/fossflow-backend/src/ingest/setup-docs.test.ts`.

**Interfaces:**
- Consumes:
  - `setupBlocks(input: SetupInput): SetupBlock[]` from `./setup-blocks.js`;
  - `webhookChannel` from `../connectors/channels/webhook.js` (`send(settings, message, deps)` with `deps.postJson` mockable, as in `channels.test.ts`);
  - Task 1's demo names.
- Produces, for Task 3's links: the anchors `#what-fossflow-records`, `#connect-a-service`, `#try-it-with-the-demo`, `#alerts`, `#webhook-json`, `#retention-and-limits` and `#troubleshooting`.

- [ ] **Step 1: Write the failing test** `setup-docs.test.ts`. It reads the doc from `new URL('../../../../docs/TRAFFIC.md', import.meta.url)`.
  - `it('shows every setup line with the doc placeholders')`:
    - call `setupBlocks({ endpoint: 'https://fossflow.example.com/api/otlp', key: 'ffi_REPLACE_ME', serviceName: 'member-app' })`;
    - for every step of every block, split `code` on `\n` and `expect(doc).toContain(line)` for each non-empty line.
  - `it('documents every webhook field')`:
    - send a firing `AlertMessage` (copy the fixture shape from `channels.test.ts`) through `webhookChannel.send` with a mocked `postJson`;
    - for every key of the posted body and of `body.rule`, `expect(doc).toContain('`' + key + '`')`;
    - also expect each state: `firing`, `reminder`, `resolved` and `test`.
- [ ] **Step 2: Run it and see it fail.** `npm test -w packages/fossflow-backend -- src/ingest/setup-docs.test.ts`. Expected: FAIL with ENOENT, because the doc is missing.
- [ ] **Step 3: Write `docs/TRAFFIC.md`** with these sections, in this order:
  1. **`# Live traffic and alerts`.** Two sentences on what it is (one dot per real call, numbers, alerts), and a link to `PLATFORM.md` for installing.
  2. **`## What FossFLOW records`.**
     - CLIENT spans become calls on arrows; SERVER spans become a box's incoming numbers.
     - **Stored:** counts, a duration histogram, the templated operation, and for failures only the HTTP status or `error.type`.
     - **Never stored:** query strings, fragments, user info, IDs in paths (they become `{id}`), SQL text, exception messages, other attributes.
     - **Ignored:** INTERNAL, PRODUCER and CONSUMER spans, metrics, logs, and browsers.
  3. **`## Try it with the demo`.**
     1. Create a key named `demo` under Monitoring → Connect a service.
     2. Start the demo with `FOSSFLOW_INGEST_KEY=… docker compose -f examples/live-traffic/compose.yml up -d --build`. Set `FOSSFLOW_OTLP_ENDPOINT` when FossFLOW runs elsewhere.
     3. In a landscape, use the tray to **Place** the four identities and **Draw arrow** for each call.
     4. Watch the dots and the pause after every 40 calls, and open an arrow.
     5. `curl -X POST http://localhost:4010/admin/mode/failing`, then `slow`, then `ok`.
     6. Create a rule with **Alert me when…**.
     7. Stop it with `… down -v`.

     Note that the `load` caller is uninstrumented, so it shows only as `demo-web`'s incoming requests.
  4. **`## Connect a service`.**
     - Creating a key: it is shown once, one key may serve several services, "Seen as" lists them, and Revoke stops them.
     - The endpoint rule.
     - **`### Node.js (CommonJS)`**, **`### Node.js (ES modules)`** and **`### Next.js`:** each the full block with the placeholders. Next.js notes:
       - only the Node.js runtime is instrumented (Edge routes and middleware are not);
       - why `NEXT_OTEL_FETCH_DISABLED=1`;
       - `@vercel/otel` is not used.
     - **`### In Docker`:** the env lines in `environment:`, and the endpoint must be reachable from the container (`host.docker.internal` plus `host-gateway`).
     - **`### Other languages`:** links, with the same env vars, labelled "not tested by us":
       - <https://opentelemetry.io/docs/zero-code/python/>
       - <https://opentelemetry.io/docs/zero-code/dotnet/>
       - <https://opentelemetry.io/docs/zero-code/java/agent/>
       - <https://opentelemetry.io/docs/zero-code/php/>
       - <https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/>
     - **`### Through an OpenTelemetry Collector`:** an `otlphttp/fossflow` exporter with `endpoint: https://fossflow.example.com/api/otlp` and `headers: { x-fossflow-key: ffi_REPLACE_ME }` in a traces pipeline. Link <https://github.com/open-telemetry/opentelemetry-collector/tree/main/exporter/otlphttpexporter>.
     - **`### Sampling`:** keep `always_on`; numbers count the spans FossFLOW receives.
  5. **`## Put traffic on the map`.**
     - the identity table, with the demo's four identities as examples;
     - the box settings section **Live traffic**, and the tray **Seen, not on the map** (**Place**, **Draw arrow**);
     - host aliases (automatic; a host shared by several services becomes a suggestion);
     - direction comes from the data; when several arrows join the same boxes, the first one gets the dots;
     - the arrow card's fields ("As seen by …") and the box card ("Incoming", "Seen by callers");
     - dots run a few seconds behind, and a hidden tab drops them;
     - `1 dot ≈ N calls`;
     - colours: built-in failing; alerts red for failing and silent, amber for slow; slow shows only with a slow rule.

     UI words must match `packages/fossflow-lib/src/i18n/en-US.ts` (`traffic`) and `packages/fossflow-app/src/i18n/en-US.json` (`platform.monitoring`, `platform.alerts`).
  6. **`## Alerts`.**
     - **`### Channels`:**
       - email needs SMTP;
       - Slack: an incoming webhook on `hooks.slack.com/services/…`; link <https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks>;
       - Teams: a Workflows webhook on `*.api.powerplatform.com`, since the old `logic.azure.com` URLs stopped on 30 November 2025; link <https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498>;
       - Webhook: any HTTPS URL, including internal ones, but never link-local, and redirects are not followed.
     - **`### Rules`:** kinds, targets, ranges and the minimum-calls default.
     - **`### When messages are sent`:**
       - one message at the start, then a reminder every 4 h, then one when it resolves after 3 clear minutes;
       - too few calls changes nothing;
       - a silent rule waits for its first call;
       - downtime of more than 5 minutes delays a silent rule;
       - disabling closes the alert quietly;
       - deleting a rule deletes its history;
       - history is kept 90 days.
     - **`### Messages`:** the three copy lines from `connectors/channels/message.ts`, with the `Member app → MagicLine` example.
     - **`### Delivery`:** retries and timeouts, and that "not delivered (…)" shows in Monitoring.
     - **`### Webhook JSON`:**
       - a field table with units per kind: failing in %, slow in ms, silent in minutes (`value` is the minutes since the last call, `threshold` the window);
       - a firing example and a `test` example, where kind, rule id and target are `null`;
       - the body is not signed, so treat the URL as a secret;
       - answer 2xx within 10 s.
  7. **`## Retention and limits`:** the table from Global Constraints, plus `TRAFFIC_*_DAYS`.
  8. **`## Troubleshooting`:** a symptom → cause → fix table covering at least:
     - "No data on the key" (wrong endpoint, including the `/v1/traces` doubling; endpoint unreachable from the service; revoked key 401; 413; 429);
     - "Data but no dots" (no box has the identity, so check the tray; hidden tab; the stream is buffered by a proxy);
     - doubled Next.js calls;
     - 404s for metrics or logs;
     - the ES-module loader not found;
     - Node older than 22.15;
     - an arrow not lighting (identity mismatch, shared host not auto-aliased);
     - numbers too low (sampling);
     - "slow" never shows;
     - a clock off by more than 1 h (spans dropped);
     - a silent alert after downtime counting from the restart.

     For **your own TLS proxy**:
     - don't buffer `/api/landscapes/*/traffic/stream` (honour `X-Accel-Buffering: no`, or turn proxy buffering off);
     - allow 16 MiB bodies on `/api/otlp/`;
     - no Basic Auth on `/api/otlp/`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Review Focus checks.** Each `grep -c` on `docs/TRAFFIC.md` must be ≥ 1:
  - `/v1/traces` in Troubleshooting;
  - `X-Accel-Buffering`;
  - `16 MiB`;
  - `always_on`;
  - `host-gateway`.
- [ ] **Step 6: Links.**
  - Every external URL in the doc answers 200 with `curl -sL -o /dev/null -w '%{http_code}'`.
  - Every relative link (`PLATFORM.md`, `../examples/live-traffic/compose.yml`, and so on) points at a file that exists.
- [ ] **Step 7: Commit.** `docs: live traffic and alerts guide, kept in step with the setup blocks by a test`.

### Task 3: Platform guide, README and config

**Files:** modify `docs/PLATFORM.md`, `docs/LIVE.md`, `README.md`, `.env.example` and `compose.yml`.

**Interfaces:** Consumes Task 2's anchors. Produces nothing code depends on.

- [ ] **Step 1: `docs/PLATFORM.md`.**
  - **TOC:** add `[Monitoring: live traffic and alerts](#monitoring-live-traffic-and-alerts)` after Credentials.
  - **Mode table:** a row `Live traffic and alerts | No. | Yes.`
  - **Project roles table:**
    - Admin and Editor also create and revoke ingest keys and create, edit and delete alert rules;
    - Viewers see the key list, rules and alerts, and change nothing.
  - **"Credentials and live data":**
    - credentials are data sources **or alert channels**;
    - the **Live data** menu lists data sources only;
    - link `TRAFFIC.md#alerts` for channels.
  - **New section `## Monitoring: live traffic and alerts`** (about 15 lines):
    - the Monitoring tab (Services, Alerts);
    - what a key is (`ffi_…`, shown once, SHA-256 hashed at rest);
    - where data appears;
    - links to `TRAFFIC.md#connect-a-service`, `#try-it-with-the-demo` and `#alerts`.
  - **"Email":** SMTP also sends email alerts, and the email channel is offered only when SMTP is set.
  - **"Backups":** traffic lives in Postgres too. For smaller dumps, add `--exclude-table-data=traffic_minute --exclude-table-data=traffic_hour --exclude-table-data=traffic_failure`.
  - **"Configuration reference":** rows for `TRAFFIC_MINUTES_DAYS` (7, 2–90), `TRAFFIC_HOURS_DAYS` (90, 1–3650) and `TRAFFIC_FAILURES_DAYS` (7, 1–90).
  - **"Security"** bullets:
    - **ingest keys:** `/api/otlp/` skips Basic Auth by design and is authenticated by the key, with 1200 requests a minute per key and 16 MiB;
    - **what is never stored:** a summary, with a link to `TRAFFIC.md#what-fossflow-records`;
    - **the accepted risk is extended:**
      - an alert webhook may reach internal HTTPS addresses, as Beszel URLs can;
      - Slack and Teams can't;
      - nothing reaches link-local addresses.
  - **"Adding a connector":** one paragraph saying channels use `defineChannel` and `kind: 'channel'`, with `email.ts` and `webhook.ts` as examples. Check the names in `connectors/registry.ts` and `connectors/connector.ts`.
- [ ] **Step 2: `docs/LIVE.md`.** First paragraph: one sentence pointing to `TRAFFIC.md` for API calls and database queries between systems.
- [ ] **Step 3: `README.md`.**
  - Under "Live landscape", a short paragraph on live traffic and alerts, linking `docs/TRAFFIC.md` and the demo.
  - A `docs/TRAFFIC.md` line in "Documentation".
- [ ] **Step 4: `.env.example`.**
  - The SMTP comment becomes "Mail for invitations, password resets and email alerts".
  - Add a commented block with `TRAFFIC_MINUTES_DAYS=7`, `TRAFFIC_HOURS_DAYS=90` and `TRAFFIC_FAILURES_DAYS=7`, with the ranges.
- [ ] **Step 5: `compose.yml`.**
  - Pass `TRAFFIC_MINUTES_DAYS=${TRAFFIC_MINUTES_DAYS:-7}`, `TRAFFIC_HOURS_DAYS=${TRAFFIC_HOURS_DAYS:-90}` and `TRAFFIC_FAILURES_DAYS=${TRAFFIC_FAILURES_DAYS:-7}`, with a one-line comment.
  - Add "and email alerts" to the SMTP comment.
- [ ] **Step 6: Verify.**
  - `POSTGRES_PASSWORD=x FOSSFLOW_URL=http://localhost docker compose config | grep TRAFFIC_` shows all three with the defaults.
  - Every relative link and anchor added in this task resolves: run each `#anchor` against the target file's headings with GitHub's slug rules.
  - `npm test -w packages/fossflow-backend -- src/config` still passes.
- [ ] **Step 7: Commit.** `docs: monitoring in the platform guide, traffic retention in compose and .env.example`.

### Task 4: Milestone 3 leftovers in the app

**Files:**
- modify `packages/fossflow-app/src/i18n/en-US.json` and `packages/fossflow-app/public/i18n/app/en-US.json` (keep each file's indent; same values in both);
- modify `src/platform/components/ProjectAlerts.tsx` and `src/platform/components/AlertEventRow.tsx`.

**Interfaces:** none.

- [ ] **Step 1: Strings** (en-US only; other locales keep their wording).
  - `platform.credentials.emptyHint`: "Credentials are logins for live data sources, such as a Beszel hub, and alert channels such as email, Slack, Teams or a webhook."
  - `platform.sources.none`: "This project has no data sources yet."
- [ ] **Step 2: Badges.**
  - The kind badge keeps `badge badge--mono alert-kind`, and adds `alert-kind--${kind}` (the colour) only while firing:
    - in `ProjectAlerts.tsx`: when `rule.enabled && rule.state === 'firing'`;
    - in `AlertEventRow.tsx`: when `event.resolvedAt === null` (`AlertEventView` in `src/platform/alerts.ts`).
  - The CSS stays as it is.
- [ ] **Step 3: Verify.**
  - `npx tsc --noEmit -p packages/fossflow-app` shows the same 7 existing errors and no new ones.
  - `npm run build -w packages/fossflow-app` passes.
  - Both en-US files parse, and their changed keys are equal (a one-line `node -e` comparison).
- [ ] **Step 4: Commit.** `fix(app): alert channels in the credentials wording, kind badges coloured only while firing`.

### Controller: walkthrough, review and finish

No task subagent does these steps; each produces evidence for the audit.

1. **Docker walkthrough, following the docs literally** as a new user. It uses the real `compose.yml` in a throwaway project in the scratchpad on port 8088, Mailpit, and a local HTTPS webhook trusted through `NODE_EXTRA_CA_CERTS`.
   - **Setup:** owner setup, a team project and a landscape; then `TRAFFIC.md#try-it-with-the-demo` step by step, with the demo pointed at `http://host.docker.internal:8088/api/otlp`.
   - **On the map:** place the four identities, draw the arrows, check dots and quiet pauses by JS sampling (see the walkthrough-gotchas memory), and open the cards.
   - **Alerts:**
     - add email and webhook channels (and Slack and Teams if you paste test URLs into the pane);
     - create a failing rule;
     - `mode/failing`, then the start message arrives;
     - `mode/ok`, then the resolve message;
     - the webhook body matches `#webhook-json` field by field.
   - **Viewer:** read-only.
   - **Milestone 3 leftovers:** the new wording and badges, checked in the browser.
   - **Local mode:** the static build is unchanged.

   Any doc step that turns out wrong goes back to the owning implementer as a fix round.
2. **Final whole-branch review** of this milestone's diff, which also serves as the security review (as R5 in milestone 3), then a single fix wave.
3. `/verify`, then the `docs/AUDIT.md` entry (newest first), then push.
4. **PR #7:** title "milestones 1–4"; the body marks milestone 4 and phase 2a as done. Never merge.
5. **Clean-up:** containers, images, Mailpit, scratch files and the plan workspace.
