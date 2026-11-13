import { Injectable, Logger } from '@nestjs/common';
import type { TrafficEvent } from '../ingest/spans.js';
import type { TrafficDot, TrafficStreamMessage } from './wire.js';

export const DOTS_PER_ARROW_PER_SECOND = 20;
export const DOTS_PER_PROJECT_PER_SECOND = 400;

const logger = new Logger('TrafficHub');

type Listener = (message: TrafficStreamMessage) => void;

type Budget = {
  second: number;
  total: number;
  arrows: Map<string, number>;
};

type ProjectState = {
  listeners: Set<Listener>;
  budget: Budget;
};

/** Fans live calls out to the browsers watching a project, thinned per arrow and per project. */
@Injectable()
export class TrafficHub {
  private readonly projects = new Map<string, ProjectState>();

  subscribe(projectId: string, listener: Listener): () => void {
    const state = this.projects.get(projectId) ?? {
      listeners: new Set<Listener>(),
      budget: { second: -1, total: 0, arrows: new Map<string, number>() }
    };
    this.projects.set(projectId, state);
    // A wrapper so subscribing the same function twice gives two subscriptions.
    const entry: Listener = (message) => listener(message);
    state.listeners.add(entry);
    return () => {
      state.listeners.delete(entry);
      if (state.listeners.size === 0 && this.projects.get(projectId) === state) {
        this.projects.delete(projectId);
      }
    };
  }

  publish(projectId: string, events: readonly TrafficEvent[], now = Date.now()): void {
    const state = this.projects.get(projectId);
    if (!state) return;

    const second = Math.floor(now / 1000);
    if (state.budget.second !== second) {
      state.budget = { second, total: 0, arrows: new Map<string, number>() };
    }
    const { budget } = state;

    const byArrow = new Map<string, TrafficEvent[]>();
    for (const event of events) {
      if (event.kind !== 'call') continue;
      const arrow = `${event.caller}\0${event.callee}`;
      const list = byArrow.get(arrow);
      if (list) list.push(event);
      else byArrow.set(arrow, [event]);
    }

    const dots: TrafficDot[] = [];
    for (const [arrow, list] of byArrow) {
      const sent = budget.arrows.get(arrow) ?? 0;
      const allowed = Math.min(
        DOTS_PER_ARROW_PER_SECOND - sent,
        DOTS_PER_PROJECT_PER_SECOND - budget.total
      );
      if (allowed <= 0) continue;

      const sorted = [...list].sort((a, b) => a.at - b.at);
      const n = sorted.length;
      const count = Math.min(n, allowed);
      for (let i = 0; i < count; i += 1) {
        const from = Math.floor((i * n) / count);
        const to = Math.floor(((i + 1) * n) / count);
        const event = sorted[from];
        if (!event) continue;
        dots.push({
          caller: event.caller,
          callee: event.callee,
          start: event.at,
          durationMs: event.durationMs,
          failed: event.failed,
          weight: to - from
        });
      }
      budget.arrows.set(arrow, sent + count);
      budget.total += count;
    }
    if (dots.length === 0) return;

    const message: TrafficStreamMessage = { sentAt: now, dots };
    for (const listener of [...state.listeners]) {
      try {
        listener(message);
      } catch (error) {
        logger.error(`A stream listener failed (${error instanceof Error ? error.name : 'unknown error'})`);
      }
    }
  }
}
