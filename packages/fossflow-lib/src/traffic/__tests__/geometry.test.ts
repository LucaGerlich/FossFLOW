import { pointAlong, connectorScenePoints } from 'src/traffic/geometry';
import { connectorPathTileToGlobal, getTilePosition } from 'src/utils';

describe('pointAlong', () => {
  it('finds the midpoint of a two-point line', () => {
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 20 }], 0.5)).toEqual({
      x: 5,
      y: 10
    });
  });

  it('lands on the second segment of an L-shaped path', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 3 }
    ];
    // total length 4, half is 2: one unit into the 3-long second segment
    expect(pointAlong(path, 0.5)).toEqual({ x: 1, y: 1 });
  });

  it('clamps progress to the ends', () => {
    const path = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
    expect(pointAlong(path, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(path, 2)).toEqual({ x: 4, y: 0 });
  });

  it('returns a single point as is', () => {
    expect(pointAlong([{ x: 3, y: 7 }], 0.5)).toEqual({ x: 3, y: 7 });
  });
});

describe('connectorScenePoints', () => {
  it('maps tiles through the connector origin and the tile projection', () => {
    const origin = { x: 5, y: 5 };
    const tiles = [{ x: 0, y: 0 }, { x: 1, y: 2 }];
    const expected = tiles.map((tile) =>
      getTilePosition({ tile: connectorPathTileToGlobal(tile, origin) })
    );
    expect(connectorScenePoints(tiles, origin)).toEqual(expected);
  });
});
