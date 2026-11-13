import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from 'src/styles/theme';
import { ModelProvider } from 'src/stores/modelStore';
import { SceneProvider } from 'src/stores/sceneStore';
import { UiStateProvider, useUiStateStore } from 'src/stores/uiStateStore';
import { useInitialDataManager } from 'src/hooks/useInitialDataManager';
import { useScene } from 'src/hooks/useScene';
import { TrafficProvider } from 'src/traffic/TrafficContext';
import { TrafficLayer } from 'src/traffic/TrafficLayer';
import { TrafficOverlay } from 'src/traffic/TrafficOverlay';
import type { InitialData, UiStateActions } from 'src/types';
import type {
  TrafficEdgeDetail,
  TrafficFeed,
  TrafficStats,
  TrafficStreamMessage,
  TrafficSummary
} from 'src/traffic/types';

export const stats = (overrides: Partial<TrafficStats> = {}): TrafficStats => ({
  calls: 100,
  failures: 0,
  callsPerMin: 20,
  failedPct: 0,
  p50Ms: 50,
  p95Ms: 200,
  ...overrides
});

export const summaryOf = (
  edges: { caller: string; callee: string; stats: Partial<TrafficStats> }[],
  services: TrafficSummary['services'] = []
): TrafficSummary => ({
  generatedAt: '2026-01-01T00:00:00Z',
  windowMinutes: 5,
  edges: edges.map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    lastSeenAt: '2026-01-01T00:00:00Z',
    ...stats(edge.stats)
  })),
  callees: [],
  services,
  aliases: []
});

export interface FakeFeed extends TrafficFeed {
  subscribe: jest.Mock<() => void, [(message: TrafficStreamMessage) => void]>;
  unsubscribe: jest.Mock<void, []>;
}

export const detailOf = (
  overrides: Partial<TrafficEdgeDetail> = {}
): TrafficEdgeDetail => ({
  range: '1h',
  stepSeconds: 60,
  totals: stats(),
  series: [],
  operations: [],
  failures: [],
  ...overrides
});

export const fakeFeed = (
  summary?: TrafficSummary,
  loadEdge: TrafficFeed['loadEdge'] = () => Promise.reject(new Error('not used'))
): FakeFeed => {
  const unsubscribe = jest.fn<void, []>();
  return {
    summary,
    subscribe: jest.fn((listener: (message: TrafficStreamMessage) => void) => {
      void listener;
      return unsubscribe;
    }),
    unsubscribe,
    loadEdge
  };
};

/** Two boxes, one arrow between them (website to member app). */
export const twoBoxModel: InitialData = {
  title: 'Traffic',
  version: '',
  icons: [],
  colors: [{ id: 'c', value: '#aaaaff' }],
  items: [
    { id: 'web', name: 'Website', traffic: { ids: ['service:web'] } },
    { id: 'app', name: 'Member app', traffic: { ids: ['service:app'] } }
  ],
  views: [
    {
      id: 'v',
      name: 'View',
      items: [
        { id: 'web', tile: { x: 0, y: 0 } },
        { id: 'app', tile: { x: 6, y: 0 } }
      ],
      connectors: [
        {
          id: 'arrow',
          color: 'c',
          anchors: [
            { id: 'a1', ref: { item: 'web' } },
            { id: 'a2', ref: { item: 'app' } }
          ]
        }
      ],
      rectangles: [],
      textBoxes: []
    }
  ],
  fitToView: false
};

const Layers = () => {
  const { items } = useScene();
  return (
    <>
      <TrafficLayer />
      <TrafficOverlay nodes={items} />
    </>
  );
};

/** Loads the model like <Isoflow> does, then mounts the traffic layers as the Renderer does. */
const Harness = ({
  traffic,
  model,
  children
}: {
  traffic?: TrafficFeed;
  model: InitialData;
  children?: React.ReactNode;
}) => {
  const { load, isReady } = useInitialDataManager();
  useEffect(() => {
    load(model);
  }, [load, model]);
  if (!isReady) return null;
  return (
    <>
      <div data-testid="map-ready" />
      <TrafficProvider feed={traffic}>{children ?? <Layers />}</TrafficProvider>
    </>
  );
};

/** Exposes the ui store's actions to a test. */
export const uiActions: { current: UiStateActions | null } = { current: null };
const ActionsProbe = () => {
  uiActions.current = useUiStateStore((state) => state.actions);
  return null;
};

const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <ModelProvider>
      <SceneProvider>
        <UiStateProvider>
          <ActionsProbe />
          {children}
        </UiStateProvider>
      </SceneProvider>
    </ModelProvider>
  </ThemeProvider>
);

export const renderMap = (traffic?: TrafficFeed) => {
  const ui = (feed?: TrafficFeed) => (
    <Providers>
      <Harness traffic={feed} model={twoBoxModel} />
    </Providers>
  );
  const result = render(ui(traffic));
  return { ...result, rerenderWith: (feed?: TrafficFeed) => result.rerender(ui(feed)) };
};

/** Mounts `ui` inside the traffic provider of a loaded model, as the overlay's cards are. */
export const renderCard = (
  ui: React.ReactNode,
  traffic?: TrafficFeed,
  model: InitialData = twoBoxModel
) => {
  const tree = (feed?: TrafficFeed) => (
    <Providers>
      <Harness traffic={feed} model={model}>
        {ui}
      </Harness>
    </Providers>
  );
  const result = render(tree(traffic));
  return { ...result, rerenderWith: (feed?: TrafficFeed) => result.rerender(tree(feed)) };
};
