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
import { ArrowCard } from './ArrowCard';
import { BoxCard } from './BoxCard';
import { boxOf } from './match';
import { boxTrouble, isFailing } from './stats';
import { useTraffic } from './TrafficContext';
import { useTrafficSelection } from './useTrafficSelection';

const ARROW_HIT_WIDTH = 16;
const BOX_HIT_RADIUS = 24;

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
  const { selection, select, close, readOnly } = useTrafficSelection();

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

  const toggle = (next: NonNullable<typeof selection>) => {
    const same =
      selection?.type === next.type &&
      (selection.type === 'arrow'
        ? selection.connectorId === (next as typeof selection).connectorId
        : selection.itemId === (next as typeof selection).itemId);
    if (same) close();
    else select(next);
  };

  const hitArrows = readOnly
    ? [...traffic.arrows.keys()].flatMap((connectorId) => {
        const path = points.get(connectorId);
        return path ? [{ connectorId, path }] : [];
      })
    : [];
  const hitBoxes = readOnly
    ? nodes.filter((node) =>
        traffic.index.boxes.some((box) => box.itemId === node.id)
      )
    : [];

  const openArrow =
    selection?.type === 'arrow' ? traffic.arrows.get(selection.connectorId) : undefined;
  const openArrowPath = openArrow ? points.get(openArrow.connectorId) : undefined;
  const openBox =
    selection?.type === 'box'
      ? nodes.find((node) => node.id === selection.itemId)
      : undefined;
  const boxName = (identity: string): string => {
    const id = boxOf(traffic.index, identity);
    return (id && names.get(id)) || identity;
  };

  return (
    <>
      {(hitArrows.length > 0 || hitBoxes.length > 0) && (
        <svg
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            overflow: 'visible',
            pointerEvents: 'none'
          }}
          width={1}
          height={1}
        >
          {hitArrows.map(({ connectorId, path }) => (
            <polyline
              key={`hit-arrow-${connectorId}`}
              data-traffic-hit={`arrow:${connectorId}`}
              points={path.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="transparent"
              strokeWidth={ARROW_HIT_WIDTH}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={() => toggle({ type: 'arrow', connectorId })}
            />
          ))}
          {hitBoxes.map((node) => {
            const centre = getTilePosition({ tile: node.tile });
            return (
              <circle
                key={`hit-box-${node.id}`}
                data-traffic-hit={`box:${node.id}`}
                cx={centre.x}
                cy={centre.y}
                r={BOX_HIT_RADIUS}
                fill="transparent"
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onClick={() => toggle({ type: 'box', itemId: node.id })}
              />
            );
          })}
        </svg>
      )}
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
      {openArrow && openArrowPath && (
        <ArrowCard
          arrow={openArrow}
          anchor={pointAlong(openArrowPath, 0.5)}
          title={`${boxName(openArrow.pairs[0].caller)} → ${boxName(openArrow.pairs[0].callee)}`}
          onClose={close}
        />
      )}
      {openBox && (
        <BoxCard
          itemId={openBox.id}
          anchor={getTilePosition({ tile: openBox.tile })}
          onClose={close}
        />
      )}
    </>
  );
};
