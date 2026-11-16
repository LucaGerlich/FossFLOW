import type { Connector } from 'src/types';
import { boxOf, findArrow, type TrafficIndex } from './match';
import type { TrafficAlert } from './types';

/** The first box binding the pattern verbatim (exact or wildcard), else the box owning it as an identity. */
export const boxForPattern = (
  index: TrafficIndex,
  pattern: string
): string | null => {
  const bound = index.boxes.find(
    (box) => box.exact.has(pattern) || box.wildcards.includes(pattern)
  );
  return bound ? bound.itemId : boxOf(index, pattern);
};

/** Failing and silent outrank slow, then the oldest alert wins. */
const outranks = (candidate: TrafficAlert, current: TrafficAlert): boolean => {
  const severe = (alert: TrafficAlert): number => (alert.kind === 'slow' ? 0 : 1);
  if (severe(candidate) !== severe(current)) {
    return severe(candidate) > severe(current);
  }
  return Date.parse(candidate.startedAt) < Date.parse(current.startedAt);
};

const keep = (
  map: Map<string, TrafficAlert>,
  id: string,
  alert: TrafficAlert
): void => {
  const current = map.get(id);
  if (!current || outranks(alert, current)) map.set(id, alert);
};

export interface AlertTrouble {
  /** By connector id. */
  arrows: Map<string, TrafficAlert>;
  /** By box (model item) id. */
  boxes: Map<string, TrafficAlert>;
}

/** The firing alert that decides how each arrow and box on the map looks. */
export const alertTrouble = (
  alerts: TrafficAlert[],
  index: TrafficIndex,
  connectors: Connector[]
): AlertTrouble => {
  const arrows = new Map<string, TrafficAlert>();
  const boxes = new Map<string, TrafficAlert>();
  for (const alert of alerts) {
    const { target } = alert;
    if (target.type === 'arrow') {
      const from = boxForPattern(index, target.from);
      const to = boxForPattern(index, target.to);
      if (from === null || to === null) continue;
      const match = findArrow(connectors, from, to);
      if (match) keep(arrows, match.connectorId, alert);
    } else {
      const box = boxForPattern(index, target.identity);
      if (box !== null) keep(boxes, box, alert);
    }
  }
  return { arrows, boxes };
};

export type TroubleKind = 'failing' | 'silent' | 'slow';

/** How an arrow looks: the built-in failing rule or a firing failing alert beat the rest. */
export const arrowKind = (
  failing: boolean,
  alert: TrafficAlert | undefined
): TroubleKind | null => {
  if (failing || alert?.kind === 'failing') return 'failing';
  return alert ? alert.kind : null;
};
