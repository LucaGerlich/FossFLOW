import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException
} from '@nestjs/common';
import type { LiveHub } from './hub.js';
import type { LiveSnapshot, LiveStatusResponse } from './types.js';

export const LIVE_HUB = Symbol('LIVE_HUB');

const DISABLED: LiveStatusResponse = { enabled: false, sources: [] };

/**
 * `GET /api/live/status`   → whether live data is configured, plus source health.
 * `GET /api/live/snapshot` → normalised systems and containers (404 when off).
 * Sends no CORS headers, so other sites can't read it from a visitor's browser.
 */
@Controller('live')
export class LiveController {
  constructor(@Inject(LIVE_HUB) private readonly hub: LiveHub | null) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(): LiveStatusResponse {
    return this.hub ? this.hub.getStatus() : DISABLED;
  }

  @Get('snapshot')
  @Header('Cache-Control', 'no-store')
  snapshot(): LiveSnapshot {
    if (!this.hub) {
      throw new NotFoundException({ error: 'Live data is not configured' });
    }
    return this.hub.getSnapshot();
  }
}
