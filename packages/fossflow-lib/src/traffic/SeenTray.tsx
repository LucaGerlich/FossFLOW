import React, { useMemo, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { HAIRLINE_ICONS, HAIRLINE_ICON_IDS } from 'src/live/hairlineIcons';
import { LIVE_TOKENS } from 'src/live/tokens';
import { useScene } from 'src/hooks/useScene';
import { useModelStore } from 'src/stores/modelStore';
import { useTranslation } from 'src/stores/localeStore';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { EditorModeEnum, type Coords, type Icon } from 'src/types';
import { VIEW_ITEM_DEFAULTS } from 'src/config';
import { generateId } from 'src/utils/common';
import { trafficIdentity } from 'src/schemas/common';
import { screenToIso } from 'src/utils/renderer';
import { findNearestUnoccupiedTile } from 'src/utils/findNearestUnoccupiedTile';
import { fill } from './format';
import { seenEntries } from './seen';
import { useTraffic } from './TrafficContext';
import { captionSx } from './CardFrame';

const MAX_NAME = 100;

const ICON_FOR_PREFIX: Record<string, string> = {
  service: HAIRLINE_ICON_IDS.container,
  host: HAIRLINE_ICON_IDS.globe,
  db: HAIRLINE_ICON_IDS.database
};

const splitIdentity = (identity: string): { prefix: string; name: string } => {
  const at = identity.indexOf(':');
  return { prefix: identity.slice(0, at), name: identity.slice(at + 1) };
};

const boxName = (identity: string): string => {
  const { name } = splitIdentity(identity);
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
};

const chipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  px: '12px',
  height: 28,
  whiteSpace: 'nowrap',
  borderRadius: '14px',
  border: `1px solid ${LIVE_TOKENS.hairlineStrong}`,
  background: LIVE_TOKENS.canvas,
  boxShadow: LIVE_TOKENS.cardShadow,
  fontFamily: LIVE_TOKENS.mono,
  fontSize: 11,
  color: LIVE_TOKENS.ink
} as const;

const actionSx = {
  flex: '0 0 auto',
  px: '8px',
  height: 22,
  borderRadius: '11px',
  border: `1px solid ${LIVE_TOKENS.hairlineStrong}`,
  fontFamily: LIVE_TOKENS.sans,
  fontSize: 11,
  color: LIVE_TOKENS.ink
} as const;

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  py: '4px'
} as const;

const labelSx = {
  fontFamily: LIVE_TOKENS.mono,
  fontSize: 11,
  color: LIVE_TOKENS.ink,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const;

/**
 * Bottom-right tray listing what carries traffic but is not on the map yet,
 * with one click to place a box or draw the missing arrow. Editors only.
 */
export const SeenTray = () => {
  const { t } = useTranslation('traffic');
  const traffic = useTraffic();
  const scene = useScene();
  const items = useModelStore((state) => state.items);
  const icons = useModelStore((state) => state.icons);
  const modelActions = useModelStore((state) => state.actions);
  const editorMode = useUiStateStore((state) => state.editorMode);
  const zoom = useUiStateStore((state) => state.zoom);
  const scroll = useUiStateStore((state) => state.scroll);
  const rendererEl = useUiStateStore((state) => state.rendererEl);
  const [open, setOpen] = useState(false);

  const summary = traffic?.feed.summary;
  const index = traffic?.index;
  const { connectors } = scene;
  const entries = useMemo(
    () =>
      summary && index ? seenEntries(summary, index, connectors) : null,
    [summary, index, connectors]
  );

  if (editorMode !== EditorModeEnum.EDITABLE || !entries) return null;
  const { unplaced, unconnected } = entries;
  const total = unplaced.length + unconnected.length;
  if (total === 0) return null;

  const viewportCentreTile = (): Coords => {
    if (!rendererEl) return { x: 0, y: 0 };
    const { width, height } = rendererEl.getBoundingClientRect();
    return screenToIso({
      mouse: { x: width / 2, y: height / 2 },
      zoom,
      scroll,
      rendererSize: { width, height }
    });
  };

  const place = (identity: string): void => {
    const iconId = ICON_FOR_PREFIX[splitIdentity(identity).prefix];
    if (!iconId || !trafficIdentity.safeParse(identity).success) return;
    // skipHistory: the snapshot placeIcon takes is the placement's only undo step.
    if (!icons.some((icon) => icon.id === iconId)) {
      const icon = HAIRLINE_ICONS.find((candidate) => candidate.id === iconId);
      if (icon) modelActions.set({ icons: [...icons, icon as Icon] }, true);
    }
    const centre = viewportCentreTile();
    const id = generateId();
    scene.placeIcon({
      modelItem: {
        id,
        name: boxName(identity),
        icon: iconId,
        traffic: { ids: [identity] }
      },
      viewItem: {
        id,
        tile: findNearestUnoccupiedTile(centre, scene) ?? centre,
        labelHeight: VIEW_ITEM_DEFAULTS.labelHeight
      }
    });
  };

  const drawArrow = (from: string, to: string): void => {
    scene.createConnector({
      id: generateId(),
      color: scene.colors[0].id,
      anchors: [
        { id: generateId(), ref: { item: from } },
        { id: generateId(), ref: { item: to } }
      ]
    });
  };

  const nameOf = (itemId: string): string =>
    items.find((item) => item.id === itemId)?.name ?? itemId;

  return (
    <Box sx={{ position: 'relative' }}>
      {open && (
        <Box
          role="region"
          aria-label={t('seenTitle')}
          sx={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 8px)',
            width: 300,
            maxHeight: 360,
            overflowY: 'auto',
            p: '8px 12px',
            borderRadius: '8px',
            border: `1px solid ${LIVE_TOKENS.hairline}`,
            background: LIVE_TOKENS.canvas,
            boxShadow: LIVE_TOKENS.cardShadow
          }}
        >
          {unplaced.length > 0 && (
            <Box component="section">
              <Box sx={{ ...captionSx, mb: '4px' }}>{t('unplacedTitle')}</Box>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {unplaced.map((entry) => (
                  <Box component="li" key={entry.identity} sx={rowSx}>
                    <Box sx={labelSx} title={entry.identity}>
                      {entry.identity}
                    </Box>
                    <ButtonBase
                      sx={actionSx}
                      onClick={() => place(entry.identity)}
                    >
                      {t('place')}
                    </ButtonBase>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {unconnected.length > 0 && (
            <Box
              component="section"
              sx={
                unplaced.length > 0
                  ? { mt: '8px', pt: '6px', borderTop: `1px solid ${LIVE_TOKENS.hairline}` }
                  : undefined
              }
            >
              <Box sx={{ ...captionSx, mb: '4px' }}>{t('unconnectedTitle')}</Box>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {unconnected.map((entry) => (
                  <Box
                    component="li"
                    key={`${entry.fromItemId}>${entry.toItemId}`}
                    sx={rowSx}
                  >
                    <Box sx={labelSx}>
                      {nameOf(entry.fromItemId)} → {nameOf(entry.toItemId)}
                    </Box>
                    <ButtonBase
                      sx={actionSx}
                      onClick={() => drawArrow(entry.fromItemId, entry.toItemId)}
                    >
                      {t('drawArrow')}
                    </ButtonBase>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
      <ButtonBase
        sx={chipSx}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {fill(t('seenCount'), { n: String(total) })}
      </ButtonBase>
    </Box>
  );
};
