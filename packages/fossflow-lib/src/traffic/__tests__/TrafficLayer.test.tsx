import { act, screen } from '@testing-library/react';
import type { Coords } from 'src/types';
import { drawFrame } from 'src/traffic/TrafficLayer';
import type { ActiveDot } from 'src/traffic/scheduler';
import { fakeFeed, renderMap, summaryOf } from 'src/traffic/__fixtures__/feed';

const dot = (overrides: Partial<ActiveDot> = {}): ActiveDot => ({
  id: 1,
  caller: 'service:a',
  callee: 'service:b',
  failed: false,
  weight: 1,
  progress: 0.5,
  ...overrides
});

const path: Coords[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 }
];

describe('drawFrame', () => {
  it('skips dots without a route or without a path', () => {
    const dots = [
      dot({ id: 1 }),
      dot({ id: 2, caller: 'service:gone' }),
      dot({ id: 3, callee: 'service:deleted-arrow' })
    ];
    const route = (caller: string, callee: string) => {
      if (caller === 'service:gone') return null;
      return {
        connectorId: callee === 'service:deleted-arrow' ? 'missing' : 'arrow',
        reversed: false
      };
    };
    const pathOf = (connectorId: string) =>
      connectorId === 'arrow' ? path : null;

    expect(drawFrame(dots, route, pathOf)).toEqual([
      { id: 1, x: 50, y: 0, failed: false }
    ]);
  });

  it('puts a reversed dot at 1 - progress and keeps its failed flag', () => {
    const frame = drawFrame(
      [dot({ progress: 0.25, failed: true })],
      () => ({ connectorId: 'arrow', reversed: true }),
      () => path
    );
    expect(frame).toEqual([{ id: 1, x: 75, y: 0, failed: true }]);
  });
});

describe('TrafficLayer', () => {
  it('subscribes once on mount and unsubscribes on unmount', async () => {
    const feed = fakeFeed();
    const { unmount } = renderMap(feed);
    await screen.findByTestId('map-ready');

    expect(feed.subscribe).toHaveBeenCalledTimes(1);
    expect(feed.unsubscribe).not.toHaveBeenCalled();
    act(() => unmount());
    expect(feed.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not render anything without a traffic feed', async () => {
    const { container } = renderMap();
    await screen.findByTestId('map-ready');
    expect(container.querySelector('[data-traffic-layer]')).toBeNull();
  });

  it('keeps its subscription when only the feed object changes', async () => {
    const feed = fakeFeed();
    const { rerenderWith } = renderMap(feed);
    await screen.findByTestId('map-ready');

    rerenderWith({ ...feed, summary: summaryOf([]) });

    expect(feed.subscribe).toHaveBeenCalledTimes(1);
    expect(feed.unsubscribe).not.toHaveBeenCalled();
  });

  it('resubscribes when the subscribe function changes', async () => {
    const first = fakeFeed();
    const second = fakeFeed();
    const { rerenderWith } = renderMap(first);
    await screen.findByTestId('map-ready');

    rerenderWith(second);

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.subscribe).toHaveBeenCalledTimes(1);
  });
});
