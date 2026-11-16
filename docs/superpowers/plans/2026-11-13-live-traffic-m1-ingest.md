# Live traffic, milestone 1: ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Services send their calls to FossFLOW over OTLP/HTTP with a project ingest key. FossFLOW scrubs them, counts them per minute in Postgres and keeps hourly roll-ups, and a project's Monitoring → Services tab hands out keys with ready-to-paste setup blocks.

**Architecture:** The OTLP route is a plain Express handler mounted in `createApp`, like better-auth's. It checks the key *before* reading the body, so no Nest guard needs an opt-out. It decodes protobuf (`protobufjs` plus vendored protos) or JSON into one zod-checked shape, then maps spans to scrubbed `TrafficEvent`s. An in-memory aggregator flushes them to Postgres every 5 s. A maintenance job rolls minutes up into hours and prunes old data. Keys are a normal Nest resource on the existing project-scope guard.

**Tech Stack:** NestJS 12 (ESM), Drizzle 0.45 + Postgres 18, zod 4, `protobufjs` 8.8.1, Express 5 `raw()` body parser, Vitest + Testcontainers; tests use `@opentelemetry/sdk-trace` 3.1.1 and the OTLP exporters 0.301.2; the app uses React Router 7 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-13-live-traffic-alerts-design.md`. This plan covers milestone 1 and sections 1–4 of that design. The SSE stream, summary, map and alerts belong to milestones 2 and 3.

## Global Constraints

- Branch `feat/live-traffic`. Commits are conventional (`feat(server): …`, `feat(app): …`), with identity `LucaGerlich <lucagerlich@gmail.com>`, **no Co-Authored-By line and no mention of Claude**. Run `/verify` before every non-docs commit. Never commit `.env` files.
- Code style:
  - match the existing files: 2-space indent in `.ts`/`.tsx`, 4-space in the i18n JSON;
  - ESM `.js` import suffixes in the backend;
  - TypeScript strict with no `any`;
  - errors list the field and rule, never the value.
- Key format `ffi_` + base64url(32 random bytes), 47 characters in total. Only the SHA-256 hex hash is stored, plus a 12-character prefix for display. The header is `x-fossflow-key`.
- **Never stored or logged:** query strings, fragments, URL user info, `db.statement`, `db.query.text`, exception messages, raw ingest keys, or any span attribute that this plan doesn't name.
- Limits:
  - 16 MiB per request after decompression (`16 * 1024 * 1024`);
  - 1200 requests per minute per key;
  - identities and operations are cut to 300 characters;
  - 200 distinct operations per caller → callee pair, after which calls count as `other`;
  - 500 stored failures per arrow.
- Retention: `TRAFFIC_MINUTES_DAYS` (default 7, minimum 2, so 48-hour silent alerts in milestone 3 have data), `TRAFFIC_HOURS_DAYS` (default 90), `TRAFFIC_FAILURES_DAYS` (default 7).
- New dependencies, exactly these:
  - `protobufjs@^8.8.1`;
  - `express` (declared at the version `npm ls express` shows under `@nestjs/platform-express`);
  - devDependencies `@opentelemetry/api@^1.10.0`, `@opentelemetry/sdk-trace@^3.1.1`, `@opentelemetry/resources@^3.1.1`, `@opentelemetry/exporter-trace-otlp-proto@^0.301.2`, `@opentelemetry/exporter-trace-otlp-http@^0.301.2` and `@opentelemetry/otlp-exporter-base@^0.301.2`.
  - `@opentelemetry/sdk-trace-base` is deprecated: don't use it.
- New UI text goes through i18n keys under `platform.monitoring.*` in **both** `packages/fossflow-app/src/i18n/en-US.json` and `packages/fossflow-app/public/i18n/app/en-US.json`.
- Local mode, Beszel live data and every existing test stay green.

## Review Focus

1. **Personal data hidden in a path in a shape the basic rules miss**, such as a percent-encoded email (`/users/jane%40example.com`), a phone number or an order code (`/orders/INV-2026-004211`). It must still become `{id}`. → table rows in Task 4.
2. **A project deleted (or a key revoked) between receiving spans and the flush.** Other projects' numbers must still be stored, and the flush must not throw. → Task 5 test "a deleted project doesn't poison the flush".
3. **One service floods unique operations or hosts** (IDs in subdomains, a new path per request). Memory and rows must stay bounded: operations past 200 count as `other`, and pairs past 1000 per project per day are dropped. → Task 5 caps test.
4. **A service whose clock is hours off.** Its calls must land in the current minute, keeping their spacing, not hours away. → Task 4 anchoring test.
5. **FossFLOW down for several hours.** The hour before the downtime must still be rolled up. → Task 7 downtime test.

---

### Task 1: Config, scopes, tables and migrations

**Files:**
- Modify:
  - `packages/fossflow-backend/src/config/config.ts`
  - `packages/fossflow-backend/src/rbac/roles.ts`
  - `packages/fossflow-backend/src/projects/project-access.ts`
  - `packages/fossflow-backend/src/database/schema.ts`
- Create:
  - `packages/fossflow-backend/drizzle/0005_traffic.sql` (generated)
  - `packages/fossflow-backend/drizzle/0006_traffic_functions.sql` (custom)
- Test:
  - `src/config/config.test.ts`
  - `src/rbac/roles.test.ts`
  - new `src/traffic/storage.test.ts`

**Interfaces:**
- Produces:
  - `AppConfig.traffic: { minutesDays: number; hoursDays: number; failuresDays: number }`.
  - Project scopes `'ingestKey:create' | 'ingestKey:read' | 'ingestKey:delete'`:
    - all three are added to `PROJECT_SCOPES` and `CONTENT_SCOPES` (editor and personal owner);
    - the viewer gets `'ingestKey:read'`.
  - `RequireProjectScope(scope, { target: 'ingestKey' })`, with the not-found message `'Ingest key not found'`.
  - Drizzle tables in `schema.ts`:
    - `ingestKey`: `id` text PK; `projectId` → project, cascade; `name`; `keyHash` unique; `prefix`; `createdBy` → user, set null; `createdAt`; `lastUsedAt` nullable. Index on `projectId`.
    - `ingestService`: `keyId` → ingestKey, cascade; `serviceName`; `lastSeenAt`. PK `(keyId, serviceName)`.
    - `trafficMinute`:
      - columns: `projectId` → project, cascade; `kind` text enum `call|incoming`; `caller` (`''` for incoming); `callee`; `operation`; `minute` timestamptz; `calls` integer; `failures` integer; `durationSumMs` double precision; `histogram` `integer[]`;
      - PK `(projectId, kind, caller, callee, operation, minute)`;
      - indexes `(projectId, minute)` and `(minute)`.
    - `trafficHour`: the same, with `hour` in place of `minute`.
    - `trafficFailure`:
      - columns: `id` integer identity PK; `projectId` → project, cascade; `kind`; `caller`; `callee`; `operation`; `at` timestamptz; `durationMs` double; `status` text;
      - indexes `(projectId, caller, callee, at)` and `(at)`.
    - `trafficAlias`: `projectId` → project, cascade; `host`; `service`; `lastSeenAt`. PK `(projectId, host, service)`.
  - SQL functions `int_array_add(int[], int[]) → int[]` (adds element by element; a NULL array counts as empty) and aggregate `int_array_sum(int[])`.

- [ ] **Step 1: Write the failing tests**
  - `config.test.ts`: the defaults are `{ minutesDays: 7, hoursDays: 90, failuresDays: 7 }`. `TRAFFIC_MINUTES_DAYS=1` throws a `ConfigError` naming the variable.
  - `roles.test.ts`: the viewer's sorted scopes become `['credential:read', 'ingestKey:read', 'landscape:read', 'project:read']`. The editor and the personal owner have all three `ingestKey:*` scopes.
  - `storage.test.ts`, against a test app's DB:
    - `select int_array_add('{1,2,3}', '{10,0,1}')` → `{11,2,4}`;
    - `int_array_add(NULL, '{1,2}')` → `{1,2}`;
    - `select int_array_sum(h) from (values ('{1,0}'::int[]), ('{2,5}')) t(h)` → `{3,5}`.
- [ ] **Step 2: Run them**
  - Run: `cd packages/fossflow-backend && npx vitest run src/config src/rbac src/traffic`
  - Expected: FAIL.
- [ ] **Step 3: Implement**
  - Add the three env vars to `envSchema`, with `z.coerce.number().int()`: minutes 2–90, hours 1–3650, failures 1–90.
  - Add the scopes and the `ingestKey` target: `projectOf` picks its table from `{ landscape, credential, ingestKey }`.
  - Add the tables.
  - Run `npx drizzle-kit generate --name traffic`, then `npx drizzle-kit generate --custom --name traffic_functions`, and fill the custom file with:

```sql
CREATE FUNCTION int_array_add(a int[], b int[]) RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY(SELECT coalesce(x, 0) + coalesce(y, 0) FROM unnest(a, b) WITH ORDINALITY AS t(x, y, i) ORDER BY i)
$$;
--> statement-breakpoint
CREATE AGGREGATE int_array_sum(int[]) (SFUNC = int_array_add, STYPE = int[]);
```
- [ ] **Step 4: Run all backend tests.** Run: `npm test` (backend). Expected: PASS. The existing suites still pass with the new migrations.
- [ ] **Step 5: Commit.** `feat(server): traffic tables, ingest key scopes and retention settings`

---

### Task 2: Ingest keys API and setup blocks

**Files:**
- Create:
  - `packages/fossflow-backend/src/ingest/ingest-keys.service.ts`
  - `src/ingest/ingest-keys.controller.ts`
  - `src/ingest/setup-blocks.ts`
  - `src/ingest/ingest.module.ts` (`@Global`)
- Modify: `src/app.module.ts` (import `IngestModule`)
- Test: `src/ingest/ingest-keys.test.ts`

**Interfaces:**
- Consumes: the Task 1 tables and scopes.
- Produces:
  - `IngestKeySummary`: `{ id: string; name: string; prefix: string; createdBy: string | null; createdAt: Date; lastUsedAt: Date | null; services: { name: string; lastSeenAt: Date }[] }`. `createdBy` is the creator's name.
  - `CreatedIngestKey = IngestKeySummary & { key: string; endpoint: string; setup: SetupBlock[] }`.
  - `SetupBlock = { id: 'node-cjs' | 'node-esm' | 'nextjs'; steps: SetupStep[] }`.
  - `SetupStep = { kind: 'install' | 'env' | 'file'; file?: string; code: string }`.
  - `setupBlocks(input: { endpoint: string; key: string; serviceName: string }): SetupBlock[]`.
  - `IngestKeysService`:
    - `list(projectId): Promise<IngestKeySummary[]>`, newest first;
    - `create(projectId, userId, name): Promise<CreatedIngestKey>`;
    - `remove(id): Promise<void>`. This hard-deletes the key. *My call:* the design's `revokedAt` column is dropped, since nothing reads a revoked key and traffic belongs to the project, not the key;
    - `authenticate(presented: string | undefined): Promise<IngestKeyRef | null>`, with `IngestKeyRef = { id: string; projectId: string }`. It rejects anything not matching `/^ffi_[A-Za-z0-9_-]{43}$/` without a query. Otherwise it looks the key up by SHA-256 hex. *My call:* this replaces the design's constant-time compare, since a caller can't steer a hash, so a lookup timing leaks nothing.
  - Routes:
    - `GET /api/projects/:id/ingest-keys`, needs `ingestKey:read`;
    - `POST /api/projects/:id/ingest-keys` with `{ name }`, needs `ingestKey:create`, answers 201 with `Cache-Control: no-store`;
    - `DELETE /api/ingest-keys/:id`, needs `ingestKey:delete` (`target: 'ingestKey'`), answers 204.
  - Name rule: `z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'Use letters, digits, dots, dashes and underscores (up to 100)')`. It goes into `OTEL_SERVICE_NAME` unquoted.
  - `endpoint` is `${config.publicUrl}/api/otlp`.

- [ ] **Step 1: Write the failing tests** in `ingest-keys.test.ts`. Setup as in `credentials.test.ts`: the owner, Mia as editor, Vic as viewer and Eve as an outsider, all in team project `Shop`.
  - `creates a key shown once`:
    - Mia creates `member-app` and gets 201;
    - `key` matches `/^ffi_[A-Za-z0-9_-]{43}$/` and `prefix === key.slice(0, 12)`;
    - `endpoint === 'http://fossflow.test/api/otlp'`.
  - `setup blocks carry the key, endpoint and name`:
    - the ids are `['node-cjs', 'node-esm', 'nextjs']`;
    - every `env` step contains the lines `OTEL_SERVICE_NAME=member-app`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://fossflow.test/api/otlp` and `OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=<key>`;
    - `nextjs` has `file` steps named `instrumentation.ts` and `instrumentation.node.ts`, and its env contains `NEXT_OTEL_FETCH_DISABLED=1`.
  - `never returns the key again`: the list JSON, as the owner, Mia and Vic, contains neither the key nor its SHA-256 hex. It shows `prefix`, `createdBy: 'Mia'`, `lastUsedAt: null` and `services: []`.
  - `roles`:
    - Vic lists (200), but creating and deleting answer 403;
    - Eve gets 404 on the list, create and delete;
    - Mia deletes (204), and the list is then empty.
  - `rejects names that would break the env block`: `'member app'`, `'a"b'`, `''` and a 101-character name each answer 400.
  - `authenticate`, called on `t.app.get(IngestKeysService)`:
    - the created key returns `{ id, projectId }`;
    - `undefined`, `'ffi_short'`, a well-formed unknown key and a deleted key return `null`.
- [ ] **Step 2: Run.** Run: `npx vitest run src/ingest/ingest-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, the controller and `setupBlocks`.
  - The block text is fixed by spec §1:
    - **node-cjs:**
      - install: `npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node`;
      - env: the nine `OTEL_*` lines from the spec in this order: `SERVICE_NAME`, `TRACES_EXPORTER=otlp`, `EXPORTER_OTLP_PROTOCOL=http/protobuf`, `EXPORTER_OTLP_ENDPOINT`, `EXPORTER_OTLP_HEADERS`, `BSP_SCHEDULE_DELAY=1000`, `TRACES_SAMPLER=always_on`, `METRICS_EXPORTER=none`, `LOGS_EXPORTER=none`;
      - then `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`.
    - **node-esm:** the same, except:
      - the install also adds `@opentelemetry/instrumentation`, so `hook.mjs` resolves under strict package managers;
      - `NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register"`.
    - **nextjs:**
      - install `npm i @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node`;
      - `instrumentation.ts`: `export async function register() { if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation.node'); }`;
      - `instrumentation.node.ts`: `new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();`;
      - env: the nine `OTEL_*` lines plus `NEXT_OTEL_FETCH_DISABLED=1`.

    Task 9 verifies all three against real apps.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): project ingest keys with setup blocks`

---

### Task 3: OTLP decoding

**Files:**
- Create:
  - `packages/fossflow-backend/proto/`: the four files from `opentelemetry-proto` tag `v1.11.1`, i.e. `collector/trace/v1/trace_service.proto`, `trace/v1/trace.proto`, `common/v1/common.proto` and `resource/v1/resource.proto`, under `proto/opentelemetry/proto/…`, plus the repo's `LICENSE` and a 3-line `README.md` naming the tag;
  - `src/ingest/otlp-decode.ts`.
- Modify:
  - `packages/fossflow-backend/package.json` (`protobufjs`, and the OTel devDependencies from Global Constraints);
  - `Dockerfile` (copy `packages/fossflow-backend/proto` next to the `drizzle` line).
- Test: `src/ingest/otlp-decode.test.ts`

**Interfaces:**
- Produces:
  - `type OtlpFormat = 'protobuf' | 'json'`;
  - `formatOf(contentType: string | undefined): OtlpFormat | null`. It checks the media type only, ignoring parameters and case: `application/x-protobuf` or `application/json`;
  - `decodeTraceRequest(body: Buffer, format: OtlpFormat): OtlpTraceRequest`, which throws `OtlpDecodeError` on bad bytes, bad JSON or a wrong shape;
  - the types `OtlpTraceRequest`, `OtlpSpan` and `OtlpKeyValue`, inferred from one zod schema. Unknown fields are stripped, and only these are kept:
    - `resourceSpans[].resource.attributes[]`;
    - `resourceSpans[].scopeSpans[].spans[]` with `kind?` (int), `name?`, `startTimeUnixNano`, `endTimeUnixNano`, `attributes?` and `status?.code?` (int).
  - The two nano times are `string | number` in the input and **`bigint`** after parsing.
  - An attribute value is `{ stringValue?, intValue? (string|number), boolValue?, doubleValue? }`. Array and kvlist values are dropped.
- Approach (verified in a scratch run on 2026-11-13):
  - Build one `protobuf.Root` lazily, with `root.resolvePath = (_origin, target) => join(PROTO_DIR, target)` and `PROTO_DIR = fileURLToPath(new URL('../../proto', import.meta.url))`, the same pattern as `MIGRATIONS_DIR`.
  - Load `opentelemetry/proto/collector/trace/v1/trace_service.proto`.
  - `Type.toObject(Type.decode(body), { longs: String, enums: Number, defaults: false })` gives exactly the OTLP JSON shape. Then the same zod schema parses both formats.

- [ ] **Step 1: Write the failing tests:**
  - `decodes OTLP JSON`: a hand-written fixture following the OTLP JSON rules gives a typed request with `startTimeUnixNano === 1794577130744000000n`, `kind === 3` and `status.code === 2`. The fixture has hex `traceId`/`spanId`, int64 as strings, `kind: 3`, `status: { code: 2 }`, an unknown field `"futureField": 1` and an `arrayValue` attribute.
  - `protobuf and JSON agree`: encode the same object with the vendored root (`Type.encode(Type.fromObject(...))`). Decoding it as `'protobuf'` deep-equals the JSON decode.
  - `accepts int64 as numbers in JSON`.
  - `empty request`: `{}` gives `{ resourceSpans: undefined }` or an empty array, with no throw.
  - `rejects`: these throw `OtlpDecodeError`:
    - `Buffer.from('not protobuf at all')` as protobuf;
    - `'{'` as JSON;
    - `{"resourceSpans": 5}`;
    - a span without `startTimeUnixNano`.
  - `formatOf`: `'application/x-protobuf'` → `protobuf`; `'Application/JSON; charset=utf-8'` → `json`; `'text/plain'` and `undefined` → `null`.
- [ ] **Step 2: Run.** Run: `npx vitest run src/ingest/otlp-decode.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Download the protos with `curl -fsSL https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.11.1/opentelemetry/proto/<path>`.
  - Write `otlp-decode.ts`.
  - Add the Dockerfile line.
- [ ] **Step 4: Run.** Expected: PASS. Then run `npm run build && node -e "import('./dist/ingest/otlp-decode.js').then((m) => console.log(m.decodeTraceRequest(Buffer.alloc(0), 'protobuf')))"`. Expected: an empty request prints with no error, which shows the built code finds `proto/`.
- [ ] **Step 5: Commit.** `feat(server): decode OTLP trace requests (protobuf and JSON)`

---

### Task 4: From spans to scrubbed traffic

**Files:**
- Create:
  - `packages/fossflow-backend/src/ingest/scrub.ts`
  - `src/ingest/spans.ts`
- Test:
  - `src/ingest/scrub.test.ts`
  - `src/ingest/spans.test.ts`

**Interfaces:**
- Consumes: `OtlpTraceRequest` (Task 3).
- Produces:
  - `templatePath(path: string): string`;
  - `cap(value: string, max?: number): string` (default 300);
  - `toTraffic(request: OtlpTraceRequest, receivedAt: number): TrafficBatch`;
  - `TrafficEvent = { kind: 'call' | 'incoming'; caller: string; callee: string; operation: string; at: number; durationMs: number; failed: boolean; status: string | null }`. `at` is ms on the server clock; `caller` is `''` for incoming; `status` is set only when `failed`;
  - `TrafficBatch = { events: TrafficEvent[]; services: string[]; aliases: { host: string; service: string }[] }`.
- Rules (spec §2–3). Attributes are read as "new name, else old name":
  - **Kinds:**
    - kind 3 (CLIENT) with a DB system (`db.system.name`/`db.system`) is a DB call;
    - otherwise kind 3 with an HTTP method (`http.request.method`/`http.method`) is an HTTP call;
    - kind 2 (SERVER) is `incoming`;
    - everything else is dropped, and so is a call whose callee has no host.
  - **Caller:** `service:` + the resource's `service.name`, defaulting to `unknown_service`. `services` collects the distinct names.
  - **HTTP callee:** `host:` + (`server.address`/`net.peer.name`, else the host of `url.full`/`http.url`). It is lower-cased, with any trailing `.` and port removed.
  - **DB callee:** `db:` + (`server.address`/`net.peer.name`, else the DB system) + (`/` + `db.namespace`/`db.name` when present).
  - **HTTP operation:**
    - the method: upper-cased, or `HTTP` unless it matches `^[A-Z]{1,10}$`;
    - then a space and `templatePath` of the path of `url.full`/`http.url`. A URL that `new URL()` can't parse is cut at `?`/`#`, with `scheme://userinfo@host` removed.
    - Incoming spans use `http.route` (as is), else `templatePath(url.path / http.target cut at '?')`.
  - **DB operation:** the first of:
    - `db.query.summary`;
    - `db.operation.name`/`db.operation` + (` ` + `db.collection.name`/`db.sql.table`/`db.mongodb.collection`);
    - the span name, if it matches `^[A-Za-z][\w.:-]*( [\w.]+)?$` and is ≤ 60 characters;
    - `'query'`.
  - **Failed:** `status.code === 2`.
    - The status is `http.response.status_code`/`http.status_code` as a string.
    - Otherwise it is `error.type` if that matches `^[\w.:-]{1,60}$`, else `'error'`.
  - **Timing:**
    - `durationMs = max(0, (end − start) / 1e6)`;
    - `latestEnd` is the maximum end over the whole request;
    - `at = clamp(receivedAt − (latestEnd − start) / 1e6, receivedAt − 3_600_000, receivedAt)`.
  - **Aliases:** from incoming spans, the host is `server.address`/`net.host.name`/`http.host`. It is lower-cased, and a trailing `:port` is removed, unless the host is a bare IPv6 address (`[::1]:3000` → `[::1]`, `fe80::1` unchanged). It is paired with the bare service name.
  - All identities and operations go through `cap`.

- [ ] **Step 1: Write the failing tests.**
  - `scrub.test.ts`, as an `it.each` table of `templatePath` cases:
    - `/v1/customers/12345` → `/v1/customers/{id}`;
    - `/v1/customers/9f8b2c1e-1d2a-4c3b-9a8f-0e1d2c3b4a59/contracts` → `/v1/customers/{id}/contracts`;
    - `/files/a3f5c9e2b1d4f6a8` → `/files/{id}`;
    - `/users/jane.doe@example.com/settings` → `/users/{id}/settings`;
    - `/users/jane%40example.com` → `/users/{id}`;
    - `/sessions/eyJhbGciOiJIUzI1NiJ9abc123` → `/sessions/{id}`;
    - `/orders/INV-2026-004211` → `/orders/{id}` (5 or more digits in a row);
    - `/call/+4917612345678` → `/call/{id}`;
    - `/v1/classes` and `/api/v2/health` and `/blog/how-to-train` stay unchanged;
    - `/` → `/`.
  - The segment rule, applied after `decodeURIComponent` in a try block, matches any of:
    - all digits;
    - a UUID;
    - hex of 16 or more characters;
    - a segment containing `@`;
    - 5 or more digits in a row;
    - 20 or more characters of `[A-Za-z0-9_=.-]` that include a digit.
  - `spans.test.ts`, built from small fixtures with a helper `request(serviceName, spans)`:
    - `new and old HTTP names give the same event`:
      - `{http.request.method, url.full: 'https://API.Magicline.com./v1/customers/42?email=jane@example.com#x', server.address}` and `{http.method, http.url, net.peer.name}` both give `{kind: 'call', caller: 'service:member-app', callee: 'host:api.magicline.com', operation: 'GET /v1/customers/{id}'}`;
      - neither event contains `jane`, `42`, `email` or `#`.
    - `new and old DB names give the same event`:
      - `{db.system.name: 'postgresql', server.address: 'members.db.internal', db.namespace: 'members', db.operation.name: 'SELECT', db.collection.name: 'members', db.query.text: "SELECT * FROM members WHERE email='jane@example.com'"}` gives callee `db:members.db.internal/members` and operation `SELECT members`;
      - the old names (`db.system`, `net.peer.name`, `db.name`, `db.operation`, `db.sql.table`, `db.statement`) give the same.
    - `DB operation fallbacks`:
      - `db.query.summary` wins;
      - a span name `pg.query:SELECT members` is used;
      - a span name holding full SQL gives `'query'`;
      - no `JSON.stringify(batch)` contains `WHERE`.
    - `failures`:
      - ERROR with a status code of 503 gives `failed: true, status: '503'`;
      - ERROR with `error.type: 'timeout'` gives `'timeout'`;
      - ERROR with `error.type: 'Error: user jane@example.com not found'` gives `'error'`;
      - an OK span gives `status: null`.
    - `incoming`:
      - a SERVER span with `http.route: '/api/members/:id'`, `http.request.method: 'GET'` and `server.address: 'Member-App.internal:8080'` gives `{kind: 'incoming', caller: '', callee: 'service:member-app', operation: 'GET /api/members/:id'}`;
      - and the alias `{host: 'member-app.internal', service: 'member-app'}`.
    - `ignores INTERNAL, PRODUCER and CONSUMER spans, and calls without a host`.
    - `anchors a batch on the server clock` (Review Focus 4):
      - two spans with starts 3 hours before `receivedAt`, 2 s apart, the later one ending 100 ms after its start;
      - both `at` values fall within `[receivedAt − 2_200, receivedAt]` and are 2 000 ms apart;
      - the durations are kept.
    - `caps identities at 300 characters`.
- [ ] **Step 2: Run.** Run: `npx vitest run src/ingest/scrub.test.ts src/ingest/spans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `scrub.ts` and `spans.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): map OTLP spans to scrubbed calls`

---

### Task 5: Aggregation and storage

**Files:**
- Create:
  - `packages/fossflow-backend/src/traffic/histogram.ts`
  - `src/traffic/aggregator.ts`
- Modify: `src/ingest/ingest.module.ts` (provide and export `TrafficAggregator`)
- Test:
  - `src/traffic/histogram.test.ts`
  - `src/traffic/aggregator.test.ts`

**Interfaces:**
- Consumes: `TrafficBatch` (Task 4), `IngestKeyRef` (Task 2), and the Task 1 tables and functions.
- Produces:
  - `DURATION_BOUNDS_MS = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000]`. That makes 22 buckets; the last one is "over 30 s". **This is a stored format:** never reorder it; appending needs a migration.
  - `bucketOf(ms: number): number`: the first `i` with `ms <= bounds[i]`, else `bounds.length`.
  - `emptyHistogram(): number[]`.
  - `TrafficAggregator` (Nest provider):
    - `add(key: IngestKeyRef, batch: TrafficBatch, now?: number): void`;
    - `flush(now?: number): Promise<void>`;
    - it flushes every `FLUSH_MS = 5000` (an unref'd timer) and once more in `beforeApplicationShutdown`. That runs before the pool closes in `onApplicationShutdown`.
- Behaviour:
  - Events are bucketed by `(projectId, kind, caller, callee, operation, floor(at / 60 000))` into `{ calls, failures, durationSumMs, histogram }`.
  - Failed events are buffered for `trafficFailure`, at most `100` per arrow per flush. The counts still include every call.
  - Caps live in memory and reset every 24 h. *Ponytail:* a restart can admit up to another 200 operations for a pair.
    - Past 200 distinct operations per `(project, caller, callee)`, the operation becomes `other`.
    - Past 1000 distinct pairs per project, new pairs are dropped, with one warning per project per day.
  - `services` and `aliases` are written at most once a minute per row, and so is `lastUsedAt` per key, using a `Map<string, number>` of last writes.
  - `flush()` swaps the buffers, then writes **each project separately**, each part in its own try/catch:
    - minutes: upsert in chunks of 1000. On conflict, add `calls`, `failures` and `durationSumMs`, and set `histogram = int_array_add(traffic_minute.histogram, excluded.histogram)`;
    - failures: insert;
    - aliases: upsert `lastSeenAt`;
    - per key: `ingestService` upsert and the `ingestKey.lastUsedAt` update.

    A failure logs a warning naming the project and table and drops that part. *Ponytail:* those seconds of counts are lost; add retries if Postgres outages turn out to matter.

- [ ] **Step 1: Write the failing tests.**
  - `histogram.test.ts`: `bucketOf(0) = 0`, `bucketOf(5) = 0`, `bucketOf(5.1) = 1`, `bucketOf(30000) = 20`, `bucketOf(30001) = 21`, and `emptyHistogram().length = 22`.
  - `aggregator.test.ts` uses a test app, a project with a key, and `t.app.get(TrafficAggregator)`:
    - `stores a minute`: add two calls (120 ms ok, 480 ms failed with `'503'`) in one minute, then flush. Expect one row with `calls 2`, `failures 1`, `durationSumMs 600`, histogram 1 in bucket 7 and 1 in bucket 10, and one failure row with status `'503'`.
    - `adds to an existing minute`: add the same again and flush. Expect `calls 4`, and histogram counts of 2 in buckets 7 and 10.
    - `writes services, aliases and lastUsedAt`: expect `ingestService` (key, `member-app`), `trafficAlias` (`member-app.internal` → `member-app`) and `ingestKey.lastUsedAt` all set.
    - `caps operations and pairs` (Review Focus 3):
      - 205 distinct operations on one pair give 200 named rows plus `other` with `calls 5`;
      - 1005 distinct callees give 1000 pair rows.
    - `caps buffered failures per arrow`: 150 failures in one flush give 100 failure rows and `failures 150`.
    - `a deleted project doesn't poison the flush` (Review Focus 2): add for projects A and B, delete A, then flush. `flush()` resolves, B's rows exist and A's don't.
- [ ] **Step 2: Run.** Run: `npx vitest run src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement** `histogram.ts` and `aggregator.ts`. Drizzle `onConflictDoUpdate` takes `set` values like ``sql`${trafficMinute.calls} + excluded.calls` ``.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): aggregate calls per minute in Postgres`

---

### Task 6: The OTLP endpoint

**Files:**
- Create: `packages/fossflow-backend/src/ingest/otlp-handler.ts`
- Modify:
  - `src/app.ts`: mount the handler before `app.useBodyParser('json', …)`;
  - `package.json`: declare `express`;
  - `nginx.conf` at the repo root.
- Test:
  - `src/ingest/otlp-handler.test.ts` (limiter unit)
  - `src/ingest/ingest.test.ts` (end to end)

**Interfaces:**
- Consumes:
  - `IngestKeysService.authenticate` (Task 2);
  - `formatOf` and `decodeTraceRequest` (Task 3);
  - `toTraffic` (Task 4);
  - `TrafficAggregator.add` (Task 5).
- Produces:
  - `createKeyLimiter(limit: number, windowMs: number): { take(keyId: string, now: number): { ok: true } | { ok: false; retryAfterSeconds: number } }`, a fixed window per key;
  - `createOtlpHandler(deps: { keys: IngestKeysService; aggregator: TrafficAggregator }): RequestHandler`;
  - in `createApp`: `server.post('/api/otlp/v1/traces', createOtlpHandler({ keys: app.get(IngestKeysService), aggregator: app.get(TrafficAggregator) }))`.
  - Because the handler is mounted on Express, Nest's throttler, origin and session guards never run for it. `/api/otlp/v1/metrics` and `/v1/logs` fall through to Nest and answer 404.
- Handler order and answers:
  1. `authenticate(req.headers['x-fossflow-key'])`. Null answers **401** without reading the body.
  2. The limiter (1200 per 60 s). Over the limit answers **429** with `Retry-After`.
  3. `formatOf(content-type)`. Null answers **415**.
  4. Read the body with Express `raw({ type: () => true, limit: INGEST_MAX_BYTES })`, wrapped in a Promise. It inflates gzip and applies the limit to the *inflated* size: an error with status 413 answers **413**, and any other parser error answers its status or 400.
  5. Decode. `OtlpDecodeError` answers **400**.
  6. `aggregator.add(key, toTraffic(request, Date.now()))`.
  7. Answer **200** with an empty body as `application/x-protobuf`, or `{}` for JSON.

  Any unexpected error is logged without the body and answers 500.
- nginx: add a `location /api/otlp/` block before `location /api/`. It copies the `/api/` proxy lines, and sets `auth_basic off;` and `client_max_body_size 16m;`.

- [ ] **Step 1: Write the failing tests.**
  - `otlp-handler.test.ts`: with the limit 3 and a 60 s window, takes at t=0 return ok ×3, then `{ ok: false, retryAfterSeconds: 60 }`. At t=59 000 the retry is 1 second; at t=60 000 it is ok. Keys don't share a window.
  - `ingest.test.ts`:
    - Start a test app with `await t.app.listen(0, '127.0.0.1')`. Set up the owner, team project `Shop` with Mia as editor, a key created by Mia, and a second project `Other` with its own key.
    - The exporter helper builds `new TracerProvider({ resource: resourceFromAttributes({ 'service.name': name }), spanProcessors: [new SimpleSpanProcessor({ exporter })] })`, with explicit `startTime` and `end(time)`, then calls `forceFlush()` and `shutdown()`.
    - The URL and header come **from the key's `node-cjs` env step**: `OTEL_EXPORTER_OTLP_ENDPOINT` with `http://fossflow.test` replaced by the listening address, plus `/v1/traces`; the header is parsed from `OTEL_EXPORTER_OTLP_HEADERS`. This proves the setup block's contract.
    - Tests:
      - `protobuf with gzip, end to end`: `exporter-trace-otlp-proto` with `compression: CompressionAlgorithm.GZIP` sends:
        - from `member-app`: `GET https://api.magicline.com/v1/customers/12345?email=jane@example.com` (120 ms, ok);
        - `POST …/v1/checkins` (ERROR, 503);
        - one DB span with `db.query.text` containing `jane@example.com`;
        - one SERVER span;
        - one INTERNAL span.

        After `flush()`, expect the four `trafficMinute` rows from Task 4's mappings, one failure `'503'`, `ingestService` `member-app`, an alias, and `lastUsedAt` set.
      - `JSON with old attribute names`: `exporter-trace-otlp-http` from `sync-service` stores the same shapes.
      - `stores nothing personal`: `JSON.stringify` of every row in the six traffic and ingest tables contains none of `jane`, `12345`, `email=`, `WHERE` or the raw key.
      - `keeps projects apart`: `Other`'s key stores rows only under `Other`.
      - HTTP answers (supertest):
        - no key, `ffi_short`, an unknown well-formed key and a deleted key answer 401;
        - `text/plain` answers 415;
        - garbage protobuf, `{` as JSON and `{"resourceSpans":5}` answer 400;
        - a 17 MiB raw body answers 413;
        - 17 MiB of zeros gzipped with `Content-Encoding: gzip` answers 413;
        - `POST /api/otlp/v1/metrics` answers 404;
        - an empty JSON request answers 200 with `{}` and `application/json`;
        - an empty protobuf request answers 200 with a 0-byte `application/x-protobuf` body.
      - `limits per key, not per IP`: on a dedicated key, 1200 empty JSON requests all answer 200, which shows the per-IP limit of 120/min doesn't apply. The 1201st answers 429 with `Retry-After`, and the `Shop` key still answers 200.
- [ ] **Step 2: Run.** Run: `npx vitest run src/ingest`. Expected: FAIL.
- [ ] **Step 3: Implement** the handler, the wiring and the nginx block.
- [ ] **Step 4: Run the whole backend suite.** Run: `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): OTLP/HTTP trace endpoint with ingest keys`

---

### Task 7: Hourly roll-up and retention

**Files:**
- Create: `packages/fossflow-backend/src/traffic/maintenance.ts`
- Modify: `src/ingest/ingest.module.ts`
- Test: `src/traffic/maintenance.test.ts`

**Interfaces:**
- Consumes: `AppConfig.traffic` and the Task 1 tables.
- Produces: `TrafficMaintenance` (Nest provider):
  - `rollUp(now: Date): Promise<void>`;
  - `prune(now: Date): Promise<void>`;
  - it runs both every 10 minutes (unref'd interval, cleared on shutdown).
- Behaviour:
  - **rollUp** recomputes every hour from `from` up to (not including) the current hour:
    - `from` is the latest `trafficHour.hour`, or `now − minutesDays` when there are none;
    - it groups `trafficMinute` by `date_trunc('hour', minute)` and the other key columns;
    - it inserts into `trafficHour` with `sum(...)` and `int_array_sum(histogram)`. On conflict it **replaces** the values, so reruns are idempotent and a partly rolled hour gets completed.
  - **prune** deletes:
    - minutes older than `minutesDays`;
    - hours older than `hoursDays`;
    - failures older than `failuresDays`;
    - and failures past the newest 500 per `(projectId, kind, caller, callee)` (`row_number() OVER (… ORDER BY at DESC) > 500`).

- [ ] **Step 1: Write the failing tests.** Seed rows directly with Drizzle.
  - `rolls minutes into hours`: two minutes in the previous hour with histograms `[1,0,…]` and `[0,2,…]` give one hour row with `calls` summed and histogram `[1,2,…]`.
  - `rerunning changes nothing`.
  - `completes a partly rolled hour`: after a third minute is added to an already rolled hour and `rollUp` runs again, the row includes it.
  - `catches up after downtime` (Review Focus 5): the latest hour row is 5 h old and there are minutes in each hour since. All 5 hours are rolled up.
  - `prunes by age and count`: these are gone, and newer rows stay:
    - a minute 8 days old;
    - an hour 91 days old;
    - a failure 8 days old;
    - the oldest of 501 recent failures on one arrow.
  - `honours the env settings`: with `TRAFFIC_MINUTES_DAYS=3`, a 4-day-old minute is pruned.
- [ ] **Step 2: Run.** Run: `npx vitest run src/traffic/maintenance.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The roll-up is one `INSERT … SELECT … GROUP BY … ON CONFLICT … DO UPDATE SET calls = excluded.calls, …` statement.
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): hourly traffic roll-up and retention`

---

### Task 8: Monitoring → Services

**Files:**
- Create, under `packages/fossflow-app/src/platform/`:
  - `monitoring.ts`
  - `components/ProjectMonitoring.tsx`
  - `components/ConnectService.tsx`
  - `components/SetupBlocks.tsx`
  - `components/IngestKeyRow.tsx`
- Modify:
  - `pages/ProjectPage.tsx`
  - `platform.css`
  - both `en-US.json` files

**Interfaces:**
- Consumes: the Task 2 routes and response types. Mirror `IngestKeySummary`, `CreatedIngestKey`, `SetupBlock` and `SetupStep` in `monitoring.ts`, with dates as strings.
- Produces:
  - `ingestKeysKey(projectId)`;
  - `useIngestKeys(projectId)`, which refetches every 15 s so "last data" and "seen as" update while someone pastes a block;
  - `<ProjectMonitoring project={ProjectDetail} />`.
- UI (hairline style; reuse `panel`, `list__row`, `inline-form`, `FormError` and `useSubmit`, with the inline confirm copied from `CredentialRow`):
  - A **Monitoring** tab appears when `can(project, 'ingestKey:read')`, at the route `monitoring`.
  - The tab shows a **Services** heading and a hint. The Alerts section comes in milestone 3.
  - **Connect a service** (only with `ingestKey:create`) opens a name field, with a hint that the name becomes `OTEL_SERVICE_NAME`.
  - Once created, a panel shows:
    - the key with Copy, and the text "Copy it now. It won't be shown again.";
    - `SetupBlocks`: three tabs (Node.js (CommonJS), Node.js (ES modules), Next.js). Each step has a label (Install / Environment variables / File `name`), a `<pre>` code block and Copy;
    - a **Done** button, which forgets the key.
  - **Rows:** the name; then `prefix…`, "created by X" and "last data <date>" or "no data received yet"; then "Seen as: member-app (date), …".
  - **Revoke** (only with `ingestKey:delete`) has an inline confirm: "Services using this key stop sending data. Traffic already received stays."
  - Strings go under `platform.monitoring.*` plus `platform.projects.monitoring`.

- [ ] **Step 1: Build.** Run: `npm run build -w packages/fossflow-app` and `npx tsc -p packages/fossflow-app --noEmit`. Expected: no new errors beyond the known baseline.
- [ ] **Step 2: Browser walkthrough** on the dev stack. Use the throwaway setup from milestone 6's walkthrough; test logins live only in the scratchpad.
  - Create a key as an editor and copy each block.
  - The list updates after the step 4 smoke send (or a curl).
  - A viewer sees the list without Connect or Revoke.
  - Revoke works.
  - Take a screenshot as proof.
- [ ] **Step 3: Commit.** `feat(app): Monitoring tab with service keys and setup blocks`

---

### Task 9: Real hook-up check and milestone wrap-up

**Files:**
- Modify: `docs/AUDIT.md`
- Throwaway apps live in the scratchpad only.

- [ ] **Step 1: The three setup blocks against real apps** (dev backend on :3001, blocks pasted verbatim with the endpoint pointed at the dev URL). Build each app:
  - a CommonJS Express app that calls `https://example.com` and a local Postgres query;
  - the same as an ES module;
  - `npx create-next-app@latest` (Next 16.x) with a route handler that fetches `https://example.com`.

  Run each. Expected:
  - Monitoring lists each service name under its key;
  - `traffic_minute` has `call` rows to `host:example.com` (and the DB) and `incoming` rows;
  - the Next.js rows are **not doubled**, which confirms `NEXT_OTEL_FETCH_DISABLED=1`.

  If a block needs a change, fix the text in `setup-blocks.ts` and its test.
- [ ] **Step 2: Docker and nginx.** Run `docker compose up` with a scratchpad env, as in the M6 walkthrough, with `HTTP_AUTH_*` set.
  - `curl -X POST /api/otlp/v1/traces` without Basic Auth answers the **backend's** 401 (no `WWW-Authenticate: Basic` header).
  - A request with a valid key and a 12 MB body passes nginx.
  - Run `docker compose down -v` afterwards.
- [ ] **Step 3:** Run `/verify`, then a security review of the branch diff on a Sonnet subagent: scrubbing, key handling, pre-auth body reading and nginx. Fix any CRITICAL or HIGH finding.
- [ ] **Step 4:** Add a milestone 1 entry to `docs/AUDIT.md`: what changed, the accepted risks (no per-IP limit on bad keys, numbers lost if Postgres is down during a flush, `{id}` heuristics can't catch plain names in paths) and how it was verified. Commit: `docs: live traffic milestone 1 audit`.
- [ ] **Step 5:** Push `feat/live-traffic` and open a **draft** PR with base `feat/platform-foundation`. The description is per milestone, with M1 ✅, and ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Then check in.
