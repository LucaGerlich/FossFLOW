import { screen } from '@testing-library/react';
import {
  fakeFeed,
  renderMap,
  summaryOf
} from 'src/traffic/__fixtures__/feed';

const edge = (failures: number, calls = 1050) => ({
  caller: 'service:web',
  callee: 'service:app',
  stats: {
    calls,
    failures,
    callsPerMin: calls / 5,
    failedPct: (100 * failures) / calls,
    p50Ms: 95,
    p95Ms: 400
  }
});

describe('TrafficOverlay', () => {
  it('shows a pill on a failing arrow and a status line on the box', async () => {
    renderMap(fakeFeed(summaryOf([edge(64)])));

    expect(
      await screen.findByText('210/min · 95 ms · 6.1% failed')
    ).toBeInTheDocument();
    expect(
      screen.getByText('6.1% of calls from Website fail')
    ).toBeInTheDocument();
  });

  it('draws nothing for a healthy edge', async () => {
    const { container } = renderMap(fakeFeed(summaryOf([edge(3)])));

    await screen.findByTestId('map-ready');
    expect(screen.queryByText(/failed/)).toBeNull();
    expect(screen.queryByText(/fail$/)).toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders no traffic layers without the prop', async () => {
    const { container } = renderMap();

    await screen.findByTestId('map-ready');
    expect(container.querySelector('[data-traffic-layer]')).toBeNull();
    expect(screen.queryByText(/fail/)).toBeNull();
  });
});
