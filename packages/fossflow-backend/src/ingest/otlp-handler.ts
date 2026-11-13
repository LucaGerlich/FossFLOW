import { Logger } from '@nestjs/common';
import express, { type Request, type RequestHandler, type Response } from 'express';
import type { TrafficAggregator } from '../traffic/aggregator.js';
import type { IngestKeysService } from './ingest-keys.service.js';
import {
  decodeTraceRequest,
  formatOf,
  OtlpDecodeError,
  type OtlpFormat
} from './otlp-decode.js';
import { toTraffic } from './spans.js';

const logger = new Logger('Ingest');

/** Largest request body, measured after gzip is inflated. */
export const INGEST_MAX_BYTES = 16 * 1024 * 1024;
const KEY_LIMIT = 1200;
const WINDOW_MS = 60_000;
const SWEEP_ABOVE = 1000;

type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

/** A fixed window per key: `limit` takes per `windowMs`, counted from the first take. */
export const createKeyLimiter = (
  limit: number,
  windowMs: number
): { take(keyId: string, now: number): Take } => {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(keyId, now) {
      if (windows.size > SWEEP_ABOVE) {
        for (const [id, window] of windows) {
          if (now - window.start >= windowMs) windows.delete(id);
        }
      }
      const current = windows.get(keyId);
      const window =
        current && now - current.start < windowMs ? current : { start: now, count: 0 };
      windows.set(keyId, window);
      if (window.count >= limit) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((window.start + windowMs - now) / 1000)
        };
      }
      window.count += 1;
      return { ok: true };
    }
  };
};

/** Built once; `raw` inflates gzip and applies the limit to the inflated size. */
const rawBody = express.raw({ type: () => true, limit: INGEST_MAX_BYTES });

const readBody = (req: Request, res: Response): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    rawBody(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      // No body at all leaves req.body unset; that is an empty request.
      resolve(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    });
  });

const statusOf = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null;
  const { status } = error as { status?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
};

const fail = (res: Response, status: number, message: string): void => {
  res.status(status).json({ error: message });
};

const succeed = (res: Response, format: OtlpFormat): void => {
  if (format === 'json') {
    res.status(200).type('application/json').send('{}');
  } else {
    res.status(200).type('application/x-protobuf').end();
  }
};

export const createOtlpHandler = (deps: {
  keys: IngestKeysService;
  aggregator: TrafficAggregator;
}): RequestHandler => {
  const limiter = createKeyLimiter(KEY_LIMIT, WINDOW_MS);

  return async (req, res) => {
    try {
      // The key comes first: nothing is read from an unauthenticated sender.
      const presented = req.headers['x-fossflow-key'];
      const key = await deps.keys.authenticate(
        typeof presented === 'string' ? presented : undefined
      );
      if (!key) return fail(res, 401, 'Missing or invalid ingest key');

      const taken = limiter.take(key.id, Date.now());
      if (!taken.ok) {
        res.set('Retry-After', String(taken.retryAfterSeconds));
        return fail(res, 429, 'Too many requests for this ingest key');
      }

      const format = formatOf(req.headers['content-type']);
      if (!format) {
        return fail(res, 415, 'Use application/x-protobuf or application/json');
      }

      let body: Buffer;
      try {
        body = await readBody(req, res);
      } catch (error) {
        const status = statusOf(error) ?? 400;
        return fail(res, status, status === 413 ? 'Request body is too large' : 'Request body could not be read');
      }

      const request = decodeTraceRequest(body, format);
      deps.aggregator.add(key, toTraffic(request, Date.now()));
      succeed(res, format);
    } catch (error) {
      if (error instanceof OtlpDecodeError) return fail(res, 400, error.message);
      // Never log the error message: it may quote request content.
      logger.error(`OTLP request failed (${error instanceof Error ? error.name : 'unknown error'})`);
      if (!res.headersSent) fail(res, 500, 'Internal error');
    }
  };
};
