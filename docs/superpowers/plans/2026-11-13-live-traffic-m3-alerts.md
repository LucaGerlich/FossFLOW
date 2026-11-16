# Live traffic, milestone 3: alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project can define alert rules on arrows and boxes: failing, slow or silent. FossFLOW checks them every minute and sends one message when an alert starts, a reminder every 4 hours while it lasts, and one when it clears, by email, Slack, Microsoft Teams or a generic webhook. Firing alerts colour the map, and an arrow or box card offers "Alert me when…".

**Architecture:**
- **Channels are credentials** of a new kind. The connector registry splits into `source` connectors (Beszel, today) and `channel` connectors (email, Slack, Teams, webhook), and a channel's "test on save" sends a test message.
- **Server side:**
  - An `AlertEvaluator` runs every 60 s. It writes an "ingest alive" heartbeat, measures every enabled rule from `traffic_minute` and `traffic_hour`, and moves rules between ok and firing as `alert_event` rows.
  - A `Deliveries` service sends start, reminder and resolve messages with retries and records the outcome on the event.
  - The landscape summary lists firing alerts, so the map can colour them.
- **App side:** the app gets Monitoring → Alerts and a rule form on its own route, and groups credentials by kind.

**Tech Stack:** NestJS 12 (ESM), Express 5, Drizzle 0.45 and Postgres 18, zod 4, `node:https`, `node:dns` and `node:net` (`BlockList`), nodemailer (already installed). Vitest with Testcontainers on the server. React 19 and MUI in the lib, tested with Jest and Testing Library. React Router 7 and TanStack Query in the app. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-13-live-traffic-alerts-design.md`, section 6 and milestone 3, plus the alert parts of section 5: trouble from firing rules, "slow" only with a slow rule, and "Alert me when…". Milestones 1 and 2 are done; `docs/AUDIT.md` describes them.

## My calls (veto any when approving)

1. **Evaluation reads the flushed `traffic_minute` table only, not the aggregator's in-memory buffer.** The buffer is flushed every 5 s, so a rule sees data at most 5 s late. The alternative is a second read path into the aggregator.
2. **No message storms:**
   - an alert **resolves only after its condition has been clear for 3 minutes** in a row;
   - a window with **fewer calls than the rule's minimum changes nothing**: it neither starts nor resolves an alert.

   A value bouncing around the threshold therefore sends one message, not one a minute.
3. **Silent rules:**
   - **Counting:** a call counts at the end of its minute (or its hour, for older data), so a silent alert never fires early.
   - **Arming:** a rule is armed once its target has carried traffic, and that is stored on the rule (`armedAt`). It stays armed when old data is pruned.
   - **Downtime:** FossFLOW's own downtime of more than 5 minutes counts like a call at the moment it ended, which is the spec's "wait N minutes after the gap".
4. **Teams allowlist: hosts ending in `.api.powerplatform.com` only.** Teams Workflows URLs moved to `*.environment.api.powerplatform.com`, and the old `logic.azure.com` trigger URLs stopped working on 30 November 2025 ([topedia](https://blog-en.topedia.com/2025/10/http-and-teams-webhook-trigger-urls-must-be-updated-in-power-automate-and-copilot-studio-agent-flows/), [Liongard](https://support.liongard.com/en/articles/12232595-microsoft-teams-integration-changes-common-issues-and-best-practices)). Slack: host exactly `hooks.slack.com`, with a path under `/services/`.
5. **Outbound sends use `node:https` with an address check at connect time** (a `lookup` hook), so a DNS name can't switch to a private address between the check and the connection. There are no redirects, a 10 s timeout, and the response body is never read. Slack and Teams refuse private, loopback and link-local addresses. The generic webhook may target internal addresses: this is the accepted risk from phase 1, as the spec says.
6. **Real Slack and Teams delivery** is checked with payload fixtures and the URL rules. The walkthrough delivers to a local HTTPS webhook (trusted through `NODE_EXTRA_CA_CERTS`) and to a local mail catcher (the `axllent/mailpit` Docker image). If you give me a Slack or Teams test webhook, I'll add those.
7. **Viewers read rules and alerts with `project:read`.** Only the three new edit scopes are added: `alertRule:create|update|delete`, held by admins and editors.
8. **Disabling or deleting a rule closes its open alert without a message.**
9. **"Alert me when…"** opens the rule form on its own route, prefilled with the box identities and the name "Box A → Box B". It shows only for people who may create rules.
10. **Limits:** 100 rules per project, 10 channels per rule, 20 email recipients per channel, and the last 50 deliveries kept per alert.

## Global Constraints

- **Git:**
  - Branch `feat/live-traffic`.
  - Conventional commits (`feat(server): …`, `feat(lib): …`, `feat(app): …`) with identity `LucaGerlich <lucagerlich@gmail.com>`, **no Co-Authored-By line and no mention of Claude**.
  - Run `/verify` before every non-docs commit; implementers run the gate (lint or type check, tests, build) and the controller runs `/verify` once at the end. Never commit `.env` files.
- **Code style:**
  - match the existing files: 2-space indent in `.ts`/`.tsx`, 4-space in the app's i18n JSON;
  - ESM `.js` import suffixes in the backend;
  - TypeScript strict with no `any`;
  - errors name the field and rule, never the value;
  - logs carry error names or status codes, never messages, URLs or payloads.
- **Rule kinds and defaults:**
  - **failing:** `failedPct ≥ threshold` (%, 0.1–100) over N minutes (1–60), with at least `minCalls` calls (default 10, range 1–100000);
  - **slow:** `p95 ≥ threshold` (ms, 1–600000) over N minutes (1–60), with at least `minCalls` calls;
  - **silent:** no matching call for N minutes (5–2880, i.e. up to 48 hours).
- **Targets:**
  - **arrow:** `{ type: 'arrow', from, to }`. It covers client calls whose caller matches `from` and whose callee matches `to`. A `service:` pattern on the `to` side also matches the hosts aliased to that service.
  - **box:** `{ type: 'box', identity }`. A `service:` identity uses that service's incoming requests; `host:` and `db:` identities use all client calls into them.
  - Patterns use the lib's identity rule: `^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$`, at most 300 characters. `T:*.REST` matches `T:X.REST` with a non-empty `X`.
- **Timing:**
  - evaluation every 60 s;
  - a reminder every **4 hours** while firing;
  - resolve after **3 minutes** clear;
  - a gap counts when longer than **5 minutes**;
  - the heartbeat key in `meta` is `ingest.alive`;
  - gaps are kept 3 days.
- **Delivery:**
  - HTTPS only, no redirects, 10 s timeout per attempt;
  - **3 attempts**, waiting 2 s and then 8 s;
  - on 429, the `Retry-After` value is honoured up to 60 s, and beyond that the delivery gives up;
  - 4xx answers other than 429 are not retried;
  - only the status (or a fixed error category: `timeout`, `refused`, `network`, `smtp`, `missing`) is recorded and shown, never a response body.
- **Message copy (en-US, server-side, plain text), first line then the link `{publicUrl}/projects/{projectId}/monitoring`:**
  - `Failing · {name} · {pct}% of {calls} calls failed in the last {N} min (threshold {X}%)`
  - `Slow · {name} · p95 {p95} over {calls} calls in the last {N} min (threshold {T})`
  - `Silent · {name} · no calls for {since} (threshold {N})`
  - reminders replace the first word with `Still failing`, `Still slow` or `Still silent`;
  - `Resolved · {name} · {kind} for {duration}`;
  - `Test · {project} · FossFLOW alerts will arrive here`.

  Formatting rules:
  - counts use en-US thousands separators (`1,260`) and percentages one decimal (`4.1`);
  - durations are `95 ms`, `1.2 s`, `35 min`, `2 h 5 min`;
  - **operations, statuses and member data never appear in a message.**
- **Payloads:**
  - **Slack:** `{ "text": "<line>\n<link>" }`.
  - **Teams:** `{ "type": "message", "attachments": [{ "contentType": "application/vnd.microsoft.card.adaptive", "content": AdaptiveCard 1.4 }] }`. The card has a bold `TextBlock` with the first line, then an `Action.OpenUrl` to the link.
  - **Webhook:** `{ "rule": { "id", "name", "kind" }, "state": "firing"|"reminder"|"resolved"|"test", "target", "value", "threshold", "windowMinutes", "startedAt", "url" }`.
  - **Email:** subject = first line, body = first line, a blank line and the link.
- **UI text:**
  - lib text in the `traffic` namespace in **all 12** lib locale files;
  - app text under `platform.alerts.*` and `platform.credentials.*` in **both** en-US app files, which stay byte-identical.
- **Look:** hairline. Red (`LIVE_TOKENS.critical*`) for failing and silent, amber (`LIVE_TOKENS.warning*`) for slow; healthy stays quiet.
- **Nothing regresses:**
  - Beszel credentials, live data, local mode and the milestone 1–2 traffic features behave as before;
  - all existing tests stay green;
  - app `tsc` stays at its 7 known errors.
- **Walkthroughs:**
  - Never touch ports 3000 and 3001 or `fossflow-db-1`.
  - The backend runs from a scratch working directory on 3011 with the app dev server on 3010, against a throwaway database.
  - Test logins and webhook URLs live only in the scratchpad.

## Review Focus

1. **FossFLOW is down for 20 minutes while a 30-minute silent rule watches a job that called 10 minutes before the downtime.** No silent alert may fire until 30 minutes after FossFLOW came back. → Task 4, "a long gap delays silent alerts".
2. **A failure rate bouncing around the threshold** (5.1 %, 4.9 %, 5.2 %, …, minute by minute). It must give one start message and no resolve until 3 clear minutes. → Task 4, "flapping sends one start".
3. **A Slack or Teams URL whose host resolves to an internal address** (`127.0.0.1`, `10.0.0.5`, `169.254.169.254`, an IPv4-mapped IPv6), or a server answering with a redirect. The send is refused or treated as failed, and never followed. → Task 1, "private addresses are refused at connect time" and "redirects are not followed".
4. **A channel deleted (or a credential that isn't a channel) while a rule still lists it.** Delivery records `missing` for that channel and still reaches the others; the evaluator doesn't throw. → Task 5, "a missing channel is recorded and skipped".
5. **An arrow rule `service:web → service:orders` while web calls `host:orders.internal`**, which is aliased to `orders`. The rule counts those calls. → Task 4, "arrow rules follow aliases".

---

### Task 1: Outbound sender, alert messages and the four channel types

**Files:**
- Create:
  - `packages/fossflow-backend/src/connectors/outbound.ts`
  - `src/connectors/channels/message.ts`
  - `src/connectors/channels/slack.ts`, `teams.ts`, `webhook.ts`, `email.ts`
- Modify: `src/mail/mailer.ts` (adds `sendAlert`)
- Test:
  - `src/connectors/outbound.test.ts`
  - `src/connectors/channels/message.test.ts`
  - `src/connectors/channels/channels.test.ts`

**Interfaces:**
- Produces:
  - **`outbound.ts`:**
    - `isPublicAddress(address: string, family: 4 | 6): boolean`, built with `net.BlockList`. It refuses `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, `::/128`, `::1/128`, `fc00::/7`, `fe80::/10` and `ff00::/8`. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is judged by its IPv4 part.
    - `PostResult = { ok: boolean; status: number | null; retryAfterSeconds: number | null; error: 'timeout' | 'refused' | 'network' | null }`. `ok` means 2xx.
    - `postJson(url: URL, body: unknown, options: { allowPrivate: boolean; timeoutMs?: number }, deps = { request: https.request, lookup: dns.lookup }): Promise<PostResult>`:
      - refuses non-`https:` URLs with `refused`;
      - uses `deps.lookup` with `all: true` inside a `lookup` hook passed to `request`. Unless `allowPrivate`, any non-public address fails the connection with `refused`;
      - sends `content-type: application/json`;
      - takes the status from the response headers and never reads the body (`res.resume()`), so a 3xx is just a non-2xx status;
      - parses `retry-after` as seconds;
      - times out at 10 s (`timeout`).
  - **`channels/message.ts`:**
    - `AlertMessage = { state: 'firing' | 'reminder' | 'resolved' | 'test'; kind: 'failing' | 'slow' | 'silent' | null; ruleId: string | null; ruleName: string; projectName: string; target: AlertTarget | null; value: number | null; threshold: number | null; windowMinutes: number | null; calls: number | null; sinceMinutes: number | null; startedAt: string | null; durationMinutes: number | null; url: string }`.
    - `AlertTarget = { type: 'arrow'; from: string; to: string } | { type: 'box'; identity: string }`. It is exported here; Task 3 imports it.
    - `alertLine(message: AlertMessage): string` builds the copy in Global Constraints. `formatCount`, `formatDuration` and `formatMinutes` are exported for tests.
  - **Mailer:** `Mailer.sendAlert(to: string[], subject: string, text: string): Promise<void>`. It is a no-op (and never called) when SMTP is off.
  - **Channel definitions** (settings schema and `send`), registered in Task 2:
    - `slackChannel`: settings `{ url }`, secret. An https URL with host exactly `hooks.slack.com` and a path starting `/services/`. It sends `{ text }` with `allowPrivate: false`.
    - `teamsChannel`: `{ url }`, secret. An https URL whose host ends with `.api.powerplatform.com`. It sends the Adaptive Card message from Global Constraints with `allowPrivate: false`.
    - `webhookChannel`: `{ url }`, secret. Any https URL without user info. It sends the webhook JSON with `allowPrivate: true`.
    - `emailChannel`: `{ to }`, not secret. Comma- or newline-separated addresses, 1–20 valid emails. It sends with `mailer.sendAlert`; a thrown error becomes `error: 'smtp'`.
    - `ChannelDeps = { postJson: typeof postJson; mailer: Mailer }`.
    - `send(settings, message: AlertMessage, deps: ChannelDeps): Promise<PostResult | { ok: boolean; status: null; retryAfterSeconds: null; error: 'smtp' | null }>`.

- [ ] **Step 1: Write the failing tests**
  - `outbound.test.ts`:
    - an `isPublicAddress` table: `8.8.8.8` → true; `127.0.0.1`, `10.0.0.5`, `169.254.169.254`, `172.31.0.1`, `192.168.1.1`, `::1`, `fe80::1`, `fd00::1` and `::ffff:10.0.0.1` → false; `2606:4700::1111` → true.
    - "private addresses are refused at connect time": a fake `request` that runs the `lookup` hook with a fake `deps.lookup` answering `[{ address: '10.0.0.5', family: 4 }]` gives `error: 'refused'` when `allowPrivate` is false, and connects when it is true.
    - "redirects are not followed": a fake response with status 302 and `location` gives `{ ok: false, status: 302 }` and exactly one `request` call.
    - `http:` URLs are refused; `retry-after: 30` gives `retryAfterSeconds: 30`; a timeout gives `error: 'timeout'`.
  - `message.test.ts`:
    - failing → exactly `Failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)`;
    - slow → `Slow · Web → DB · p95 1.2 s over 300 calls in the last 10 min (threshold 800 ms)`;
    - silent → `Silent · Nightly sync · no calls for 2 h 5 min (threshold 2 h)`;
    - reminder → `Still failing · …`;
    - resolved → `Resolved · Member app → MagicLine · failing for 23 min`;
    - test → `Test · Team A · FossFLOW alerts will arrive here`.
  - `channels.test.ts`:
    - URL rules: `https://hooks.slack.com/services/T/B/x` passes; `https://hooks.slack.com.evil.io/services/x`, `http://hooks.slack.com/services/x` and `https://hooks.slack.com/api/x` fail. `https://default1.westeurope.environment.api.powerplatform.com/powerautomate/automations/direct/…` passes; `https://prod-1.westus.logic.azure.com/…` fails. A webhook with `https://user:pw@x.io` fails.
    - Payload fixtures, with `postJson` stubbed: the exact JSON bodies for Slack, Teams and the webhook, the right `allowPrivate`, and email `sendAlert(['a@x.io','b@x.io'], subject, text)`.
    - A message never contains an operation string: a resolved failing message built from a rule whose events had operation `GET /members/{id}` doesn't include it.
- [ ] **Step 2: Run them.** Run `cd packages/fossflow-backend && npx vitest run src/connectors`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run the backend gate.** Run `npm run lint`, `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): alert messages and email, Slack, Teams and webhook senders`

---

### Task 2: Channel credentials

**Files:**
- Modify:
  - `packages/fossflow-backend/src/connectors/connector.ts`, `registry.ts`, `beszel.ts`
  - `src/credentials/credentials.service.ts`, `credentials.controller.ts`
  - `src/live/` where landscape sources are saved and opened
- Test: `src/credentials/credentials.test.ts`, plus a new `src/credentials/channels.test.ts`

**Interfaces:**
- Consumes: Task 1's channel definitions, `postJson` and `Mailer.sendAlert`.
- Produces:
  - **Connector types:**
    - `ConnectorKind = 'source' | 'channel'`.
    - `ConnectorInfo` gains `kind`.
    - `Connector = SourceConnector | ChannelConnector`, a discriminated union on `kind`. The existing `defineConnector` produces `SourceConnector`; `defineChannel({ info, schema, send })` produces `ChannelConnector`.
  - **Registry:**
    - `CONNECTORS = [beszelConnector, emailChannel, slackChannel, teamsChannel, webhookChannel]`.
    - `connectorInfos({ smtpEnabled }: { smtpEnabled: boolean })` leaves out `email` when SMTP is off.
    - `GET /api/connectors` returns `kind` and respects `smtpEnabled` from the injected `MAILER`.
  - **Credentials:**
    - `CredentialSummary` gains `kind: ConnectorKind`.
    - Creating an `email` credential while SMTP is off answers **400** `{ error: 'Email needs SMTP to be configured' }`.
    - For a channel, test-on-save (create, update and `POST /api/credentials/:id/test`) sends `alertLine` of a `test` message with the project's name. It gives `{ ok: true, message: 'Test message sent' }`, or `{ ok: false, message: 'Not delivered (<status or category>)' }`.
    - Sources keep today's Beszel test.
  - **Live sources:**
    - `PUT /api/landscapes/:id/sources` answers **400** `{ error: 'Only data sources can be attached to a landscape' }` for a channel credential.
    - `LiveSourcesService` never opens a channel credential.

- [ ] **Step 1: Write the failing tests** in `channels.test.ts`, against a test app with `postJson` stubbed. For this:
  - export a `POST_JSON` injection token from `outbound.ts`, which the credentials service and Task 5 inject;
  - extend `startTestApp(env, overrides?)` in `src/test/app.ts` with an optional list of `{ provide, useValue }` applied through `overrideProvider`.
  - `GET /api/connectors` lists `beszel` (kind `source`) and `slack`, `teams` and `webhook` (kind `channel`), without `email` when SMTP is unset. With `SMTP_HOST` and `SMTP_FROM` set, `email` is listed.
  - Creating a Slack credential with a valid URL gives 201 with `test: { ok: true, message: 'Test message sent' }`, and the stub received a `Test · …` text. With the stub answering 404, `test` is `{ ok: false, message: 'Not delivered (404)' }`, and the credential is still saved.
  - Creating a Slack credential with `https://evil.io/services/x` gives 400 naming `url`.
  - The list shows `kind: 'channel'`; `GET /api/credentials/:id` never returns the URL (`secretsSet: ['url']`).
  - Attaching a channel credential as a landscape source gives 400.
  - A viewer gets 403 on creating a channel, and an outsider 404, as for sources.
  - The existing `credentials.test.ts` stays green, with Beszel listed as kind `source`.
- [ ] **Step 2: Run them.** Run `npx vitest run src/credentials src/connectors`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the backend gate.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): alert channels as credentials`

---

### Task 3: Rules, events and gaps: tables, scopes and the API

**Files:**
- Modify:
  - `packages/fossflow-backend/src/database/schema.ts`
  - `src/rbac/roles.ts`
  - `src/projects/project-access.ts`
  - `src/app.module.ts`
- Create:
  - `drizzle/0008_alerts.sql` (generated)
  - `src/alerts/rules.service.ts`, `rules.controller.ts`, `alerts.module.ts`, `targets.ts`
- Test:
  - `src/rbac/roles.test.ts`
  - new `src/alerts/rules.test.ts`

**Interfaces:**
- Consumes: `AlertTarget` (Task 1); the credentials table and `kind` (Task 2).
- Produces:
  - **Tables:**
    - `alertRule`:
      - columns: `id` text PK; `projectId` → project, cascade; `name` text; `kind` text enum `failing|slow|silent`; `target` jsonb (`AlertTarget`); `threshold` double, nullable (null for silent); `windowMinutes` int; `minCalls` int (default 10); `channelIds` `text[]`; `enabled` bool (default true); `armedAt` timestamptz, nullable; `createdBy` → user, set null; `createdAt`; `updatedAt`;
      - index on `projectId`.
    - `alertEvent`:
      - columns: `id` bigint identity PK; `ruleId` → alertRule, cascade; `projectId` → project, cascade; `startedAt`; `resolvedAt`, nullable; `clearSince`, nullable; `lastNotifiedAt`; `value` double, nullable; `deliveries` jsonb, default `[]`;
      - indexes `(projectId, resolvedAt)` and `(ruleId, resolvedAt)`.
    - `ingestGap`: `id` bigint identity PK; `from` timestamptz; `to` timestamptz; index on `to`.
  - **Scopes:** `alertRule:create|update|delete` in `PROJECT_SCOPES` and `CONTENT_SCOPES`; the viewer gets none. `RequireProjectScope` gains the target `alertRule` (table `alertRule`, not found → `'Alert rule not found'`).
  - **`targets.ts`:**
    - `identityPattern` (zod, the shared rule);
    - `alertTargetSchema` (a discriminated union on `type`);
    - `matchesIdentity(pattern: string, id: string): boolean`, a copy of the lib's rule with a "keep in sync with `packages/fossflow-lib/src/traffic/match.ts`" header.
  - **`ruleInputSchema`:**
    - `name`: 1–100, trimmed;
    - `kind`, `target`;
    - `threshold`: required for failing (0.1–100) and slow (1–600000), absent for silent;
    - `windowMinutes`: failing and slow 1–60, silent 5–2880;
    - `minCalls`: 1–100000, default 10;
    - `channelIds`: 0–10;
    - `enabled`: default true.
  - `AlertRuleView = { id, name, kind, target, threshold, windowMinutes, minCalls, channelIds, enabled, state: 'ok' | 'firing' | 'waiting', activeSince: string | null, createdAt, updatedAt }`. `waiting` means a silent rule with `armedAt` null.
  - `AlertEventView = { id: string; ruleId; ruleName; kind; target; startedAt; resolvedAt: string | null; value: number | null; deliveries: DeliveryRecord[] }`, with `DeliveryRecord = { at: string; state: 'firing' | 'reminder' | 'resolved'; channelId: string; channelName: string | null; ok: boolean; status: number | null; error: string | null; attempts: number }`.
  - **Routes:**
    - `GET /api/projects/:id/alert-rules` needs `project:read`.
    - `POST /api/projects/:id/alert-rules` needs `alertRule:create`. It answers 201 with the view; 409 `'This project already has 100 alert rules'`; 400 when a channel id isn't a channel credential of this project.
    - `PATCH /api/alert-rules/:id` needs `alertRule:update` and takes the same schema, partial.
    - `DELETE /api/alert-rules/:id` needs `alertRule:delete` and answers 204.
    - Disabling (`enabled: false`) or deleting closes the open event (`resolvedAt = now`) with no message.
    - `GET /api/projects/:id/alerts?state=active|resolved&before=<eventId>&limit=<1-50, default 20>` needs `project:read`. Active events come newest first, and resolved ones are paged by `before`.

- [ ] **Step 1: Write the failing tests**
  - `roles.test.ts`:
    - the editor and the personal owner have all three `alertRule:*` scopes;
    - the viewer's sorted scopes are unchanged: `['credential:read', 'ingestKey:read', 'landscape:read', 'project:read']`.
  - `rules.test.ts`:
    - **Create:** an editor creates a failing arrow rule (`from: 'service:web'`, `to: 'host:*.magicline.com'`, threshold 2, window 5) and gets 201 with `state: 'ok'`. A silent rule comes back `waiting`.
    - **Validation:** 400 for each of these, naming the field:
      - a failing rule without a threshold;
      - a silent rule with `windowMinutes: 3000`;
      - the pattern `ftp:x`;
      - `host:a*b`;
      - a 101-character name;
      - 11 channels;
      - a channel id from another project;
      - a Beszel credential as a channel.
    - **Limit:** the 101st rule gets 409.
    - **Access:** a viewer lists rules and alerts (200) but gets 403 on create, update and delete. An outsider gets 404 everywhere; signed out gets 401.
    - **Disable:** disabling a rule with an open event (inserted directly) closes it and inserts no delivery.
    - **Alerts list:** `state=active` lists only open events. `state=resolved&limit=2` pages correctly with `before`.
- [ ] **Step 2: Run them.** Run `npx vitest run src/alerts src/rbac`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the tables, then run `npm run db:generate -- --name alerts`. Then the scopes, the target and the module.
- [ ] **Step 4: Run the backend gate.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): alert rules and alert history`

---

### Task 4: The evaluator: heartbeat, gaps, measuring and state

**Files:**
- Create:
  - `packages/fossflow-backend/src/alerts/measure.ts`
  - `src/alerts/evaluator.ts`
  - `src/alerts/heartbeat.ts`
- Modify: `src/alerts/alerts.module.ts`, `src/traffic/maintenance.ts` (prunes gaps older than 3 days)
- Test:
  - `src/alerts/measure.test.ts`
  - `src/alerts/evaluator.test.ts`

**Interfaces:**
- Consumes: the Task 3 tables, `matchesIdentity` and `AlertRuleView`; `percentileMs`; the `traffic_alias` rows (an alias is unambiguous in 24 h, as the summary defines it).
- Produces:
  - `Measurement = { status: 'met' | 'clear' | 'unknown'; value: number | null; calls: number | null; sinceMinutes: number | null }`. `unknown` covers too few calls and silent rules that aren't armed.
  - `measureProject(db, projectId: string, rules: RuleRow[], now: Date): Promise<Map<string, Measurement>>`:
    - **One window query:** `traffic_minute` rows grouped by `(kind, caller, callee, minute)` with `minute ≥ floorMinute(now) − 59 min`. Each failing or slow rule sums the minutes ≥ `floorMinute(now) − (N − 1) min` of its matching rows.
    - **Matching:** an arrow rule takes `call` rows where `matchesIdentity(from, caller)` and either `matchesIdentity(to, callee)` or `callee` is a host aliased to a service that `to` matches. A box rule takes `incoming` rows with `matchesIdentity(identity, callee)` for a `service:` identity, else `call` rows with `matchesIdentity(identity, callee)`.
    - **Silent:** one last-seen query. `max(minute) + 1 min` comes from `traffic_minute` for minutes ≥ `floorHour(now) − 1 h`, and `max(hour) + 1 h` from `traffic_hour` for older hours back to `now − 8 days`.
    - The silent clock starts at `silentSince = max(lastSeen, the latest end of a gap longer than 5 min that ended after lastSeen)`.
    - `value` is the failed %, the p95 in ms, or the minutes since `silentSince`.
    - A silent rule with `armedAt` null and no last-seen is `unknown`; finding a last-seen sets `armedAt`.
  - `AlertEvaluator` (`@Injectable`, `OnApplicationBootstrap` and `BeforeApplicationShutdown`):
    - `tick(now = new Date()): Promise<TickResult>`, where `TickResult = { started: string[]; reminded: string[]; resolved: string[] }` lists rule ids.
    - The timer runs every 60 s and is `unref`ed, with a re-entrancy guard like `TrafficMaintenance`.
    - It calls `deliveries.notify(eventId, state)` without awaiting it (Task 5 provides `Deliveries`; until then, inject a no-op provider under the `DELIVERIES` token).
  - **State machine, per enabled rule and tick:**
    - `met` with no open event → insert an event (`startedAt = lastNotifiedAt = now`, `value`) → `firing`.
    - `met` with an open event → set `value`, clear `clearSince`; if `now − lastNotifiedAt ≥ 4 h`, set `lastNotifiedAt = now` → `reminder`.
    - `clear` with an open event → set `clearSince = now` if it is null; once `now − clearSince ≥ 3 min`, set `resolvedAt = now` → `resolved`.
    - `unknown` → nothing changes.
  - `IngestHeartbeat`:
    - `recordStart(now: Date): Promise<void>`: if `meta['ingest.alive'].at` is more than 5 min old, insert a gap `{ from: thatAt, to: now }`.
    - `beat(now: Date): Promise<void>` upserts `meta['ingest.alive'] = { at }`.
    - The evaluator calls `recordStart` once on bootstrap and `beat` at the start of every tick.

- [ ] **Step 1: Write the failing tests** (rows inserted directly, with a fixed `now`)
  - `measure.test.ts`:
    - "failing over the window": 1,260 calls and 52 failures over 5 minutes give `met` with `value ≈ 4.13` for threshold 2; with `minCalls: 2000` the result is `unknown`.
    - "slow uses the merged histogram": p95 equals `percentileMs` of the summed rows.
    - "arrow rules follow aliases": `service:web → service:orders` counts `web → host:orders.internal` calls when `traffic_alias` maps `orders.internal` to `orders` (only that service in 24 h). It does not count them when a second service also claimed that host.
    - "box rules": a `service:billing` box counts `incoming` rows; a `host:*.magicline.com` box counts calls from every caller into `api.magicline.com`.
    - "silent": the last call at 09:13 with N = 30 and now = 09:44 gives `clear` (silent since 09:14, 30 min); now = 09:45 gives `met`.
    - "a long gap delays silent alerts": a call at 10:00, a gap 10:10–10:30 and N = 30. `clear` at 10:45; `met` at 11:00 (30 minutes after the gap); a 4-minute gap changes nothing.
    - "never carried traffic stays waiting": no rows, `armedAt` null → `unknown`. After one call row, the next measure sets `armedAt`.
  - `evaluator.test.ts`:
    - "start, reminder, resolve": a failing rule met at t0 starts once; at t0 + 1 min nothing new; at t0 + 4 h one reminder; it clears at t1, stays firing at t1 + 2 min, and resolves at t1 + 3 min.
    - "flapping sends one start": minutes alternating 5.1 % / 4.9 % against threshold 5 over 10 ticks give exactly one start and no resolve.
    - "a deleted rule stops": a rule deleted between ticks is simply gone; there is no error.
    - "restart writes a gap": `meta['ingest.alive']` 20 min old at bootstrap inserts one gap, and a 2-minute-old heartbeat inserts none.
- [ ] **Step 2: Run them.** Run `npx vitest run src/alerts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the backend gate.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(server): evaluate alert rules every minute`

---

### Task 5: Deliveries and firing alerts in the summary

**Files:**
- Create: `packages/fossflow-backend/src/alerts/deliveries.ts`
- Modify:
  - `src/alerts/alerts.module.ts`
  - `src/traffic/wire.ts`, `traffic-queries.ts` (summary `alerts`)
- Test:
  - new `src/alerts/deliveries.test.ts`
  - `src/traffic/traffic-queries.test.ts`
  - an end-to-end case in `src/alerts/evaluator.test.ts`

**Interfaces:**
- Consumes: Task 1 (`AlertMessage`, `alertLine`, channels), Task 2 (`CredentialsService.settingsFor` and `kind`), Task 4 (`AlertEvaluator` and the events).
- Produces:
  - `Deliveries` (under the `DELIVERIES` token):
    - `notify(eventId: string, state: 'firing' | 'reminder' | 'resolved'): Promise<void>` builds the `AlertMessage` from the rule, the event and the project. Its link is `${publicUrl}/projects/${projectId}/monitoring`.
    - It sends to every channel of the rule in parallel. Each send makes up to 3 attempts, waiting 2 s and then 8 s; on 429 with `Retry-After` up to 60 s it waits that long, and beyond that it gives up. 4xx other than 429 isn't retried.
    - It appends one `DeliveryRecord` per channel to `alertEvent.deliveries`, keeping the last 50.
    - A channel id that no longer exists, or isn't a channel, is recorded with `error: 'missing'`.
    - Sleep is injectable (`DELIVERY_SLEEP` token) for tests. Errors are logged by name only and never thrown to the evaluator.
  - **Summary:** `TrafficSummary` gains `alerts: TrafficAlert[]`, with `TrafficAlert = { ruleId: string; name: string; kind: 'failing' | 'slow' | 'silent'; target: AlertTarget; startedAt: string; value: number | null }`. These are the open events of the landscape's project, newest first. `wire.ts` keeps its "keep in sync" header.

- [ ] **Step 1: Write the failing tests**
  - `deliveries.test.ts`, with `postJson`, the mailer and sleep stubbed:
    - "start reaches every channel": a firing event with a Slack and a webhook channel posts the exact first line and link to both and records two `ok` deliveries.
    - "retries": 500, 500, 200 gives 3 attempts with sleeps `[2000, 8000]` and `ok`. A 404 makes 1 attempt. A 429 with `retry-after: 5` sleeps 5000 and retries; with `retry-after: 120` it gives up after 1 attempt.
    - "a missing channel is recorded and skipped": a deleted channel id gives `error: 'missing'`, and the other channel still gets the message.
    - "never the body": a stubbed response body text appears nowhere in the stored deliveries.
    - Only the last 50 deliveries are kept.
  - `traffic-queries.test.ts`: one open event and one resolved event of the project give `alerts` with just the open one; another project's events aren't included.
  - `evaluator.test.ts` end to end: rows that make a failing rule `met`, then `tick()`, then the awaited delivery promise gives one webhook post whose JSON has `state: 'firing'` and `rule.name`.
- [ ] **Step 2: Run them.** Run `npx vitest run src/alerts src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the backend gate and coverage.** Run `npm run lint`, `npm run test:coverage` and `npm run build`. Expected: PASS, with at least 80 % coverage of `src/alerts` and `src/connectors`.
- [ ] **Step 5: Commit.** `feat(server): deliver alert messages and show firing alerts on the map`

---

### Task 6: Lib: alert trouble and "Alert me when…"

**Files:**
- Modify:
  - `packages/fossflow-lib/src/traffic/types.ts`
  - `stats.ts`, `TrafficOverlay.tsx`, `TrafficLayer.tsx`
  - `ArrowCard.tsx`, `BoxCard.tsx`
  - `src/types/isoflowProps.ts` and all 12 `src/i18n/*.ts`
- Create: `src/traffic/alerts.ts`
- Test:
  - `src/traffic/__tests__/alerts.test.ts`
  - `TrafficOverlay.test.tsx`, `ArrowCard.test.tsx`, `BoxCard.test.tsx`

**Interfaces:**
- Consumes: `TrafficSummary.alerts` (mirrored); `TrafficIndex`, `boxOf`, `findArrow` and `ArrowTraffic` (milestone 2).
- Produces:
  - **Types:** `TrafficAlert`, `AlertTarget` and `TrafficSummary.alerts` in `types.ts`.
  - **`TrafficFeed` gains `requestAlert?: (request: AlertRequest) => void`**, where `AlertRequest = { type: 'arrow'; from: string[]; to: string[]; name: string } | { type: 'box'; identities: string[]; name: string }`. The app leaves it `undefined` for people who can't create rules, and then no button shows.
  - **In `alerts.ts`:**
    - `boxForPattern(index: TrafficIndex, pattern: string): string | null` returns the first box that binds the pattern verbatim (exact or wildcard string), else `boxOf(index, pattern)`.
    - `alertTrouble(alerts: TrafficAlert[], index: TrafficIndex, connectors: Connector[]): { arrows: Map<string, TrafficAlert>; boxes: Map<string, TrafficAlert> }`:
      - an arrow alert maps to `findArrow(connectors, boxForPattern(from), boxForPattern(to))`;
      - a box alert maps to `boxForPattern(identity)`;
      - when several alerts hit one arrow or box, failing and silent outrank slow, then the oldest `startedAt` wins.
  - **Rendering:**
    - The overlay stroke and the pill are red (`LIVE_TOKENS.critical*`) for `failing` or `silent` alerts and amber (`LIVE_TOKENS.warning*`) for `slow`.
    - Pill text:
      - slow: `{rate} · p95 {p95} · slow`;
      - silent: `silent for {since}`;
      - a failing alert reuses the milestone 2 pill.
    - Box line: `{name}: slow`, `{name}: silent for {since}` or `{name}: failing`.
    - The built-in failing rule (≥ 5 % and ≥ 5 failures) still applies without any rule.
  - **"Alert me when…"** shows in `ArrowCard` and `BoxCard` when `feed.requestAlert` exists:
    - for an arrow it sends `{ type: 'arrow', from: callerBox.ids, to: calleeBox.ids, name: 'Caller box → Callee box' }`, from the busiest pair's direction;
    - for a box it sends `{ type: 'box', identities: box.ids, name: box name }`.
  - **Locale keys** (en-US): `alertMe: 'Alert me when…'`, `pillSlow: 'slow'`, `silentFor: 'silent for {since}'`, `boxAlertSlow: '{name}: slow'`, `boxAlertSilent: '{name}: silent for {since}'`, `boxAlertFailing: '{name}: failing'`.

- [ ] **Step 1: Write the failing tests**
  - `alerts.test.ts`:
    - an arrow alert with `from: 'service:web'` and `to: 'host:*.magicline.com'` maps to the arrow between the box binding `service:web` and the box binding `host:*.magicline.com` (verbatim);
    - a box alert maps to its box;
    - failing outranks slow on the same arrow;
    - an alert whose boxes aren't on the map maps to nothing.
  - `TrafficOverlay.test.tsx`:
    - a slow alert on a healthy arrow draws an amber stroke (`data-trouble="slow"`) and the pill `… · slow`;
    - a silent alert on an arrow with no traffic in the window draws a red pill `silent for 2 h 5 min`;
    - without alerts nothing changes.
  - `ArrowCard.test.tsx` and `BoxCard.test.tsx`:
    - with `requestAlert` set, clicking `Alert me when…` calls it with the expected request;
    - without it there is no button.
- [ ] **Step 2: Run them.** Run `cd packages/fossflow-lib && npx jest src/traffic`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the locale keys in all 12 files.
- [ ] **Step 4: Run the lib gate.** Run `npm test`, `npm run lint` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(lib): firing alerts on the map and "Alert me when…"`

---

### Task 7: App: channel credentials and sources

**Files:**
- Modify:
  - `packages/fossflow-app/src/platform/credentials.ts`
  - `components/ProjectCredentials.tsx`, `components/LiveSources.tsx`, `components/CredentialForm.tsx`
  - both en-US JSON files

**Interfaces:**
- Consumes: `ConnectorInfo.kind` and `CredentialSummary.kind` (Task 2).
- Produces:
  - `ConnectorInfo` and `CredentialSummary` types gain `kind: 'source' | 'channel'`.
  - `ProjectCredentials` shows two groups under `section-head` titles: `platform.credentials.sources` = `Data sources` and `platform.credentials.channels` = `Alert channels`. Each group has its own "Add …" select of that kind's connectors.
  - `LiveSources` lists only `kind === 'source'` credentials.
  - `CredentialForm`:
    - renders `field.help` for the email `to` field as a hint: `platform.credentials.emailHint` = `Separate addresses with commas`;
    - shows the save result for channels with the server's message as it already does ("Test message sent").

- [ ] **Step 1: Implement.** The app has no test runner.
- [ ] **Step 2: Check types and build.** Run `npm run build` in the lib first. In the app, `npx tsc --noEmit` shows exactly the 7 known errors, `npm run build` passes, and `cmp` of the two en-US files prints nothing.
- [ ] **Step 3: Commit.** `feat(app): alert channels next to data sources`

---

### Task 8: App: Monitoring → Alerts and the rule form

**Files:**
- Create:
  - `packages/fossflow-app/src/platform/alerts.ts`
  - `components/ProjectAlerts.tsx`, `components/AlertRuleForm.tsx`, `components/AlertEventRow.tsx`
  - `pages/AlertRulePage.tsx`
- Modify:
  - `components/ProjectMonitoring.tsx` (renders `ProjectAlerts` below Services)
  - `pages/ProjectPage.tsx` (routes)
  - `src/platform/traffic.ts` and `pages/LandscapeEditor.tsx` (`requestAlert`)
  - `platform.css` if needed
  - both en-US JSON files

**Interfaces:**
- Consumes: the Task 3 routes and views; `TrafficSummary.alerts` and `AlertRequest` (Tasks 5 and 6).
- Produces:
  - **`alerts.ts`:**
    - the types `AlertRuleView`, `AlertEventView`, `DeliveryRecord`, `AlertRuleInput`;
    - `alertRulesKey(projectId)` and `useAlertRules(projectId)`, refetching every 30 s;
    - `useActiveAlerts(projectId)`, refetching every 30 s;
    - `useAlertHistory(projectId)`, a `useInfiniteQuery` on `state=resolved` with the `before` cursor and limit 20;
    - `saveAlertRule(projectId, input, id?)` and `deleteAlertRule(id)`.
  - **Routes** under the project:
    - `monitoring/alerts/new`, which reads the prefill from `?type=arrow&from=…&from=…&to=…&name=…` or `?type=box&identity=…&name=…`;
    - `monitoring/alerts/:ruleId`, to edit;
    - both are guarded by `can(project, 'alertRule:create')` or `alertRule:update`.
  - **`ProjectAlerts`**, an **Alerts** section:
    - **Active alerts** first: name, kind, "since", value, and delivery problems as a `note--warning` line, e.g. `Slack: not delivered (404)`.
    - **Rules:** name, kind, target, state `OK`, `Firing` or `Waiting for first call`, an enabled switch, Edit, and Delete with the inline confirmation. Create, edit and delete controls show by scope.
    - **History**, paged with "Show more".
    - An empty state when there are no rules.
  - **`AlertRuleForm`:**
    - fields: name; kind (radio: failing, slow, silent); target (arrow: two selects when prefilled, else two text fields; box: a select or text); threshold, with the unit by kind; window in minutes; minimum calls (hidden for silent); channels (checkboxes of the project's channel credentials, with a link to Credentials when there are none); enabled;
    - client-side checks mirror the server's ranges;
    - server errors show in `FormError`;
    - after saving it returns to the route it came from (`location.state.returnTo`), else Monitoring.
  - **`LandscapeEditor`** passes `requestAlert` (only with `alertRule:create`), which navigates to `/projects/:projectId/monitoring/alerts/new?…` with `state: { returnTo: <landscape path> }`.
  - **Strings** under `platform.alerts.*`, in en-US. The kind labels are `Failing`, `Slow` and `Silent`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Check types and build** as in Task 7.
- [ ] **Step 3: Commit.** `feat(app): alerts in Monitoring and the alert rule form`

---

### Task 9: Real walkthrough, Docker check and wrap-up

**Files:**
- Modify: `docs/AUDIT.md` (the milestone 3 entry)
- Scratch only: everything else.

- [ ] **Step 1: Stack.**
  - Throwaway Postgres on 54399, the backend on 3011 from a scratch working directory with SMTP pointed at a Mailpit container, and the app on 3010.
  - Reuse milestone 2's fake API and instrumented sample.
  - A local HTTPS webhook receiver with a self-signed certificate; start the backend with `NODE_EXTRA_CA_CERTS` pointing at it.
  - Pulling `axllent/mailpit` is the one new image.
- [ ] **Step 2: Browser walkthrough, as editor.**
  1. Add a webhook channel and an email channel; both test messages arrive.
  2. A Slack channel with a non-Slack URL is refused.
  3. Open the arrow card and use **Alert me when…**. The form is prefilled; create a failing rule (2 %, 5 min) on both channels and return to the map.
  4. Make the fake API fail. Within about two minutes, the start message arrives on both channels with the exact copy, and the arrow is red with the alert.
  5. Heal the API. About 3 minutes after the window clears, the resolve message arrives.
  6. Create a slow rule with a low threshold: the arrow turns amber.
  7. Create a silent rule of 5 minutes and stop the sample: it fires after about 5 minutes.
  8. Restart the backend while the sample is stopped, with a 6-minute gap: no new silent message arrives before 5 minutes after the restart.
  9. Delivery problems show in Monitoring → Alerts: point a webhook at a closed port.
  10. Check the history paging.
- [ ] **Step 3: Viewer.** The viewer sees rules, active alerts and history, has no create, edit or delete controls, sees no "Alert me when…", and the routes for the form redirect.
- [ ] **Step 4: Nothing regressed.** Beszel credentials still work, the sources picker lists sources only, and local mode makes no alert requests.
- [ ] **Step 5: Docker.** Start the real `compose.yml` in a throwaway project and check that a webhook alert arrives from inside the container.
- [ ] **Step 6: Wrap up.**
  - Run `/verify` and the final whole-branch review, which doubles as the security review. Focus on SSRF rules, scopes, message content and resource bounds.
  - Add the `docs/AUDIT.md` entry: what changed, my calls, accepted risks (the webhook may reach internal addresses; Slack and Teams are verified by fixtures only unless you provide URLs), and later work.
  - Commit and push, then update the draft PR #7 body (M3 ✅).
  - Remove every container, server and scratch secret.
