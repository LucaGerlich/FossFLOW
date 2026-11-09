import {
  Router,
  type NextFunction,
  type Request,
  type Response
} from 'express';
import rateLimit from 'express-rate-limit';
import type { LiveHub } from './hub.ts';
import type { LiveStatusResponse } from './types.ts';

const DISABLED: LiveStatusResponse = { enabled: false, sources: [] };

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * `GET /status`   → whether live data is configured, plus source health.
 * `GET /snapshot` → normalised systems and containers (404 when disabled).
 * Mount behind the deployment's auth (nginx Basic Auth in the Docker image).
 */
export function createLiveRouter(hub: LiveHub | null): Router {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false
    }),
    noStore
  );

  router.get('/status', (_req, res) => {
    res.json(hub ? hub.getStatus() : DISABLED);
  });

  router.get('/snapshot', (_req, res) => {
    if (!hub) {
      res.status(404).json({ error: 'Live data is not configured' });
      return;
    }
    res.json(hub.getSnapshot());
  });

  return router;
}
