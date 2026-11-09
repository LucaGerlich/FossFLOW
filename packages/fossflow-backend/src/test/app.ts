import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createApp } from '../app.js';
import { type AppConfig, loadConfig } from '../config/config.js';
import { startPostgres } from './postgres.js';

/** The public URL tests run under; writes must carry this Origin. */
export const TEST_ORIGIN = 'http://fossflow.test';

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  postgres: StartedPostgreSqlContainer;
  /** A fresh browser: its own cookie jar, sends the app's Origin. */
  browser: () => Browser;
  close: () => Promise<void>;
}

export interface Browser {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  delete: (url: string) => request.Test;
}

export async function startTestApp(env: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const postgres = await startPostgres();
  const config = loadConfig({
    DATABASE_URL: postgres.getConnectionUri(),
    FOSSFLOW_URL: TEST_ORIGIN,
    FOSSFLOW_DATA_DIR: mkdtempSync(join(tmpdir(), 'fossflow-data-')),
    ...env
  });
  const app = await createApp(config);
  await app.init();

  let clients = 0;
  const browser = (): Browser => {
    const agent = request.agent(app.getHttpServer());
    // Each browser is its own client, as nginx reports it (rate limits are per IP).
    clients += 1;
    const ip = `10.0.${Math.floor(clients / 250)}.${(clients % 250) + 1}`;
    const headers = { Origin: TEST_ORIGIN, 'X-Real-IP': ip };
    return {
      get: (url) => agent.get(url).set(headers),
      post: (url, body) => agent.post(url).set(headers).send(body ?? {}),
      put: (url, body) => agent.put(url).set(headers).send(body ?? {}),
      patch: (url, body) => agent.patch(url).set(headers).send(body ?? {}),
      delete: (url) => agent.delete(url).set(headers)
    };
  };

  return {
    app,
    config,
    postgres,
    browser,
    close: async () => {
      await app.close();
      await postgres.stop();
    }
  };
}
