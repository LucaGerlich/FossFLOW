# Live traffic and alerts

Live traffic shows the real calls between your services on the map: one dot per call, with numbers for failures and speed. Alerts tell you by email, Slack, Teams or webhook when a connection fails, slows down or goes quiet.

Live traffic needs [platform mode](PLATFORM.md), the Docker setup with Postgres and sign-in. See that guide for installing FossFLOW.

## What FossFLOW records

Your services send OpenTelemetry traces to FossFLOW. FossFLOW keeps a small, scrubbed summary of them.

- **Calls on arrows.** A CLIENT span (a service calling out) becomes a call on an arrow.
- **Incoming numbers on boxes.** A SERVER span (a service answering) becomes the incoming numbers of a box.
- **Stored:**
  - counts and a duration histogram;
  - the templated operation, such as `GET /members/{id}`;
  - for failures only, the HTTP status or `error.type`.
- **Never stored:**
  - query strings, fragments and user info in URLs;
  - IDs in paths: they become `{id}`;
  - SQL text;
  - exception messages;
  - every other span attribute.
- **Ignored:** INTERNAL, PRODUCER and CONSUMER spans, metrics, logs, and browsers.

## Try it with the demo

The repository ships a small shop that really calls an outside API and a database, and exports its traces to your FossFLOW. It is in [`examples/live-traffic`](../examples/live-traffic/compose.yml). You need Docker and a running FossFLOW in platform mode.

1. **Create a key.** Open the project, go to **Monitoring**, choose **Connect a service**, name the service `demo` and click **Create key**. Copy the key: it is shown once.
2. **Start the demo.** Every compose command needs the key, so export it once in your shell:

   ```bash
   export FOSSFLOW_INGEST_KEY=ffi_REPLACE_ME
   docker compose -f examples/live-traffic/compose.yml up -d --build
   ```

   The demo sends to a FossFLOW on this machine's port 80 (`http://host.docker.internal/api/otlp`). When FossFLOW runs elsewhere, set `FOSSFLOW_OTLP_ENDPOINT` too, for example `http://host.docker.internal:8080/api/otlp` or `https://fossflow.example.com/api/otlp`.
3. **Put it on the map.** In a landscape, open the tray **Seen, not on the map**. Use **Place** for the four identities below, then **Draw arrow** for each call.

   | Identity | What it is |
   |---|---|
   | `service:demo-web` | the Next.js app |
   | `service:demo-shop` | the Node.js service |
   | `host:members-api` | a fake outside API, not instrumented |
   | `db:demo-db/demo` | the Postgres database |

   The calls are `demo-web` → `demo-shop` → `members-api`, `demo-shop` → `demo-db` and `demo-web` → `demo-db`. The `load` caller is not instrumented, so it shows only as the incoming requests of `demo-web`.
4. **Watch.** Dots run along the arrows. The load generator pauses for 15 seconds after every 40 requests, so you see quiet periods. Open an arrow to see its numbers. The shop asks for `/members/<id>?email=member<id>@example.com`, and FossFLOW stores `GET /members/{id}`: the query and the id are gone.
5. **Break something.** Switch the outside API into a bad mood and watch the arrow:

   ```bash
   curl -X POST http://localhost:4010/admin/mode/failing
   curl -X POST http://localhost:4010/admin/mode/slow
   curl -X POST http://localhost:4010/admin/mode/ok
   ```

   `failing` makes 60 % of the member calls answer 503. `slow` adds 1.2 to 2 seconds. `ok` is back to normal.
6. **Get alerted.** Click an arrow and choose **Alert me when…** to create a rule. See [Alerts](#alerts).
7. **Stop it.** In the same shell:

   ```bash
   docker compose -f examples/live-traffic/compose.yml down -v
   ```

## Connect a service

### Create a key

In the project, open **Monitoring** and choose **Connect a service**. Enter a service name such as `member-app` and click **Create key**.

- The key is **shown once**. Copy it now.
- One key may serve several services. **Seen as** lists the service names that used it.
- **Revoke** stops every service using that key. Traffic already received stays.

FossFLOW fills the setup blocks below with your key and endpoint.

### The endpoint

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your FossFLOW address plus `/api/otlp`, and send the key in the header `x-fossflow-key`. Do not add `/v1/traces`: the SDK appends it itself.

Node.js needs 22.15 or newer for these instrumentations. The setups below use these placeholders: the URL `https://fossflow.example.com`, the key `ffi_REPLACE_ME` and the service name `member-app`.

### Node.js (CommonJS)

Install:

```bash
npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node
```

Environment variables:

```bash
OTEL_SERVICE_NAME=member-app
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://fossflow.example.com/api/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=ffi_REPLACE_ME
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_TRACES_SAMPLER=always_on
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"
```

### Node.js (ES modules)

Install:

```bash
npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/instrumentation
```

Environment variables:

```bash
OTEL_SERVICE_NAME=member-app
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://fossflow.example.com/api/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=ffi_REPLACE_ME
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_TRACES_SAMPLER=always_on
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register"
```

### Next.js

Install:

```bash
npm i @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

File `instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation.node');
}
```

File `instrumentation.node.ts`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();
```

Environment variables:

```bash
OTEL_SERVICE_NAME=member-app
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://fossflow.example.com/api/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=ffi_REPLACE_ME
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_TRACES_SAMPLER=always_on
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
NEXT_OTEL_FETCH_DISABLED=1
```

- **Node.js runtime only.** Only the Node.js runtime is instrumented. Edge routes and middleware are not.
- **Why `NEXT_OTEL_FETCH_DISABLED=1`.** Next.js adds its own span for every `fetch`, and the Node.js instrumentation records the same call again. Turning Next's off keeps one call per request.
- **No `@vercel/otel`.** This setup uses the Node SDK directly, not `@vercel/otel`.

### In Docker

Put the same lines in `environment:` and make the endpoint reachable from inside the container. A FossFLOW on the Docker host is `host.docker.internal`, which Docker Engine on Linux only resolves with `host-gateway`:

```yaml
services:
  member-app:
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      OTEL_SERVICE_NAME: member-app
      OTEL_TRACES_EXPORTER: otlp
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_EXPORTER_OTLP_ENDPOINT: http://host.docker.internal/api/otlp
      OTEL_EXPORTER_OTLP_HEADERS: x-fossflow-key=ffi_REPLACE_ME
      OTEL_BSP_SCHEDULE_DELAY: '1000'
      OTEL_TRACES_SAMPLER: always_on
      OTEL_METRICS_EXPORTER: none
      OTEL_LOGS_EXPORTER: none
```

The demo's [`compose.yml`](../examples/live-traffic/compose.yml) is a working example. When FossFLOW is on another host, use its public address instead.

### Other languages

FossFLOW accepts standard OTLP over HTTP with protobuf, so any OpenTelemetry SDK works with the same environment variables. These are **not tested by us**:

- [Python](https://opentelemetry.io/docs/zero-code/python/)
- [.NET](https://opentelemetry.io/docs/zero-code/dotnet/)
- [Java agent](https://opentelemetry.io/docs/zero-code/java/agent/)
- [PHP](https://opentelemetry.io/docs/zero-code/php/)
- [OTLP exporter settings for every SDK](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)

### Through an OpenTelemetry Collector

Add an [`otlphttp` exporter](https://github.com/open-telemetry/opentelemetry-collector/tree/main/exporter/otlphttpexporter) and put it in a traces pipeline:

```yaml
exporters:
  otlphttp/fossflow:
    endpoint: https://fossflow.example.com/api/otlp
    headers:
      x-fossflow-key: ffi_REPLACE_ME

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/fossflow]
```

The exporter appends `/v1/traces` itself, so the endpoint stays as shown.

### Sampling

Keep `OTEL_TRACES_SAMPLER=always_on`. The numbers count the spans FossFLOW receives, so head or tail sampling in an SDK or a Collector makes them lower than reality.

## Put traffic on the map

FossFLOW matches traffic to boxes by **identity**. A box shows the traffic of every identity in its settings.

| Identity | Meaning | Example |
|---|---|---|
| `service:<name>` | an instrumented service, from its `OTEL_SERVICE_NAME` | `service:demo-shop` |
| `host:<host>` | an outside host the service calls | `host:members-api` |
| `db:<host>/<database>` | a database (`db:<host>` when the name is unknown) | `db:demo-db/demo` |

A leading `*.` is the only wildcard, for example `host:*.example.com`. An identity is up to about 300 characters, and a box holds at most 20.

- **Box settings.** Select a box and open the section **Live traffic**. Use **Add an identity** to list the identities that belong to this box.
- **Seen, not on the map.** The tray lists traffic whose identity no box has yet. **Place** puts an identity on the map as a new box. **Draw arrow** connects two boxes for a call that has no arrow yet.
- **Host aliases.** When a service calls a host that clearly is another service of yours, FossFLOW links them automatically. A host shared by several services becomes a suggestion in the tray instead.
- **Direction comes from the data.** An arrow shows calls from the caller to the callee. When several arrows join the same two boxes, the first one gets the dots.
- **Cards.** An arrow shows its numbers **As seen by** the caller. A box shows **Incoming** requests and, for the calls it makes, **Seen by callers**.
- **A few seconds behind.** Dots run a few seconds behind real time, and a hidden browser tab drops them instead of queueing them up.
- **Many calls.** Each arrow shows at most 20 dots a second and a project at most 400. Beyond that one dot stands for several calls, shown as **1 dot ≈ N calls**.
- **Colours.**
  - An arrow turns red on its own when at least 5 % of its calls failed **and** at least 5 calls failed in the last 5 minutes.
  - An alert rule colours the target too: red for a failing or silent alert, amber for a slow one.
  - **Slow** shows only when a slow rule exists. Without one, FossFLOW has no definition of slow.

## Alerts

### Channels

Add channels under **Credentials** in the project. Each rule picks the channels it sends to.

- **Email.** Needs SMTP to be set up on your FossFLOW server.
- **Slack.** An [incoming webhook](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks), with a URL on `hooks.slack.com/services/…`.
- **Teams.** A Workflows webhook, with a URL on `*.api.powerplatform.com`. Follow [Create incoming webhooks with Workflows](https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498). The old `logic.azure.com` connector URLs stopped working on 30 November 2025, and FossFLOW rejects them.
- **Webhook.** Any HTTPS URL, including one on your own network. Link-local addresses are never allowed, and redirects are not followed. The URL must not contain a username or password.

Use **Save and test** on a channel to send a test message.

### Rules

Create a rule from a landscape with **Alert me when…** on an arrow or a box, or under **Monitoring**, **Alerts**, **New alert rule**.

| Kind | Fires when | Threshold | Window |
|---|---|---|---|
| Failing | the share of failed calls reaches the threshold | 0.1 to 100 % | 1 to 60 minutes |
| Slow | the p95 duration reaches the threshold | 1 to 600000 ms | 1 to 60 minutes |
| Silent | no call arrives for the whole window | none | 5 to 2880 minutes |

- **Target.** An arrow (calls from one place to another) or a box (all calls into it).
- **Minimum calls.** Windows with fewer calls than this are ignored. The default is 10, and it can be 1 to 100000.
- **Channels.** Up to 10 per rule. Up to 100 rules per project. The name is 1 to 100 characters.

### When messages are sent

FossFLOW checks every rule once a minute.

- **Start.** One message when the alert begins.
- **Reminder.** Another every 4 hours while it lasts.
- **Resolved.** One message after 3 clear minutes in a row.
- **Too few calls changes nothing.** A window below the minimum neither starts nor resolves an alert.
- **A silent rule waits for its first call.** It shows **Waiting for first call** until something arrives.
- **After downtime.** Only a downtime of more than 5 minutes counts. Then a silent rule counts from the restart, so it does not fire the moment FossFLOW is back.
- **Disabling** a rule closes its alert quietly, with no message.
- **Deleting** a rule deletes its alert history.
- **History.** Resolved alerts are kept for 90 days.

### Messages

Every message starts with one line. The detail depends on the kind:

```
Failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)
Still slow · Member app → MagicLine · p95 1.2 s over 880 calls in the last 5 min (threshold 1 s)
Resolved · Member app → MagicLine · failing for 35 min
```

The first line of a reminder starts with **Still failing**, **Still slow** or **Still silent**. A test message reads `Test · <project> · FossFLOW alerts will arrive here`. After the line comes the link to **Monitoring**.

A message never names an operation, a status or a caller, only the rule, the target and the numbers.

### Delivery

- **Three attempts.** FossFLOW waits 2 seconds after the first failure and 8 seconds after the second.
- **`Retry-After`** is honoured up to 60 seconds. Other 4xx answers are not retried.
- **10 seconds** is the timeout for each attempt.
- **Failures are visible.** A message that could not be sent shows as `<channel>: not delivered (<reason>)` on the alert in **Monitoring**. The last 50 results are kept.

### Webhook JSON

A webhook channel posts this JSON:

| Field | Meaning |
|---|---|
| `rule` | the rule that fired |
| `id` (in `rule`) | the rule id |
| `name` (in `rule`) | the rule name |
| `kind` (in `rule`) | `failing`, `slow` or `silent` |
| `state` | `firing`, `reminder`, `resolved` or `test` |
| `target` | `{ "type": "arrow", "from": "…", "to": "…" }` or `{ "type": "box", "identity": "…" }` |
| `value` | the measured value |
| `threshold` | the rule's threshold |
| `windowMinutes` | the window in minutes |
| `startedAt` | when the alert began, as an ISO time |
| `url` | the link to **Monitoring** |

The units depend on the kind:

| Kind | `value` | `threshold` |
|---|---|---|
| `failing` | percent of calls that failed | percent |
| `slow` | p95 in milliseconds | milliseconds |
| `silent` | minutes since the last call | the window in minutes |

On a `resolved` message, `value` is the last value measured while the alert was firing, and `threshold` and the units are as for the kind. On a `test` message, `value` is `null`.

A firing alert:

```json
{
  "rule": { "id": "r1", "name": "Member app → MagicLine", "kind": "failing" },
  "state": "firing",
  "target": { "type": "arrow", "from": "service:Member app", "to": "service:MagicLine" },
  "value": 4.1,
  "threshold": 2,
  "windowMinutes": 5,
  "startedAt": "2026-11-13T10:00:00.000Z",
  "url": "https://fossflow.example.com/projects/p/monitoring"
}
```

A `test` message, from **Save and test**, has no kind, rule id or target. Its rule name is the project name:

```json
{
  "rule": { "id": null, "name": "Team A", "kind": null },
  "state": "test",
  "target": null,
  "value": null,
  "threshold": null,
  "windowMinutes": null,
  "startedAt": null,
  "url": "https://fossflow.example.com/projects/p/monitoring"
}
```

- **Not signed.** The body carries no signature, so treat the URL as a secret.
- **Answer 2xx within 10 seconds.** Anything else counts as a failed attempt.

## Retention and limits

| What | Limit |
|---|---|
| Per-minute numbers | kept 7 days (2 to 90) |
| Per-hour numbers | kept 90 days (1 to 3650) |
| Recent failures | kept 7 days (1 to 90), at most 500 per arrow |
| Resolved alerts | kept 90 days |
| OTLP request body | 16 MiB |
| Requests per key | 1200 per minute, then 429 with `Retry-After` |
| Age of a span | spans older than 1 hour are dropped |
| Keys per project | 50 |
| Operations per arrow | 200, the rest are counted as `other` |
| Identities | up to about 300 characters; 20 per box |
| Live streams | 10 per user, with a heartbeat every 25 seconds |
| Alert rules | 100 per project, 10 channels per rule |

Change the retention with `TRAFFIC_MINUTES_DAYS`, `TRAFFIC_HOURS_DAYS` and `TRAFFIC_FAILURES_DAYS` in the backend environment.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **No data on the key** ("no data received yet") | The endpoint is wrong. Setting it to `…/api/otlp/v1/traces` makes the SDK append `/v1/traces` again, and every export answers 404. | Use `https://fossflow.example.com/api/otlp`, without `/v1/traces`. |
| No data on the key | The service cannot reach FossFLOW, for example `localhost` inside a container. | Use an address the service can reach. In Docker, see [In Docker](#in-docker). |
| No data on the key | The key was revoked: exports answer 401. | Create a new key and update the header. |
| No data on the key | Exports answer 413: a proxy in front of FossFLOW limits the body. | Allow 16 MiB on `/api/otlp/`. |
| No data on the key | Exports answer 429: the key sent more than 1200 requests in a minute. | Wait for `Retry-After`, or give busy services their own key. |
| Data, but **no dots** | No box has the identity yet. | Open the tray **Seen, not on the map** and use **Place** and **Draw arrow**. |
| Data, but no dots | The browser tab is hidden: dots are dropped while it is. | Bring the tab to the front. |
| Data, but no dots | A proxy buffers the live stream. | Don't buffer `/api/landscapes/*/traffic/stream`. FossFLOW sends `X-Accel-Buffering: no`; honour it or turn proxy buffering off. |
| Calls on Next.js arrows are doubled | Next.js records its own `fetch` spans too. | Set `NEXT_OTEL_FETCH_DISABLED=1`. |
| 404s for metrics or logs in the service log | The SDK also exports metrics and logs, and FossFLOW takes traces only. | Set `OTEL_METRICS_EXPORTER=none` and `OTEL_LOGS_EXPORTER=none`. |
| Node.js ES modules: the loader is not found | `@opentelemetry/instrumentation` is not installed directly. | Install it next to the other packages, as in [Node.js (ES modules)](#nodejs-es-modules). |
| The instrumentation does not start | Node.js is older than 22.15. | Use Node.js 22.15 or newer. |
| An arrow does not light up | The identities do not match: the arrow's boxes need the identities as FossFLOW sees them. | Compare the identity in the tray with the box's **Live traffic** settings. |
| An arrow does not light up | The host is shared by several services, so FossFLOW did not link it automatically. | Add the identity to the box yourself, or accept the suggestion in the tray. |
| Numbers are lower than reality | Sampling in an SDK or a Collector drops spans. | Keep `OTEL_TRACES_SAMPLER=always_on` and remove tail sampling for FossFLOW. |
| **Slow** never shows | Slow exists only through a slow rule. | Create one with **Alert me when…**. |
| Spans are missing | The service's clock is off by more than 1 hour, and FossFLOW drops spans older than that. | Fix the clock. |
| A silent alert fires after downtime | After more than 5 minutes of downtime a silent rule counts from the restart. | Wait one window. This is expected. |

**Behind your own TLS proxy** (Caddy, Traefik, nginx):

- Don't buffer `/api/landscapes/*/traffic/stream`. Honour `X-Accel-Buffering: no`, or turn proxy buffering off. A buffered stream means no dots.
- Allow 16 MiB bodies on `/api/otlp/`. A lower limit answers 413.
- No Basic Auth on `/api/otlp/`. Services authenticate with the `x-fossflow-key` header, and Basic Auth answers 401.
