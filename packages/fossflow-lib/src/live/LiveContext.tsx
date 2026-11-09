import React, { createContext, useContext, useMemo } from 'react';
import {
  buildLiveIndex,
  resolveLive,
  type LiveEntity,
  type LiveIndex
} from './status';
import type { LiveSnapshot } from './types';

const LiveContext = createContext<LiveIndex | null>(null);

interface LiveProviderProps {
  snapshot?: LiveSnapshot;
  children: React.ReactNode;
}

export const LiveProvider = ({ snapshot, children }: LiveProviderProps) => {
  const index = useMemo(
    () => (snapshot ? buildLiveIndex(snapshot) : null),
    [snapshot]
  );
  return <LiveContext.Provider value={index}>{children}</LiveContext.Provider>;
};

/** The current live lookup, or null when no live data is passed in. */
export const useLiveIndex = (): LiveIndex | null => useContext(LiveContext);

/** Live state of a bound key, or null when unbound or live data is off. */
export const useLiveEntity = (key: string | undefined): LiveEntity | null => {
  const index = useLiveIndex();
  return useMemo(
    () => (index && key ? resolveLive(index, key) : null),
    [index, key]
  );
};
