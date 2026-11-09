import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';

/** For container healthchecks: is the server up and can it reach Postgres? */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    }
    return { status: 'ok' };
  }
}
