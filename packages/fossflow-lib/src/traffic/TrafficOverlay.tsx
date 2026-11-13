import React, { useMemo } from 'react';
import { PROJECTED_TILE_SIZE } from 'src/config';
import { Chip } from 'src/live/LiveLayer';
import { LIVE_TOKENS } from 'src/live/tokens';
import { useModelStore } from 'src/stores/modelStore';
import { useTranslation } from 'src/stores/localeStore';
import { getTilePosition } from 'src/utils';
import { useScene } from 'src/hooks/useScene';
import type { ViewItem } from 'src/types';
import { fill, formatMs, formatPct, formatRate } from './format';
import { connectorPointsById, pointAlong } from './geometry';
import { boxTrouble, isFailing } from './stats';
import { useTraffic } from './TrafficContext';

/** Below the box's own live chip, when it has one. */
const LIVE_CHIP_HEIGHT = 22;

interface TrafficOverlayProps {
  nodes: ViewItem[];
}

/** A pill on each failing arrow and a status line under each troubled box. */
export const TrafficOverlay = ({ nodes }: TrafficOverlayProps) => {
  const traffic = useTraffic();
  const { t } = useTranslation('traffic');
  const { connectors } = useScene();
  const modelItems = useModelStore((state) => state.items);

  const points = useMemo(() => connectorPointsById(connectors), [connectors]);
  const itemsById = useMemo(
    () => new Map(modelItems.map((item) => [item.id, item])),
    [modelItems]
  );

  if (!traffic) return null;

  const names = new Map(modelItems.map((item) => [item.id, item.name]));

  const pills = [...traffic.arrows.values()].filter(isFailing).flatMap((arrow) => {
    const path = points.get(arrow.connectorId);
    if (!path) return [];
    const parts = [
      formatRate(arrow.callsPerMin),
      ...(arrow.p50Ms === null ? [] : [formatMs(arrow.p50Ms)]),
      fill(t('pillFailed'), { pct: formatPct(arrow.failedPct) })
    ];
    return [{ id: arrow.connectorId, at: pointAlong(path, 0.5), text: parts.join(' · ') }];
  });

  const lines = nodes.flatMap((node) => {
    const trouble = boxTrouble(node.id, traffic, names);
    if (!trouble) return [];
    const pct = formatPct(trouble.failedPct);
    const centre = getTilePosition({ tile: node.tile });
    const lift = itemsById.get(node.id)?.live ? LIVE_CHIP_HEIGHT : 0;
    return [
      {
        id: node.id,
        at: {
          x: centre.x,
          y: centre.y + PROJECTED_TILE_SIZE.height / 2 + 4 + lift
        },
        text: trouble.callerName
          ? fill(t('boxFailingFrom'), { pct, caller: trouble.callerName })
          : fill(t('boxFailingIncoming'), { pct })
      }
    ];
  });

  return (
    <>
      {pills.map((pill) => (
        <Chip key={`arrow-${pill.id}`} at={pill.at} colour={LIVE_TOKENS.criticalDeep}>
          {pill.text}
        </Chip>
      ))}
      {lines.map((line) => (
        <Chip key={`box-${line.id}`} at={line.at} colour={LIVE_TOKENS.criticalDeep}>
          {line.text}
        </Chip>
      ))}
    </>
  );
};
