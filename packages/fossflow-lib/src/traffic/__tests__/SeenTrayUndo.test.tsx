import React from 'react';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeenTray } from 'src/traffic/SeenTray';
import {
  fakeFeed,
  renderCard,
  summaryOf,
  uiActions
} from 'src/traffic/__fixtures__/feed';
import { useModelStore, type ModelStoreWithHistory } from 'src/stores/modelStore';
import { EditorModeEnum } from 'src/types';

// Real stores and scene: the history is what is under test.
let modelState: ModelStoreWithHistory | null = null;
const Probe = () => {
  modelState = useModelStore((state) => state);
  return null;
};

describe('SeenTray undo', () => {
  it('places a box with a missing icon as a single undo step', async () => {
    const summary = summaryOf([
      { caller: 'service:web', callee: 'db:sql.example.net/members', stats: {} }
    ]);
    renderCard(
      <>
        <Probe />
        <SeenTray />
      </>,
      fakeFeed(summary)
    );
    await screen.findByTestId('map-ready');
    act(() => uiActions.current?.setEditorMode(EditorModeEnum.EDITABLE));
    const before = modelState?.history.past.length ?? 0;
    expect(modelState?.icons.some((i) => i.id === 'hairline-database')).toBe(false);

    await userEvent.click(
      await screen.findByRole('button', { name: /Seen, not on the map/ })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Place' }));

    expect(modelState?.items.some((i) => i.icon === 'hairline-database')).toBe(true);
    expect(modelState?.history.past.length).toBe(before + 1);

    act(() => {
      modelState?.actions.undo();
    });
    expect(modelState?.items.some((i) => i.icon === 'hairline-database')).toBe(false);
    expect(modelState?.history.past.length).toBe(before);
  });
});
