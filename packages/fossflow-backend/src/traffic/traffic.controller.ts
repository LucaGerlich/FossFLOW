import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthSession } from '../auth/auth.js';
import { parseBody } from '../common/validation.js';
import { CurrentSession } from '../auth/guards.js';
import { CurrentProject, type ProjectAccessInfo, RequireProjectScope } from '../projects/project-access.js';
import { TrafficHub } from './hub.js';
import { createSummaryCache } from './summary-cache.js';
import { MAX_STREAMS_PER_USER, openTrafficStream } from './stream.js';
import { TrafficQueries } from './traffic-queries.js';
import type { TrafficEdgeDetail, TrafficSummary } from './wire.js';

const toList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

const identity = z.string().min(1, 'Identities need 1–300 characters').max(300, 'Identities need 1–300 characters');

const edgeQuery = z
  .object({
    caller: z.array(identity).min(1, 'Give 1–20 caller/callee pairs').max(20, 'Give 1–20 caller/callee pairs'),
    callee: z.array(identity).max(20, 'Give 1–20 caller/callee pairs'),
    range: z.enum(['1h', '24h', '7d'], 'range must be 1h, 24h or 7d').default('1h')
  })
  .refine((query) => query.caller.length === query.callee.length, {
    message: 'caller and callee must be given in pairs',
    path: ['callee']
  });

@Controller('landscapes/:id/traffic')
export class TrafficController {
  /** Open streams per user; the stream's own `close` frees its slot. */
  private readonly openStreams = new Map<string, number>();

  private readonly summaryOf: (projectId: string, now: Date) => Promise<TrafficSummary>;

  constructor(
    private readonly hub: TrafficHub,
    private readonly queries: TrafficQueries
  ) {
    this.summaryOf = createSummaryCache((projectId, now) => this.queries.summary(projectId, now));
  }

  @Get('stream')
  @RequireProjectScope('landscape:read', { target: 'landscape' })
  stream(
    @CurrentSession() session: AuthSession,
    @CurrentProject() access: ProjectAccessInfo,
    @Res() res: Response
  ): void {
    if (res.destroyed || res.writableEnded) return;
    const userId = session.user.id;
    const count = this.openStreams.get(userId) ?? 0;
    if (count >= MAX_STREAMS_PER_USER) {
      res.status(429).json({ error: 'Too many open traffic streams' });
      return;
    }
    this.openStreams.set(userId, count + 1);
    res.on('close', () => {
      const left = (this.openStreams.get(userId) ?? 1) - 1;
      if (left <= 0) this.openStreams.delete(userId);
      else this.openStreams.set(userId, left);
    });
    openTrafficStream(res, (listener) => this.hub.subscribe(access.projectId, listener));
  }

  @Get('summary')
  @RequireProjectScope('landscape:read', { target: 'landscape' })
  @Header('Cache-Control', 'no-store')
  summary(@CurrentProject() access: ProjectAccessInfo): Promise<TrafficSummary> {
    return this.summaryOf(access.projectId, new Date());
  }

  @Get('edge')
  @RequireProjectScope('landscape:read', { target: 'landscape' })
  @Header('Cache-Control', 'no-store')
  edge(
    @CurrentProject() access: ProjectAccessInfo,
    @Query() query: Record<string, unknown>
  ): Promise<TrafficEdgeDetail> {
    const parsed = parseBody(edgeQuery, {
      caller: toList(query.caller),
      callee: toList(query.callee),
      range: query.range
    });
    const pairs = parsed.caller.map((caller, index) => ({ caller, callee: parsed.callee[index] ?? '' }));
    return this.queries.edge(access.projectId, pairs, parsed.range, new Date());
  }
}
