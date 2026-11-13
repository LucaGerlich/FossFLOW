import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useModelStore } from 'src/stores/modelStore';
import { useScene } from 'src/hooks/useScene';
import { buildTrafficIndex, type TrafficIndex } from './match';
import { arrowTraffic, type ArrowTraffic } from './stats';
import type { TrafficFeed } from './types';

export interface TrafficState {
  feed: TrafficFeed;
  index: TrafficIndex;
  arrows: Map<string, ArrowTraffic>;
  /** Latest dot weight per connector; TrafficLayer writes it. */
  weights: Map<string, number>;
}

const TrafficContext = createContext<TrafficState | null>(null);

interface TrafficProviderProps {
  feed?: TrafficFeed;
  children: React.ReactNode;
}

/** Provides traffic state; the value is null (and nothing is computed) without a feed. */
export const TrafficProvider = ({ feed, children }: TrafficProviderProps) => {
  const items = useModelStore((state) => state.items);
  const { connectors } = useScene();
  const weights = useRef(new Map<string, number>());
  const summary = feed?.summary;

  const index = useMemo(
    () => (feed ? buildTrafficIndex(items, summary?.aliases ?? []) : null),
    [feed, items, summary]
  );
  const arrows = useMemo(
    () =>
      index && summary
        ? arrowTraffic(summary, index, connectors)
        : new Map<string, ArrowTraffic>(),
    [index, summary, connectors]
  );
  const value = useMemo(
    () =>
      feed && index ? { feed, index, arrows, weights: weights.current } : null,
    [feed, index, arrows]
  );

  return (
    <TrafficContext.Provider value={value}>{children}</TrafficContext.Provider>
  );
};

/** The current traffic state, or null when no feed is passed in. */
export const useTraffic = (): TrafficState | null => useContext(TrafficContext);
