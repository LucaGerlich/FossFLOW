# Live landscape (optional)

FossFLOW works as a plain diagramming tool with no backend at all. If your team already runs [Beszel](https://github.com/henrygd/beszel), the map can also show **every server, the Docker containers running on it, and the server's vitals**, live, with nothing new installed on your servers.

- **Automatic discovery.** New servers appear on their own plate, with their containers on it. New containers take the next free slot. Nothing you arrange by hand is ever moved or deleted, and your notes and connections stay attached across redeploys.
- **Colour only for trouble.**
  - Healthy items show a small green light and their CPU and memory use.
  - Warnings turn amber: a container health check starting, or a server vital at 80 % or more.
  - Failures turn red and pulse: an unhealthy container, a server that is down, or a vital at 90 % or more.
  - Stopped containers stay on the map as dimmed "ghosts", so you can see that something is missing.
- **Server vitals.** Select a server to see CPU, memory and disk with recent history, plus network, load, uptime and temperature. Degraded servers show this card automatically.
- **Read-only.** The map only reads from Beszel and never changes anything.
- **Hide what you don't need.** Delete a container node to hide it, for example a sidecar. It stays hidden even while it keeps running. To bring hidden containers back, delete the server's plate: the next sync places everything that isn't on the map onto a fresh plate.
- **Honest when blind.** If FossFLOW can't reach Beszel for three poll intervals, every live item turns grey ("unknown"). The last numbers stay readable, but nothing pretends to be healthy.

## How it works

```
Beszel hub ──(read-only user)──▶ FossFLOW backend ──/api/live──▶ FossFLOW app
```

The backend logs in to Beszel with a read-only user, polls it every 30 s, and serves a normalised snapshot at `/api/live/snapshot`. Beszel's credentials never reach the browser.

## Setup

### 1. Create a read-only Beszel user

In your Beszel hub, open the admin panel at `https://<your-beszel>/_/` and add a record to the **users** collection:

- **email** and **password**: for example `fossflow@example.com` and a long random password.
- **role**: `readonly`.
- **verified**: on. Beszel only lets verified users log in.

Then give that user access to the servers you want on the map, in one of two ways:

- add the user to each server's **users** field, or
- start the Beszel hub with `SHARE_ALL_SYSTEMS=true`, which lets every logged-in user read every server.

### 2. Configure FossFLOW

Live data needs an image built from this repository:

```bash
docker build -t fossflow .
```

Then set these variables, in `.env` next to `compose.yml` or in your orchestrator:

| Variable | Required | Description |
|---|---|---|
| `BESZEL_URL` | yes | Hub URL, e.g. `https://beszel.example.com` (http or https; no credentials in the URL). |
| `BESZEL_EMAIL` | yes | The read-only user's email. |
| `BESZEL_PASSWORD` | one of these two | Its password. |
| `BESZEL_PASSWORD_FILE` | one of these two | Or a file containing the password, e.g. a Docker secret at `/run/secrets/beszel_password`. |
| `LIVE_POLL_SECONDS` | no | How often to poll Beszel, 10–3600 seconds. Default 30. |
| `HTTP_AUTH_USER` / `HTTP_AUTH_PASSWORD` | yes (see below) | HTTP Basic Auth in front of the whole app, `/api/live` included. |
| `LIVE_ALLOW_UNAUTHENTICATED` | no | `true` only if something else already protects the app, such as an SSO proxy or a VPN. |

```bash
docker compose up -d
```

The backend logs one line about live data at startup, e.g. `Live data: ENABLED (Beszel at beszel.example.com, every 30s)`. In the app, a `● Live · Beszel` pill appears in the toolbar and your servers appear on the map.

## Security

The live snapshot is an inventory of your infrastructure: server names, container names, images and load. Treat it like internal documentation.

- **Auth is required.** The Docker image keeps live data **off** unless HTTP Basic Auth is configured, or you explicitly set `LIVE_ALLOW_UNAUTHENTICATED=true` because another layer protects the app.
- **Same-origin only.** `/api/live` sends no CORS headers, so other websites cannot read it from a visitor's browser.
- **Localhost only inside the image.** The backend listens on `127.0.0.1` in the image, so it is reachable only through nginx. Never publish port 3001 in production. `compose.dev.yml` does publish it, and it is for local development only.
- **Least privilege.** Use a Beszel `readonly` user. It can't change anything, even if FossFLOW is compromised.
- **Running `server.js` without Docker?** Put it behind your own authentication. The backend itself has no login.

## Troubleshooting

| Symptom | Check |
|---|---|
| No `Live` pill | `GET /api/live/status` should return `{"enabled": true, ...}`. If it returns `false`, check the backend's startup log for the reason; it never prints the password. |
| Pill reads "Live data unavailable" | Hover it for the error, e.g. `Beszel: Beszel login failed (HTTP 400)` (wrong credentials, or the user isn't verified) or `Beszel is unreachable (ECONNREFUSED)`. |
| Servers appear, but no containers | The agent needs the Docker socket, and Beszel only reports **running** containers. |
| Live data stays off in Docker | Configure `HTTP_AUTH_USER` and `HTTP_AUTH_PASSWORD`, or set `LIVE_ALLOW_UNAUTHENTICATED=true` on purpose. |

## Good to know

- **Bindings travel with the diagram.** Each discovered item stores its live key in the diagram, so JSON exports and server storage keep it. The *compact* export format has never included rectangles, so server plates are lost there; after re-importing a compact file, delete the server node and let discovery rebuild its plate.
- **Hairline icons are always available.** The hairline pack (server, container, database, cache, queue, gateway, clients, cloud) is part of the core icons, so you can use it for hand-drawn landscapes without any live data.
- **Running `server.js` directly** with live data on a non-loopback address prints a startup warning. Put it behind an authenticating proxy, or set `BACKEND_HOST=127.0.0.1`.

## Development

```bash
npm run dev:fake-beszel          # fake Beszel on :8090 with demo data
BESZEL_URL=http://127.0.0.1:8090 BESZEL_EMAIL=demo@example.com \
  BESZEL_PASSWORD=demo-password npm run dev:backend
npm run dev                      # app on :3000; /api/live is proxied to :3001
```

- **Where the code lives:**
  - The backend source adapter is in `packages/fossflow-backend/live/`.
  - The map side is in `packages/fossflow-lib/src/live/`.
  - The wire contract is mirrored in both `types.ts` files.
- **Adding a source** (Portainer, Kubernetes, Prometheus, …): write an adapter that produces the same `LiveSystem` and `LiveContainer` shapes. The map doesn't need to change.
