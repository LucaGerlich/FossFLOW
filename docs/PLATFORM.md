# Self-hosting FossFLOW (platform mode)

This guide covers running FossFLOW as a small multi-user platform: people sign in, landscapes are stored in Postgres, and teams share projects. If you only want the diagram editor, you don't need any of this. See [local mode](#what-platform-mode-is) below.

- [What platform mode is](#what-platform-mode-is)
- [Install with Docker Compose](#install-with-docker-compose)
- [Roles](#roles)
- [Projects and the personal space](#projects-and-the-personal-space)
- [Landscapes](#landscapes)
- [Credentials and live data](#credentials-and-live-data)
- [Settings](#settings)
- [Email](#email-optional)
- [Backups and the encryption key](#backups-and-the-encryption-key)
- [Upgrading from the file-based version](#upgrading-from-the-file-based-version)
- [Configuration reference](#configuration-reference)
- [Security](#security)
- [For developers](#for-developers)

## What platform mode is

FossFLOW runs in one of two modes. The app picks the mode itself by asking `/api/platform/status`.

| | Local mode | Platform mode |
|---|---|---|
| How it runs | The static build with no backend: GitHub Pages, or the Docker image started without `DATABASE_URL`. | Docker with Postgres (`compose.yml`). |
| Sign-in | None. | Everyone signs in. |
| Where diagrams live | In your browser's localStorage. They stay across sessions, but only in that browser. You can also export and import JSON files. | In Postgres, per project. |
| Teams and sharing | No. | Projects, roles and invitations. |
| Live data | No. | Yes. |

In this guide, a **landscape** is one diagram. A **project** is a shared space that holds landscapes and credentials.

## Install with Docker Compose

You need Docker with the Compose plugin.

1. Clone the repository.

   ```bash
   git clone https://github.com/LucaGerlich/FossFLOW.git
   cd FossFLOW
   ```

2. Create your settings file.

   ```bash
   cp .env.example .env
   ```

3. Set a database password. The password goes into a connection URL, so use letters and digits only.

   ```bash
   openssl rand -hex 24
   ```

   Paste the result as `POSTGRES_PASSWORD` in `.env`.

4. Set `FOSSFLOW_URL` in `.env` to the address people open in their browser, with no trailing slash, for example `https://flow.example.com`. Sign-in and every write only work from this address. See [Security](#security).

5. Build and start.

   ```bash
   docker compose up -d --build
   ```

6. Open that address. The first start shows a setup page. Create the **Owner** account there. Public sign-up is off; you add everyone else by invitation.

Compose publishes port 80 (change it with `PORT`). Only nginx is published. The API listens on `127.0.0.1` inside the container.

Your data lives in two places: the `db-data` Docker volume (Postgres) and `./data` next to `compose.yml` (the encryption key, and old diagrams to import once).

### What the container does

The server starts first. nginx starts only once the server answers `/api/health`. If the server stops, the container stops, and `restart: unless-stopped` brings it back. The server runs as user and group `1000` by default and owns `./data`. Set `PUID` and `PGID` to change that.

## Roles

There are two kinds of role. An **instance role** applies everywhere. A **project role** applies inside one project.

### Instance roles

| Role | What it can do |
|---|---|
| Owner | Everything an Admin can do, and manages every account, including Admins. There is exactly one. It is created at setup and can't be deleted. |
| Admin | Invite people, copy reset links, change roles, delete people, create team projects, and see and manage every project. Can manage Members only, not other Admins or the Owner. |
| Member | No instance-wide rights. Has a personal space, and works in the projects they were added to. |

Rules for changing roles:

- Only the Owner can make someone an Admin or take that role away.
- Nobody can grant Owner.
- Nobody can change their own role.

### Project roles

| Role | What it can do in the project |
|---|---|
| Admin | Everything: rename or delete the project, manage its members, create, edit, delete and move landscapes, manage credentials. |
| Editor | See the project; create, edit and delete landscapes; create, edit, delete and use credentials. Can't move landscapes, rename or delete the project, or change members. |
| Viewer | See the project and its landscapes. See credential names, nothing else. Can't edit, and can't use credentials. |

The owner of a personal space has the same rights as an Editor, plus moving landscapes out. A personal space can't be renamed, deleted or shared.

Instance Owners and Admins can see and manage every project without being a member.

## Projects and the personal space

Every person has a **personal space**: a private project that only they see. Use it for drafts.

Owners and Admins create **team projects** (Projects, then "New project") and add members to them with the project roles above. A project has its own landscapes, credentials and members. Use one project per infrastructure or team.

Deleting a project deletes everything in it. This can't be undone.

## Landscapes

- **Autosave.** The editor saves about 1.5 seconds after your last change. The editor bar shows Saving, Saved or Unsaved changes.
- **No silent overwrites.** If someone else saved the same landscape while you were editing, a banner names them and offers **Reload** (see their version) or **Overwrite with mine**.
- **Import and export.** "Import JSON" on the project page creates a landscape from a FossFLOW JSON diagram. "Export JSON" in the editor downloads one.
- **Move.** You can move a landscape to another project. Its live sources are detached when it moves, because credentials belong to a project.
- **Read only.** Viewers see a read-only editor.

## Credentials and live data

A **credential** is a login for a live source, such as a Beszel hub. Credentials belong to a project. Add them in the project's **Credentials** tab:

1. Choose the kind of source. The form comes from the connector.
2. Fill in the fields and click **Save and test**. FossFLOW saves it and then checks the connection.

Secrets are encrypted with AES-256-GCM and never sent back to the browser. When you edit a credential, leave a secret empty to keep it. If you change the URL or email, you must type the password again. Viewers see credential names only.

To show live data in a landscape, open it and use the **Live data** menu in the editor bar. It lists the project's credentials; tick the ones that feed this landscape. You need edit rights on the landscape and the right to use credentials. The server polls each credential that at least one landscape uses, every `LIVE_POLL_SECONDS` seconds (default 30).

Beszel is the first connector. Setup, the read-only user it needs, and troubleshooting are in [LIVE.md](LIVE.md). More connectors are planned: see [Adding a connector](#adding-a-connector).

## Settings

### Account (everyone)

- **Name.** Change your display name.
- **Password.** Enter your current password and a new one. A password needs at least 8 characters, with a number and a capital letter. Changing it signs out your other devices.
- **Email.** You sign in with it. It can't be changed yet.

### Users (Owner and Admin)

- **Invite.** Enter an email and a role. You get an invitation link, shown once. It works once and expires after 7 days. If SMTP is set up, the link is also emailed. Otherwise you copy it and send it yourself.
- **Pending invitations.** Revoke an invitation that is no longer wanted.
- **Reset link.** Creates a password-reset link for a person. It works once and expires after 1 hour.
- **Role.** Change a person's instance role, within the rules in [Roles](#instance-roles).
- **Delete.** Choose what happens to the person's personal landscapes and credentials: move them to someone else's personal space (you, by default), or delete them with the account. The Owner can't be deleted. If the person is the only admin of a team project, the deletion is refused until someone else is admin there.

## Email (optional)

Without email, nothing breaks: admins copy invitation and reset links by hand. To send them by email, set the `SMTP_*` variables in `.env`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=fossflow@example.com
SMTP_PASSWORD=<your smtp password>
SMTP_FROM=FossFLOW <fossflow@example.com>
```

`SMTP_FROM` is required when `SMTP_HOST` is set. Use `SMTP_SECURE=true` for implicit TLS (port 465) and `false` for STARTTLS (port 587). Then restart: `docker compose up -d`.

## Backups and the encryption key

Back up two things, together:

1. **The database.**

   ```bash
   docker compose exec db pg_dump -U fossflow fossflow > backup.sql
   ```

2. **The encryption key.** Either your `FOSSFLOW_ENCRYPTION_KEY` value, or, if you left it empty, the file `./data/config/encryption-key`.

Without the key, saved credentials can't be read. FossFLOW says so ("Stored settings can’t be decrypted") and doesn't produce garbage, but you would have to enter every credential again.

To use your own key, generate one and put it in `.env`:

```bash
openssl rand -base64 32
```

If `FOSSFLOW_ENCRYPTION_KEY` is empty, a key is generated once into `./data/config/encryption-key` on the first start. FossFLOW never replaces an existing key.

To restore, start a fresh database, load the dump into it, and start FossFLOW with the same key:

```bash
docker compose up -d db
docker compose exec -T db psql -U fossflow fossflow < backup.sql
docker compose up -d
```

Load the dump before the first start of the app against that database, so setup doesn't create a second Owner.

## Upgrading from the file-based version

Older FossFLOW saved diagrams as files (`ENABLE_SERVER_STORAGE`, `./diagrams`). To move to platform mode:

1. Stop the old container.
2. Move the folder: `mv ./diagrams ./data/diagrams`.
3. Follow [Install with Docker Compose](#install-with-docker-compose) and create the Owner on the setup page.

On the first start that finds `./data/diagrams`, and after the Owner exists, the old diagrams are imported once into the Owner's personal space.

If your `.env` had a `BESZEL_URL`, `BESZEL_EMAIL` and `BESZEL_PASSWORD`, that login is moved once into an encrypted credential named "Beszel", and old live bindings are rebound to it.

After that, remove these from your `.env`: `ENABLE_SERVER_STORAGE`, `STORAGE_PATH`, `ENABLE_GIT_BACKUP` and `BESZEL_*`.

Read-only `/display/<id>` share links no longer exist.

## Configuration reference

Set these in `.env`. `compose.yml` passes them to the container.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | none | Password for the bundled Postgres. Letters and digits only. |
| `FOSSFLOW_URL` | yes | none (`http://localhost` in `.env.example`) | The address people open, without a trailing slash. Sign-in, writes, and invitation and reset links use it. |
| `PORT` | no | `80` | Host port for the app. |
| `FOSSFLOW_ENCRYPTION_KEY` | no | generated into `./data/config/encryption-key` | 32 bytes, base64. Encrypts stored credentials. |
| `SMTP_HOST` | no | empty | Mail server. Unset: no email is sent. |
| `SMTP_PORT` | no | `465` | Mail server port. |
| `SMTP_SECURE` | no | `true` for port 465, else `false` | `true` for implicit TLS, `false` for STARTTLS. |
| `SMTP_USER` | no | empty | Mail login. |
| `SMTP_PASSWORD` | no | empty | Mail password. |
| `SMTP_FROM` | if `SMTP_HOST` is set | empty | Sender address. |
| `HTTP_AUTH_USER` | no | empty | Optional Basic Auth in front of the app. Set both user and password to enable. |
| `HTTP_AUTH_PASSWORD` | no | empty | See above. |
| `LIVE_POLL_SECONDS` | no | `30` | How often each live source is polled. 10 to 3600. |
| `PUID` | no | `1000` | User id the server runs as. Owns `./data`. |
| `PGID` | no | `1000` | Group id the server runs as. |
| `BESZEL_URL`, `BESZEL_EMAIL`, `BESZEL_PASSWORD` | no | empty | Legacy. Read once on first start and moved into a "Beszel" credential. Then remove them. |

Set by `compose.yml`, not by you: `DATABASE_URL` (points at the `db` service), `NODE_ENV`. The image also sets `FOSSFLOW_DATA_DIR=/data`, `BACKEND_PORT=3001` and `BACKEND_HOST=127.0.0.1`.

If `DATABASE_URL` is not set, the container serves only the local editor: no sign-in, diagrams kept in the browser.

## Security

- **Put TLS in front.** FossFLOW speaks plain HTTP on its port. Run a reverse proxy such as Caddy, Traefik or nginx in front of it, and set `FOSSFLOW_URL` to the `https://` address people use.
- **Origin check.** Sign-in and all writes are only accepted from the origin in `FOSSFLOW_URL` (a CSRF check). If sign-in fails with the right password, check that you opened the exact address in `FOSSFLOW_URL`.
- **Basic Auth is an optional extra.** `HTTP_AUTH_USER` and `HTTP_AUTH_PASSWORD` add a browser password prompt in front of everything, including the sign-in page. It doesn't replace sign-in.
- **Rate limits.** Requests are limited per client (120 a minute overall), sign-in has its own limit, and credential writes and connection tests are limited to 20 a minute.
- **Secrets at rest.** Credential secrets are encrypted with AES-256-GCM and never returned to the browser. Keep the encryption key safe: see [Backups](#backups-and-the-encryption-key).
- **Only nginx is published.** The API listens on `127.0.0.1` inside the container. Don't publish port 3001 (`compose.dev.yml` does, for development only).
- **Accepted risk: outbound requests.** "Save and test" and the live pollers make the server call a URL that an editor typed into a credential. Only http and https are allowed, there are no credentials in the URL, redirects aren't followed, and requests time out. Private and internal addresses are not blocked, because internal hubs are the normal case for a self-hosted tool. So an editor can make the server connect to any address they type, and can probe internal ports from the error codes. Only give people edit rights in projects you trust them in. An allowlist setting is a possible later addition.

The full record of security decisions is in [AUDIT.md](AUDIT.md).

## For developers

### Running it locally

You need Node.js 24 or newer and Docker (for Postgres).

```bash
npm install
npm run build:lib                 # the app needs the built library, first time only
npm run dev:db                    # Postgres on 127.0.0.1:54320
cp packages/fossflow-backend/.env.example packages/fossflow-backend/.env
npm run dev:backend               # the server on :3001, restarts on change
npm run dev                       # the app on :3000; /api is proxied to :3001
```

Open `http://localhost:3000` and create the Owner. The default `FOSSFLOW_URL` for the server is `http://localhost:3000`, which matches.

Other commands:

```bash
npm run dev:fake-beszel           # a fake Beszel hub, see LIVE.md
npm test                          # all workspaces; backend tests start Postgres through Docker
npm run lint
```

The server is NestJS, in `packages/fossflow-backend/src/`: `auth/`, `rbac/` (roles and scopes), `projects/`, `landscapes/`, `credentials/`, `connectors/`, `live/`, `crypto/`, `invitations/`, `mail/`.

### Adding a connector

A connector is one file in `packages/fossflow-backend/src/connectors/`, registered in `registry.ts`. It describes its form, validates its settings and opens a client. The app builds the credentials form from the field list, and fields marked `secret` are encrypted and never sent back.

```ts
import { z } from 'zod';
import { defineConnector } from './connector.js';

const settingsSchema = z.object({
	url: z.url(),
	token: z.string().min(1).max(1000)
});

export const exampleConnector = defineConnector({
	info: {
		id: 'example',
		name: 'Example',
		description: 'What this source shows, and which account to use.',
		fields: [
			{ name: 'url', label: 'URL', type: 'url', secret: false, required: true },
			{ name: 'token', label: 'API token', type: 'password', secret: true, required: true }
		]
	},
	schema: settingsSchema,
	connect: (settings) => ({
		async fetch(context) {
			// Call the source with `settings`, then return its inventory
			// as systems (see `normalizeInventory` in ../live/normalize.ts).
			return { systems: [], skipped: 0, truncated: false };
		}
	})
});
```

Then add it to the `CONNECTORS` list in `registry.ts`. `beszel.ts` is a complete example.
