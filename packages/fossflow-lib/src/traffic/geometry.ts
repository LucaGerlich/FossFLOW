import type { Coords } from 'src/types';
import { connectorPathTileToGlobal, getTilePosition } from 'src/utils';

/** Scene positions of a connector's path tiles, placed as ConnectorLabel does. */
export const connectorScenePoints = (
  tiles: Coords[],
  origin: Coords
): Coords[] =>
  tiles.map((tile) =>
    getTilePosition({ tile: connectorPathTileToGlobal(tile, origin) })
  );

/** The point `progress` (0–1, clamped) of the way along the path by length. */
export const pointAlong = (points: Coords[], progress: number): Coords => {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const t = Math.min(1, Math.max(0, progress));
  const lengths = points.slice(1).map((point, i) =>
    Math.hypot(point.x - points[i].x, point.y - points[i].y)
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return points[0];

  let remaining = t * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] === 0 ? 0 : Math.min(1, remaining / lengths[i]);
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio
      };
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
};

/** Scene points of every connector by id; connectors without a path are left out. */
export const connectorPointsById = (
  connectors: { id: string; path?: { tiles: Coords[]; rectangle: { from: Coords } } }[]
): Map<string, Coords[]> => {
  const points = new Map<string, Coords[]>();
  for (const connector of connectors) {
    if (!connector.path) continue;
    points.set(
      connector.id,
      connectorScenePoints(connector.path.tiles, connector.path.rectangle.from)
    );
  }
  return points;
};
