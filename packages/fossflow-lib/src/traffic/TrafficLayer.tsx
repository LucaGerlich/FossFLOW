import React, { useEffect, useMemo, useRef } from 'react';
import { useScene } from 'src/hooks/useScene';
import { LIVE_TOKENS } from 'src/live/tokens';
import type { Coords } from 'src/types';
import { connectorPointsById, pointAlong } from './geometry';
import { createRouter, type ArrowMatch } from './match';
import { createDotScheduler, type ActiveDot } from './scheduler';
import { isFailing } from './stats';
import { useTraffic } from './TrafficContext';

const DOT_RADIUS = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface DotPosition {
  id: number;
  x: number;
  y: number;
  failed: boolean;
}

/** Scene position of every dot that has a route and a path; the rest are skipped. */
export const drawFrame = (
  dots: ActiveDot[],
  route: (caller: string, callee: string) => ArrowMatch | null,
  pathOf: (connectorId: string) => Coords[] | null
): DotPosition[] => {
  const positions: DotPosition[] = [];
  for (const dot of dots) {
    const match = route(dot.caller, dot.callee);
    if (!match) continue;
    const path = pathOf(match.connectorId);
    if (!path) continue;
    const progress = match.reversed ? 1 - dot.progress : dot.progress;
    const { x, y } = pointAlong(path, progress);
    positions.push({ id: dot.id, x, y, failed: dot.failed });
  }
  return positions;
};

/** Dots moving along arrows, and a red line over failing arrows. */
export const TrafficLayer = () => {
  const traffic = useTraffic();
  const { connectors } = useScene();
  const dotsRef = useRef<SVGGElement>(null);

  const points = useMemo(() => connectorPointsById(connectors), [connectors]);
  const route = useMemo(
    () => (traffic ? createRouter(traffic.index, connectors) : null),
    [traffic, connectors]
  );
  // The loop reads these through a ref so a new arrow never restarts it.
  const latest = useRef({ route, points });
  useEffect(() => {
    latest.current = { route, points };
  }, [route, points]);

  // Key on the function, not the feed object: the feed may be a new object per summary.
  const subscribe = traffic?.feed.subscribe;
  const weights = traffic?.weights;
  useEffect(() => {
    const group = dotsRef.current;
    if (!subscribe || !weights || !group) return undefined;

    const scheduler = createDotScheduler();
    const circles = new Map<number, SVGCircleElement>();
    let frame = 0;

    const removeAll = () => {
      circles.forEach((circle) => circle.remove());
      circles.clear();
    };

    const unsubscribe = subscribe((message) => {
      scheduler.receive(message, Date.now());
      const { route: currentRoute } = latest.current;
      if (!currentRoute) return;
      for (const dot of message.dots) {
        const match = currentRoute(dot.caller, dot.callee);
        if (match) weights.set(match.connectorId, dot.weight);
      }
    });

    const tick = () => {
      const { route: currentRoute, points: currentPoints } = latest.current;
      const positions = currentRoute
        ? drawFrame(
            scheduler.due(Date.now()),
            currentRoute,
            (connectorId) => currentPoints.get(connectorId) ?? null
          )
        : [];
      const live = new Set<number>();
      for (const position of positions) {
        live.add(position.id);
        let circle = circles.get(position.id);
        if (!circle) {
          circle = document.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('r', String(DOT_RADIUS));
          circle.setAttribute(
            'fill',
            position.failed ? LIVE_TOKENS.critical : LIVE_TOKENS.ink
          );
          group.appendChild(circle);
          circles.set(position.id, circle);
        }
        circle.setAttribute('cx', String(position.x));
        circle.setAttribute('cy', String(position.y));
      }
      circles.forEach((circle, id) => {
        if (live.has(id)) return;
        circle.remove();
        circles.delete(id);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      scheduler.clear();
      removeAll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      scheduler.clear();
      removeAll();
    };
  }, [subscribe, weights]);

  if (!traffic) return null;

  const failing = [...traffic.arrows.values()].filter(isFailing);

  return (
    <svg
      data-traffic-layer
      width={1}
      height={1}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        pointerEvents: 'none'
      }}
    >
      {failing.map((arrow) => {
        const path = points.get(arrow.connectorId);
        if (!path) return null;
        return (
          <polyline
            key={arrow.connectorId}
            points={path.map(({ x, y }) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={LIVE_TOKENS.critical}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
      <g ref={dotsRef} />
    </svg>
  );
};
