import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@emotion/react';
import { PROJECTED_TILE_SIZE } from 'src/config';
import { useModelStore } from 'src/stores/modelStore';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { useTranslation } from 'src/stores/localeStore';
import { getTilePosition } from 'src/utils';
import type { Coords, Icon, ModelItem, ViewItem } from 'src/types';
import { useLiveIndex } from './LiveContext';
import { getHairlineStatusOffset } from './hairlineIcons';
import { formatMemoryMb, formatPercent } from './format';
import { resolveLive, type LiveEntity } from './status';
import { LIVE_TOKENS, STATUS_COLOR, STATUS_TEXT } from './tokens';
import { VitalsCard } from './VitalsCard';

const pulse = keyframes`
  from { transform: scale(1); opacity: 0.85; }
  to { transform: scale(3.2); opacity: 0; }
`;

/** Where a non-hairline icon gets its status light: above the tile centre. */
const FALLBACK_LIGHT_OFFSET: Coords = {
  x: 0,
  y: -PROJECTED_TILE_SIZE.height * 0.75
};

const StatusLight = ({ at, entity }: { at: Coords; entity: LiveEntity }) => {
  const colour = STATUS_COLOR[entity.status];
  const alarming = entity.status === 'warning' || entity.status === 'critical';
  const light = {
    width: 8,
    height: 5,
    borderRadius: '50%',
    position: 'absolute' as const
  };
  return (
    <Box
      sx={{
        position: 'absolute',
        left: at.x - 4,
        top: at.y - 2.5,
        pointerEvents: 'none'
      }}
    >
      {alarming && (
        <Box
          sx={{
            ...light,
            border: `1px solid ${colour}`,
            animation: `${pulse} 1.8s ease-out infinite`
          }}
        />
      )}
      <Box
        sx={{
          ...light,
          bgcolor: colour,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.9)'
        }}
      />
    </Box>
  );
};

export const Chip = ({
  at,
  children,
  colour
}: {
  at: Coords;
  children: React.ReactNode;
  colour: string;
}) => (
  <Box
    sx={{
      position: 'absolute',
      left: at.x,
      top: at.y,
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      px: '6px',
      py: '1px',
      whiteSpace: 'nowrap',
      fontFamily: LIVE_TOKENS.mono,
      fontSize: 10,
      lineHeight: '16px',
      color: colour,
      bgcolor: 'rgba(255,255,255,0.92)',
      border: `1px solid ${LIVE_TOKENS.hairline}`,
      borderRadius: '4px',
      pointerEvents: 'none',
      userSelect: 'none'
    }}
  >
    {children}
  </Box>
);

const UpdateTag = ({ label }: { label: string }) => (
  <Box
    component="span"
    sx={{
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: LIVE_TOKENS.body,
      border: `1px solid ${LIVE_TOKENS.hairlineStrong}`,
      borderRadius: '999px',
      px: '5px',
      lineHeight: '12px'
    }}
  >
    {label}
  </Box>
);

interface NodeOverlayProps {
  node: ViewItem;
  modelItem: ModelItem;
  icon: Icon | undefined;
  entity: LiveEntity;
  selected: boolean;
}

const NodeOverlay = ({
  node,
  modelItem,
  icon,
  entity,
  selected
}: NodeOverlayProps) => {
  const { t } = useTranslation('live');
  const centre = getTilePosition({ tile: node.tile });
  const scale = icon?.scale ?? 1;
  const offset =
    getHairlineStatusOffset(modelItem.icon) ?? FALLBACK_LIGHT_OFFSET;
  const light = {
    x: centre.x + offset.x * scale,
    y: centre.y + offset.y * scale
  };
  const chipAt = {
    x: centre.x,
    y: centre.y + PROJECTED_TILE_SIZE.height / 2 + 4
  };

  let text: string;
  let update = false;
  if (entity.type === 'system') {
    if (!entity.system) text = t('unknown');
    else if (entity.system.state === 'down') text = t('down');
    else {
      const { cpu, memory, disk } = entity.system.vitals;
      text = `${t('cpu')} ${formatPercent(cpu)} · ${t('memory')} ${formatPercent(memory)} · ${t('disk')} ${formatPercent(disk)}`;
    }
  } else if (!entity.container) {
    text = entity.status === 'stopped' ? t('stopped') : t('unknown');
  } else {
    const { cpu, memoryMb, health, updateAvailable } = entity.container;
    const usage = `${formatPercent(cpu)} · ${formatMemoryMb(memoryMb)}`;
    const prefix =
      health === 'unhealthy'
        ? `${t('unhealthy')} · `
        : health === 'starting'
          ? `${t('starting')} · `
          : '';
    text = prefix + usage;
    update = updateAvailable;
  }

  const showCard =
    entity.type === 'system' &&
    entity.system !== null &&
    (selected || entity.status === 'warning' || entity.status === 'critical');

  return (
    <>
      <StatusLight at={light} entity={entity} />
      <Chip at={chipAt} colour={STATUS_TEXT[entity.status]}>
        {text}
        {update && <UpdateTag label={t('update')} />}
      </Chip>
      {showCard && entity.type === 'system' && entity.system && (
        <VitalsCard system={entity.system} anchor={centre} />
      )}
    </>
  );
};

interface LiveLayerProps {
  nodes: ViewItem[];
}

/** Live status drawn over bound nodes. Renders nothing without live data. */
export const LiveLayer = ({ nodes }: LiveLayerProps) => {
  const index = useLiveIndex();
  const modelItems = useModelStore((state) => state.items);
  const icons = useModelStore((state) => state.icons);
  const selectedId = useUiStateStore((state) =>
    state.itemControls &&
    'id' in state.itemControls &&
    state.itemControls.type === 'ITEM'
      ? state.itemControls.id
      : null
  );

  const bound = useMemo(() => {
    if (!index) return [];
    const itemsById = new Map(modelItems.map((item) => [item?.id, item]));
    const iconsById = new Map(icons.map((icon) => [icon.id, icon]));
    return nodes.flatMap((node) => {
      const modelItem = itemsById.get(node.id);
      if (!modelItem?.live) return [];
      return [
        {
          node,
          modelItem,
          icon: modelItem.icon ? iconsById.get(modelItem.icon) : undefined,
          entity: resolveLive(index, modelItem.live.key)
        }
      ];
    });
  }, [index, modelItems, icons, nodes]);

  return (
    <>
      {bound.map(({ node, modelItem, icon, entity }) => (
        <NodeOverlay
          key={node.id}
          node={node}
          modelItem={modelItem}
          icon={icon}
          entity={entity}
          selected={selectedId === node.id}
        />
      ))}
    </>
  );
};
