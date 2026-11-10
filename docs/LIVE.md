# Live landscape (optional)

FossFLOW works as a plain diagramming tool with no backend at all. If your team already runs [Beszel](https://github.com/henrygd/beszel), a landscape can also show **every server, the Docker containers running on it, and the server's vitals**, live, with nothing new installed on your servers.

Live data needs [platform mode](PLATFORM.md): the Docker setup with Postgres and sign-in. It isn't available in local mode.

- **Automatic discovery.** New servers appear on their own plate, with their containers on it. New containers take the next free slot. Nothing you arrange by hand is ever moved or deleted, and your notes and connections stay attached across redeploys.
- **Colour only for trouble.**
  - Healthy items show a small green light and their CPU and memory use.
  - Warnings turn amber: a container health check starting, or a server vital at 80 % or more.
  - Failures turn red and pulse: an unhealthy container, a server that is down, or a vital at 90 % or more.
  - Stopped containers stay on the map as dimmed "ghosts", so you can see that something is missing.
- **Server vitals.** Select a server to see CPU, memory and disk with recent history, plus network, load, uptime and temperature. Degraded servers show this card automatically.
- **Read-only.** FossFLOW only reads from Beszel and never changes anything.
- **Hide what you don't need.** Delete a container node to hide it, for example a sidecar. It stays hidden even while it keeps running. To bring hidden containers back, delete the server's plate: the next sync places everything that isn't on the map onto a fresh plate.
- **Honest when blind.** If FossFLOW can't reach Beszel for three poll intervals, every live item turns grey ("unknown"). The last numbers stay readable, but nothing pretends to be healthy.

## How it works

```
Beszel hub ──(read-only user)──▶ FossFLOW server ──▶ FossFLOW app
```

The server logs in to Beszel with the credential you saved, polls it every 30 seconds (`LIVE_POLL_SECONDS`), and gives the app a normalised snapshot. It polls each credential that at least one landscape uses, once, however many landscapes show it. The Beszel login never reaches the browser.

## Setup

### 1. Create a read-only Beszel user

In your Beszel hub, open the admin panel at `https://<your-beszel>/_/` and add a record to the **users** collection:

- **email** and **password**: for example `fossflow@example.com` and a long random password.
- **role**: `readonly`.
- **verified**: on. Beszel only lets verified users log in.

Then give that user access to the servers you want on the map, in one of two ways:

- add the user to each server's **users** field, or
- start the Beszel hub with `SHARE_ALL_SYSTEMS=true`, which lets every logged-in user read every server.

### 2. Add a Beszel credential

1. Open the project that your landscapes live in, and go to its **Credentials** tab. You need to be an Admin or Editor of the project.
2. Add a Beszel credential and give it a name.
3. Fill in the hub URL (for example `https://beszel.example.com`), the read-only user's email and its password.
4. Click **Save and test**. FossFLOW saves the credential, then reads from the hub. On success it reports how many servers are visible.

The password is encrypted and never shown again. When you edit the credential later, leave the password empty to keep it. If you change the URL or the email, you must type the password again.

### 3. Turn it on in a landscape

1. Open the landscape.
2. In the editor bar, open the **Live data** menu and tick the credential. You need edit rights on the landscape.
3. The live badge shows **Connecting…**, then **Live** with the number of sources. Your servers appear on the map.

Untick the credential to turn live data off for that landscape.

### 4. How nodes are bound

Discovered servers and containers are placed for you, and each one stores its live key in the landscape. The binding therefore survives moving things around and JSON export and import. You don't bind nodes by hand: there is no picker for that yet.

- A container node you delete stays deleted: discovery won't bring it back.
- If you move a landscape to another project, its live sources are detached, because credentials belong to a project. Tick the new project's credential again.

## Security

The live snapshot is an inventory of your infrastructure: server names, container names, images and load. Treat it like internal documentation.

- **Signed-in users only.** Live data is served only to people who can open the landscape.
- **Secrets stay on the server.** The credential's password is encrypted at rest and never sent to the browser. Viewers of a project see the credential's name only.
- **Least privilege.** Use a Beszel `readonly` user. It can't change anything, even if FossFLOW is compromised.
- **Outbound requests.** The server connects to whatever URL an editor saves in a credential. See [Security in PLATFORM.md](PLATFORM.md#security).

## Troubleshooting

| Symptom | Check |
|---|---|
| **Save and test** fails | Read the message. A login error means the URL, email or password is wrong, or the Beszel user isn't **verified**. "Unreachable" means the FossFLOW server can't reach the hub: the URL must work from inside the container, so `localhost` is the container itself, not your machine. |
| "0 servers visible" | The login works, but Beszel shares no servers with this user. Add the user to each server's **users** field in the admin panel, or start the hub with `SHARE_ALL_SYSTEMS=true` (step 1). |
| Servers appear, but no containers | The Beszel agent needs the Docker socket, and Beszel only reports **running** containers. |
| The badge stays on "Connecting…" | The first sync hasn't finished, or the hub is slow. Wait a few poll intervals, then run **Save and test** on the credential and check the server log (`docker compose logs fossflow`). |
| Badge shows "Live data unavailable" | Hover it for the reason, for example a failed login or an unreachable hub. |
| "Stored settings can’t be decrypted" | The encryption key changed since the credential was saved. Restore the old key (`FOSSFLOW_ENCRYPTION_KEY` or `./data/config/encryption-key`), or edit the credential and enter its secrets again. See [Backups and the encryption key](PLATFORM.md#backups-and-the-encryption-key). |
| No **Live data** menu | The menu needs the right to edit the landscape and to use credentials. Viewers don't see it. A project with no credentials shows a link to add one. |

## Development

You can try live data without a Beszel hub, using a fake one with demo data. Run it from the repository root:

```bash
npm run dev:fake-beszel
```

This is the same as running `node dist/live/testing/runFakeBeszel.js` in `packages/fossflow-backend` after a build. It prints `Fake Beszel on http://127.0.0.1:8090 (demo@example.com / demo-password). Ctrl+C to stop.` Server vitals drift every few seconds. Set `FAKE_BESZEL_PORT` to change the port.

Then run the platform as described in [For developers](PLATFORM.md#for-developers), and add a Beszel credential with that URL, email and password. The fake hub runs on your machine, so the server must be able to reach it. When the server runs on the host, `http://127.0.0.1:8090` works.

- **Where the code lives:**
  - Connectors are in `packages/fossflow-backend/src/connectors/`, and the Beszel client and polling are in `packages/fossflow-backend/src/live/`.
  - The map side is in `packages/fossflow-lib/src/live/`.
  - The wire contract is mirrored in both `types.ts` files.
- **Adding a source** (Portainer, Kubernetes, Prometheus, …): write a connector that produces the same system and container shapes. The map doesn't need to change. See [Adding a connector](PLATFORM.md#adding-a-connector).
