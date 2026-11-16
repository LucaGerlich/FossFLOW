import type { Connector, ModelItem } from 'src/types';
import type { TrafficAlias } from './types';

export interface ArrowMatch {
  connectorId: string;
  reversed: boolean;
}

export interface TrafficBox {
  itemId: string;
  /** Identities this box binds by hand (non-wildcard entries of its own `traffic.ids`). */
  exact: Set<string>;
  /** Alias hosts of the services this box binds exactly; learned, so they rank below `exact`. */
  aliases: Set<string>;
  /** Patterns of the form `<prefix>:*.<suffix>`. */
  wildcards: string[];
}

export interface TrafficIndex {
  boxes: TrafficBox[];
}

const WILDCARD = ':*.';

/** An exact match always counts; `T:*.REST` matches `T:X.REST` for a non-empty `X`. */
export function matchesIdentity(pattern: string, id: string): boolean {
  if (pattern === id) return true;
  const at = pattern.indexOf(WILDCARD);
  if (at === -1) return false;
  const prefix = pattern.slice(0, at + 1);
  const suffix = pattern.slice(at + WILDCARD.length - 1);
  return (
    id.startsWith(prefix) &&
    id.length > prefix.length + suffix.length &&
    id.endsWith(suffix)
  );
}

/** Boxes in model order. A box also owns the alias hosts of the services it binds exactly. */
export function buildTrafficIndex(
  items: ModelItem[],
  aliases: TrafficAlias[]
): TrafficIndex {
  const boxes: TrafficBox[] = [];
  for (const item of items) {
    const ids = item.traffic?.ids;
    if (!ids) continue;
    const exact = new Set<string>();
    const wildcards: string[] = [];
    for (const id of ids) {
      if (id.includes(WILDCARD)) wildcards.push(id);
      else exact.add(id);
    }
    const owned = new Set<string>();
    for (const alias of aliases) {
      if (exact.has(alias.service)) owned.add(alias.host);
    }
    boxes.push({ itemId: item.id, exact, aliases: owned, wildcards });
  }
  return { boxes };
}

/**
 * The first box binding the identity by hand, else the first box owning it
 * through an alias, else the first box with a matching wildcard.
 */
export function boxOf(index: TrafficIndex, identity: string): string | null {
  const exact = index.boxes.find((box) => box.exact.has(identity));
  if (exact) return exact.itemId;
  const aliased = index.boxes.find((box) => box.aliases.has(identity));
  if (aliased) return aliased.itemId;
  const wild = index.boxes.find((box) =>
    box.wildcards.some((pattern) => matchesIdentity(pattern, identity))
  );
  return wild ? wild.itemId : null;
}

/** The first connector whose two ends are anchored to boxes `a` and `b`, in either order. */
export function findArrow(
  connectors: Connector[],
  a: string,
  b: string
): ArrowMatch | null {
  if (a === b) return null;
  for (const connector of connectors) {
    const first = connector.anchors[0]?.ref.item;
    const last = connector.anchors[connector.anchors.length - 1]?.ref.item;
    if (first === a && last === b) {
      return { connectorId: connector.id, reversed: false };
    }
    if (first === b && last === a) {
      return { connectorId: connector.id, reversed: true };
    }
  }
  return null;
}

export function createRouter(
  index: TrafficIndex,
  connectors: Connector[]
): (caller: string, callee: string) => ArrowMatch | null {
  const cache = new Map<string, string | null>();
  const resolve = (identity: string): string | null => {
    if (cache.has(identity)) return cache.get(identity) ?? null;
    const box = boxOf(index, identity);
    cache.set(identity, box);
    return box;
  };
  return (caller, callee) => {
    const from = resolve(caller);
    const to = resolve(callee);
    if (from === null || to === null) return null;
    return findArrow(connectors, from, to);
  };
}
