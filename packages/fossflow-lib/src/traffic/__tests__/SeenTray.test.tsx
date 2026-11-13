import React from 'react';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeenTray } from 'src/traffic/SeenTray';
import {
  fakeFeed,
  renderCard,
  summaryOf,
  uiActions
} from 'src/traffic/__fixtures__/feed';
import { EditorModeEnum } from 'src/types';

const mockScene = {
  items: [] as unknown[],
  textBoxes: [] as unknown[],
  rectangles: [] as unknown[],
  connectors: [] as unknown[],
  colors: [{ id: 'c', value: '#aaaaff' }],
  placeIcon: jest.fn(),
  createConnector: jest.fn()
};

jest.mock('src/hooks/useScene', () => ({
  useScene: () => mockScene
}));

const summary = summaryOf([
  { caller: 'service:web', callee: 'service:app', stats: { calls: 30 } },
  { caller: 'service:app', callee: 'db:sql.example.net/members', stats: { calls: 12 } }
]);

const mount = async (
  feed = fakeFeed(summary),
  mode: keyof typeof EditorModeEnum = EditorModeEnum.EDITABLE
) => {
  const result = renderCard(<SeenTray />, feed);
  await screen.findByTestId('map-ready');
  act(() => uiActions.current?.setEditorMode(mode));
  return result;
};

const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Seen, not on the map/ }));
};

beforeEach(() => {
  mockScene.placeIcon.mockClear();
  mockScene.createConnector.mockClear();
});

describe('SeenTray', () => {
  it('counts what is seen but not on the map', async () => {
    await mount();
    expect(
      await screen.findByRole('button', { name: 'Seen, not on the map · 2' })
    ).toBeInTheDocument();
  });

  it('places an identity as a box bound to it, with the database icon', async () => {
    await mount();
    await open();
    const row = screen.getByText('db:sql.example.net/members').closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Place' }));
    expect(mockScene.placeIcon).toHaveBeenCalledTimes(1);
    const { modelItem, viewItem } = mockScene.placeIcon.mock.calls[0][0];
    expect(modelItem).toMatchObject({
      name: 'sql.example.net/members',
      icon: 'hairline-database',
      traffic: { ids: ['db:sql.example.net/members'] }
    });
    expect(viewItem.id).toBe(modelItem.id);
    expect(viewItem.tile).toEqual({ x: 0, y: 0 });
  });

  it('draws an arrow between two placed boxes', async () => {
    await mount();
    await open();
    const row = screen.getByText(/Website/).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Draw arrow' }));
    expect(mockScene.createConnector).toHaveBeenCalledTimes(1);
    const connector = mockScene.createConnector.mock.calls[0][0];
    expect(connector.color).toBe('c');
    expect(connector.anchors.map((a: { ref: { item: string } }) => a.ref.item)).toEqual([
      'web',
      'app'
    ]);
  });

  it('renders nothing without a summary', async () => {
    await mount(fakeFeed(undefined));
    expect(screen.queryByRole('button', { name: /Seen, not on the map/ })).toBeNull();
  });

  it('is absent in the read-only mode', async () => {
    await mount(fakeFeed(summary), EditorModeEnum.EXPLORABLE_READONLY);
    expect(screen.queryByRole('button', { name: /Seen, not on the map/ })).toBeNull();
  });
});
