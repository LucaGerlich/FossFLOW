import React from 'react';
import { screen } from '@testing-library/react';
import { BoxCard } from 'src/traffic/BoxCard';
import {
  fakeFeed,
  renderCard,
  stats,
  summaryOf,
  twoBoxModel
} from 'src/traffic/__fixtures__/feed';
import type { InitialData } from 'src/types';

const modelWith = (ids: string[]): InitialData => ({
  ...twoBoxModel,
  items: [
    { id: 'web', name: 'Website', traffic: { ids } },
    { id: 'app', name: 'Member app', traffic: { ids: ['service:app'] } }
  ]
});

const card = (summary: ReturnType<typeof summaryOf>, ids: string[]) =>
  renderCard(
    <BoxCard itemId="web" anchor={{ x: 0, y: 0 }} onClose={jest.fn()} />,
    fakeFeed(summary),
    modelWith(ids)
  );

describe('BoxCard', () => {
  it('shows the incoming numbers of a service box', async () => {
    card(
      {
        ...summaryOf([]),
        services: [
          {
            service: 'service:billing',
            ...stats({ callsPerMin: 42, failures: 5, failedPct: 5, p50Ms: 30, p95Ms: 800 })
          }
        ]
      },
      ['service:billing']
    );

    expect(await screen.findByText('Incoming')).toBeInTheDocument();
    expect(screen.getByText('42/min')).toBeInTheDocument();
    expect(screen.getByText('30 ms')).toBeInTheDocument();
    expect(screen.getByText('800 ms')).toBeInTheDocument();
    expect(screen.getByText('service:billing')).toBeInTheDocument();
  });

  it('sums the callees a wildcard identity matches', async () => {
    card(
      {
        ...summaryOf([]),
        callees: [
          { callee: 'host:a.magicline.com', ...stats({ calls: 100, failures: 2, callsPerMin: 10, p50Ms: 20, p95Ms: 100 }) },
          { callee: 'host:b.magicline.com', ...stats({ calls: 300, failures: 6, callsPerMin: 30, p50Ms: 40, p95Ms: 500 }) },
          { callee: 'host:other.com', ...stats({ callsPerMin: 999 }) }
        ]
      },
      ['host:*.magicline.com']
    );

    expect(await screen.findByText('Seen by callers')).toBeInTheDocument();
    expect(screen.getByText('40/min')).toBeInTheDocument();
    expect(screen.getByText('2.0%')).toBeInTheDocument();
    expect(screen.getByText('40 ms')).toBeInTheDocument();
    expect(screen.getByText('500 ms')).toBeInTheDocument();
    expect(screen.getByText('host:*.magicline.com')).toBeInTheDocument();
  });

  it('says so when nothing was called in the window', async () => {
    card(summaryOf([]), ['service:quiet']);

    expect(
      await screen.findByText('No calls in the last 5 minutes')
    ).toBeInTheDocument();
    expect(screen.getByText('service:quiet')).toBeInTheDocument();
  });

  it('lists every identity of the box', async () => {
    card(summaryOf([]), ['service:web', 'host:web.internal', 'db:srv/main']);

    expect(await screen.findByText('Identities')).toBeInTheDocument();
    for (const id of ['service:web', 'host:web.internal', 'db:srv/main']) {
      expect(screen.getByText(id)).toBeInTheDocument();
    }
  });
});
