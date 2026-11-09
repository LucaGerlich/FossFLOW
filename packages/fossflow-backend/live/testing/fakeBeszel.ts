import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny stand-in for the Beszel hub's PocketBase API: password auth plus the
 * `systems` and `containers` record lists. Used by tests and `npm run dev:fake-beszel`.
 */

export interface FakeSystem {
  id: string;
  name: string;
  status: string;
  info: Record<string, unknown>;
}

export interface FakeContainer {
  system: string;
  name: string;
  image: string;
  status: string;
  health: number;
  cpu: number;
  memory: number;
  updatable?: boolean;
  updated?: number;
}

export interface FakeBeszelOptions {
  email?: string;
  password?: string;
  port?: number;
  systems?: FakeSystem[];
  containers?: FakeContainer[];
}

export interface FakeBeszel {
  url: string;
  email: string;
  password: string;
  /** `METHOD /path` of every request received, without query or body. */
  requests: string[];
  setSystems: (systems: FakeSystem[]) => void;
  setContainers: (containers: FakeContainer[]) => void;
  /** Invalidate all issued tokens, as if they expired. */
  revokeTokens: () => void;
  close: () => Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export async function startFakeBeszel(
  options: FakeBeszelOptions = {}
): Promise<FakeBeszel> {
  const email = options.email ?? 'readonly@example.com';
  const password = options.password ?? 'correct horse battery staple';
  let systems = options.systems ?? [];
  let containers = options.containers ?? [];
  const tokens = new Set<string>();
  const requests: string[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      requests.push(`${req.method} ${url.pathname}`);

      if (
        req.method === 'POST' &&
        url.pathname === '/api/collections/users/auth-with-password'
      ) {
        const body = (await readJson(req)) as {
          identity?: unknown;
          password?: unknown;
        } | null;
        if (body?.identity !== email || body?.password !== password) {
          send(res, 400, { message: 'Failed to authenticate.' });
          return;
        }
        const token = randomUUID();
        tokens.add(token);
        send(res, 200, {
          token,
          record: { id: 'u1', email, role: 'readonly' }
        });
        return;
      }

      const match = /^\/api\/collections\/(systems|containers)\/records$/.exec(
        url.pathname
      );
      if (req.method === 'GET' && match) {
        if (!tokens.has(req.headers.authorization ?? '')) {
          send(res, 401, {
            message: 'The request requires valid record authorization token.'
          });
          return;
        }
        const all = match[1] === 'systems' ? systems : containers;
        const page = Number(url.searchParams.get('page') ?? '1');
        const perPage = Number(url.searchParams.get('perPage') ?? '30');
        const items = all.slice((page - 1) * perPage, page * perPage);
        send(res, 200, {
          page,
          perPage,
          totalItems: -1,
          totalPages: -1,
          items
        });
        return;
      }

      send(res, 404, { message: 'Not found.' });
    })();
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    email,
    password,
    requests,
    setSystems: (next) => {
      systems = next;
    },
    setContainers: (next) => {
      containers = next;
    },
    revokeTokens: () => tokens.clear(),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

/** Demo landscape matching the design mockups. */
export function demoLandscape(nowMs: number): {
  systems: FakeSystem[];
  containers: FakeContainer[];
} {
  const info = (cpu: number, mp: number, dp: number) => ({
    cpu,
    mp,
    dp,
    bb: 4_400_000,
    la: [1.24, 0.98, 0.87],
    u: 3_542_400,
    dt: 52
  });
  const ctr = (
    system: string,
    name: string,
    image: string,
    cpu: number,
    memory: number,
    extra: Partial<FakeContainer> = {}
  ): FakeContainer => ({
    system,
    name,
    image,
    status: 'Up 3 days',
    health: 0,
    cpu,
    memory,
    updated: nowMs,
    ...extra
  });
  return {
    systems: [
      { id: 'sysweb01', name: 'web-01', status: 'up', info: info(34, 61, 72) },
      { id: 'sysdb01', name: 'db-01', status: 'up', info: info(58, 83, 64) }
    ],
    containers: [
      ctr('sysweb01', 'traefik', 'traefik:3.2', 0.8, 64),
      ctr('sysweb01', 'app', 'ghcr.io/acme/app:1.14', 18, 1228),
      ctr('sysweb01', 'worker', 'ghcr.io/acme/app:1.14', 6, 420),
      ctr('sysweb01', 'redis', 'redis:7', 1.2, 96, { updatable: true }),
      ctr('sysdb01', 'postgres', 'postgres:16', 41, 2150, {
        health: 3,
        status: 'Up 2 hours (unhealthy)'
      }),
      ctr('sysdb01', 'backup', 'restic/restic:0.17', 0.3, 48)
    ]
  };
}
