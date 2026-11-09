import { MAX_ZOOM, MIN_ZOOM } from 'src/config';
import type { View } from 'src/types';
import { getFitToViewParams } from '../renderer';

const view = (items: View['items'] = []): View => ({
  id: 'v1',
  name: 'View',
  items,
  connectors: [],
  rectangles: [],
  textBoxes: []
});

const isUsable = ({ zoom, scroll }: ReturnType<typeof getFitToViewParams>) =>
  Number.isFinite(zoom) &&
  zoom >= MIN_ZOOM &&
  zoom <= MAX_ZOOM &&
  Number.isFinite(scroll.x) &&
  Number.isFinite(scroll.y);

describe('getFitToViewParams', () => {
  test('fits a view with items into a measured viewport', () => {
    const params = getFitToViewParams(view([{ id: 'a', tile: { x: 2, y: 3 } }]), {
      width: 1400,
      height: 800
    });
    expect(isUsable(params)).toBe(true);
  });

  test('handles an empty view', () => {
    expect(isUsable(getFitToViewParams(view(), { width: 1400, height: 800 }))).toBe(true);
  });

  test('never returns zoom 0 for a viewport that is not measured yet', () => {
    // A zero zoom makes every mouse position NaN, so dropped items get no tile.
    const params = getFitToViewParams(view([{ id: 'a', tile: { x: 2, y: 3 } }]), {
      width: 0,
      height: 0
    });
    expect(isUsable(params)).toBe(true);
  });
});
