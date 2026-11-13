import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { ArrowCard } from 'src/traffic/ArrowCard';
import type { ArrowTraffic } from 'src/traffic/stats';
import { useTraffic } from 'src/traffic/TrafficContext';
import type { TrafficEdgeDetail } from 'src/traffic/types';
import {
  detailOf,
  fakeFeed,
  renderCard,
  summaryOf
} from 'src/traffic/__fixtures__/feed';

const pairs = [{ caller: 'service:web', callee: 'service:app' }];
const arrow: ArrowTraffic = {
  connectorId: 'arrow',
  pairs,
  callers: ['service:web'],
  calls: 100,
  failures: 4,
  callsPerMin: 210,
  failedPct: 4,
  p50Ms: 95,
  p95Ms: 1200
};

const feedWith = (loadEdge: jest.Mock<Promise<TrafficEdgeDetail>>) =>
  fakeFeed(summaryOf([]), loadEdge);

const open = (
  loadEdge: jest.Mock<Promise<TrafficEdgeDetail>>,
  weight?: number
) => {
  const onClose = jest.fn();
  const Card = () => {
    // The animation loop writes weights without rendering; read at render time.
    if (weight !== undefined) useTraffic()?.weights.set('arrow', weight);
    return (
      <ArrowCard
        arrow={arrow}
        anchor={{ x: 0, y: 0 }}
        title="Website → Member app"
        onClose={onClose}
      />
    );
  };
  return { onClose, ...renderCard(<Card />, feedWith(loadEdge)) };
};

describe('ArrowCard', () => {
  it('loads the arrow pairs for the last hour on open', async () => {
    const loadEdge = jest.fn().mockResolvedValue(detailOf());
    open(loadEdge);

    expect(await screen.findByText('Website → Member app')).toBeInTheDocument();
    expect(loadEdge).toHaveBeenCalledWith(pairs, '1h');
    expect(screen.getByText('As seen by service:web')).toBeInTheDocument();
    expect(screen.getByText('210/min')).toBeInTheDocument();
    expect(screen.getByText('4.0%')).toBeInTheDocument();
    expect(screen.getByText('95 ms')).toBeInTheDocument();
    expect(screen.getByText('1.2 s')).toBeInTheDocument();
  });

  it('renders the busiest calls and recent failures', async () => {
    const loadEdge = jest.fn().mockResolvedValue(
      detailOf({
        operations: [
          { operation: 'GET /members', calls: 80, failures: 0, p50Ms: 40, p95Ms: 90 },
          { operation: 'POST /checkin', calls: 20, failures: 4, p50Ms: 60, p95Ms: 300 }
        ],
        failures: [
          {
            at: '2026-01-01T10:15:30Z',
            caller: 'service:web',
            callee: 'service:app',
            operation: 'POST /checkin',
            status: '503',
            durationMs: 2100
          }
        ]
      })
    );
    open(loadEdge);

    expect(await screen.findByText('GET /members')).toBeInTheDocument();
    expect(screen.getAllByText('POST /checkin')).toHaveLength(2);
    expect(screen.getByText('503')).toBeInTheDocument();
    expect(screen.getByText('2.1 s')).toBeInTheDocument();
  });

  it('reloads for another range', async () => {
    const loadEdge = jest.fn().mockResolvedValue(detailOf());
    open(loadEdge);
    await screen.findByText('Website → Member app');

    fireEvent.click(screen.getByRole('button', { name: '24h' }));

    expect(loadEdge).toHaveBeenLastCalledWith(pairs, '24h');
    await screen.findByText('No failures');
  });

  it('shows a generic error when loading fails', async () => {
    const loadEdge = jest.fn().mockRejectedValue(new Error('boom: secret'));
    open(loadEdge);

    expect(await screen.findByText('Could not load traffic')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('marks a bar failing from 5 % failed calls', async () => {
    const loadEdge = jest.fn().mockResolvedValue(
      detailOf({
        series: [
          { at: '2026-01-01T10:00:00Z', calls: 20, failures: 3, p95Ms: 10 },
          { at: '2026-01-01T10:01:00Z', calls: 100, failures: 1, p95Ms: 10 }
        ]
      })
    );
    const { container } = open(loadEdge);

    await screen.findByText('No failures');
    const bars = container.querySelectorAll('[data-bar]');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('data-failing', 'true');
    expect(bars[1]).not.toHaveAttribute('data-failing', 'true');
  });

  it('explains thinned dots when the weight is above one', async () => {
    const loadEdge = jest.fn().mockResolvedValue(detailOf());
    open(loadEdge, 12);

    expect(await screen.findByText('1 dot ≈ 12 calls')).toBeInTheDocument();
  });

  it('says nothing about dots at weight one', async () => {
    const loadEdge = jest.fn().mockResolvedValue(detailOf());
    open(loadEdge, 1);

    await screen.findByText('Website → Member app');
    expect(screen.queryByText(/1 dot/)).toBeNull();
  });

  it('closes from the close button', async () => {
    const loadEdge = jest.fn().mockResolvedValue(detailOf());
    const { onClose } = open(loadEdge);
    await screen.findByText('Website → Member app');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('refreshes every 15 seconds while open', async () => {
    jest.useFakeTimers();
    try {
      const loadEdge = jest.fn().mockResolvedValue(detailOf());
      open(loadEdge);
      await screen.findByText('Website → Member app');
      expect(loadEdge).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(15000);
      });

      expect(loadEdge).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
