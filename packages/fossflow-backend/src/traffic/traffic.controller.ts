import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { CurrentProject, type ProjectAccessInfo, RequireProjectScope } from '../projects/project-access.js';
import { TrafficHub } from './hub.js';
import { MAX_STREAMS_PER_USER, openTrafficStream } from './stream.js';

@Controller('landscapes/:id/traffic')
export class TrafficController {
  /** Open streams per user; the stream's own `close` frees its slot. */
  private readonly openStreams = new Map<string, number>();

  constructor(private readonly hub: TrafficHub) {}

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
}
