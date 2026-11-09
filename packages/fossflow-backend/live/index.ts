import type { Router } from 'express';
import { createBeszelClient } from './beszel.ts';
import { readLiveConfig } from './config.ts';
import { createLiveHub, type LiveHub, type LiveLogger } from './hub.ts';
import { createLiveRouter } from './routes.ts';

export interface LiveSetup {
  router: Router;
  hub: LiveHub | null;
  /** One line for the startup banner. */
  summary: string;
}

/** Reads the environment and, when a source is configured, starts polling it. */
export function setupLive(
  env: NodeJS.ProcessEnv,
  logger: LiveLogger = console
): LiveSetup {
  const result = readLiveConfig(env);
  if (!result.ok) {
    if (result.reason) logger.warn(`[live] disabled: ${result.reason}`);
    return {
      router: createLiveRouter(null),
      hub: null,
      summary: result.reason ? `DISABLED (${result.reason})` : 'DISABLED'
    };
  }

  const { config } = result;
  const hub = createLiveHub({
    config,
    client: createBeszelClient(config.beszel),
    logger
  });
  hub.start();
  return {
    router: createLiveRouter(hub),
    hub,
    summary: `ENABLED (Beszel at ${new URL(config.beszel.url).host}, every ${config.pollSeconds}s)`
  };
}
