import { act, fireEvent, screen } from '@testing-library/react';
import {
  detailOf,
  fakeFeed,
  renderMap,
  summaryOf,
  uiActions
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
    expect(
      container.querySelector('polyline:not([data-traffic-hit])')
    ).toBeNull();
  });

  it('renders no traffic layers without the prop', async () => {
    const { container } = renderMap();

    await screen.findByTestId('map-ready');
    expect(container.querySelector('[data-traffic-layer]')).toBeNull();
    expect(screen.queryByText(/fail/)).toBeNull();
  });

  describe('cards', () => {
    const feed = () =>
      fakeFeed(summaryOf([edge(3)]), () => Promise.resolve(detailOf()));

    it('opens the arrow card from its hit area and toggles it closed', async () => {
      const { container } = renderMap(feed());
      await screen.findByTestId('map-ready');
      const hit = container.querySelector('[data-traffic-hit="arrow:arrow"]');
      expect(hit).not.toBeNull();

      fireEvent.click(hit as Element);
      expect(await screen.findByText('Website → Member app')).toBeInTheDocument();

      fireEvent.click(hit as Element);
      expect(screen.queryByText('Website → Member app')).toBeNull();
    });

    it('opens the box card from its hit area and closes on Escape', async () => {
      const { container } = renderMap(feed());
      await screen.findByTestId('map-ready');

      fireEvent.click(
        container.querySelector('[data-traffic-hit="box:web"]') as Element
      );
      expect(await screen.findByText('Identities')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Identities')).toBeNull();
    });

    it('ignores Escape typed into an input', async () => {
      const { container } = renderMap(feed());
      await screen.findByTestId('map-ready');
      fireEvent.click(
        container.querySelector('[data-traffic-hit="box:web"]') as Element
      );
      expect(await screen.findByText('Identities')).toBeInTheDocument();

      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.getByText('Identities')).toBeInTheDocument();

        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByText('Identities')).toBeNull();
      } finally {
        input.remove();
      }
    });

    it('follows the editor selection and draws no hit areas when editable', async () => {
      const { container } = renderMap(feed());
      await screen.findByTestId('map-ready');

      act(() => {
        uiActions.current?.setEditorMode('EDITABLE');
        uiActions.current?.setItemControls({
          type: 'CONNECTOR_GROUP',
          ids: ['arrow'],
          focusedId: 'arrow'
        });
      });

      expect(await screen.findByText('Website → Member app')).toBeInTheDocument();
      expect(container.querySelector('[data-traffic-hit]')).toBeNull();

      act(() => {
        uiActions.current?.setItemControls({ type: 'ITEM', id: 'web' });
      });
      expect(await screen.findByText('Identities')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('Identities')).toBeNull();
    });

    it('opens no arrow card until a connector of the group is focused', async () => {
      renderMap(feed());
      await screen.findByTestId('map-ready');

      act(() => {
        uiActions.current?.setEditorMode('EDITABLE');
        uiActions.current?.setItemControls({
          type: 'CONNECTOR_GROUP',
          ids: ['arrow', 'other'],
          focusedId: null
        });
      });
      expect(screen.queryByText('Website → Member app')).toBeNull();

      act(() => {
        uiActions.current?.setItemControls({
          type: 'CONNECTOR_GROUP',
          ids: ['arrow', 'other'],
          focusedId: 'arrow'
        });
      });
      expect(await screen.findByText('Website → Member app')).toBeInTheDocument();
    });
  });
});
