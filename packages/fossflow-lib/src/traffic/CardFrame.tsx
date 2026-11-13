import React from 'react';
import { Box } from '@mui/material';
import { LIVE_TOKENS } from 'src/live/tokens';
import { useTranslation } from 'src/stores/localeStore';
import type { Coords } from 'src/types';
import { formatMs, formatPct, formatRate } from './format';
import type { TrafficStats } from './types';

export const CARD_WIDTH = 280;
/** The card sits right of its anchor; offsets are in scene pixels. */
const CARD_LEFT_GAP = 64;
const CARD_TOP = -48;
const JOIN_Y = 26;

export const sectionSx = {
  py: '6px',
  borderTop: `1px solid ${LIVE_TOKENS.hairline}`
} as const;

export const captionSx = {
  fontFamily: LIVE_TOKENS.mono,
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: LIVE_TOKENS.mute
} as const;

interface CardFrameProps {
  /** Scene position the leader line starts from. */
  anchor: Coords;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** A hairline card on a leader line, with a title row and a close button. */
export const CardFrame = ({ anchor, title, onClose, children }: CardFrameProps) => {
  const { t } = useTranslation('traffic');
  const card = { x: anchor.x + CARD_LEFT_GAP, y: anchor.y + CARD_TOP };
  const joinY = card.y + JOIN_Y;
  const top = Math.min(anchor.y, joinY) - 3;
  const height = Math.abs(joinY - anchor.y) + 6;
  const width = CARD_LEFT_GAP + 3;

  return (
    <>
      <svg
        style={{
          position: 'absolute',
          left: anchor.x,
          top,
          overflow: 'visible',
          pointerEvents: 'none'
        }}
        width={width}
        height={height}
        aria-hidden
      >
        <polyline
          points={`0,${anchor.y - top} ${CARD_LEFT_GAP / 2},${anchor.y - top} ${CARD_LEFT_GAP / 2},${joinY - top} ${CARD_LEFT_GAP},${joinY - top}`}
          fill="none"
          stroke={LIVE_TOKENS.hairlineStrong}
          strokeWidth={1}
        />
        <circle cx={0} cy={anchor.y - top} r={2} fill={LIVE_TOKENS.hairlineStrong} />
      </svg>
      <Box
        role="dialog"
        aria-label={title}
        sx={{
          position: 'absolute',
          left: card.x,
          top: card.y,
          width: CARD_WIDTH,
          boxSizing: 'border-box',
          p: '12px 14px',
          bgcolor: LIVE_TOKENS.canvas,
          borderRadius: '8px',
          boxShadow: LIVE_TOKENS.cardShadow,
          fontFamily: LIVE_TOKENS.sans,
          color: LIVE_TOKENS.ink,
          pointerEvents: 'auto',
          userSelect: 'none'
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            mb: '8px'
          }}
        >
          <Box
            sx={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {title}
          </Box>
          <Box
            component="button"
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            sx={{
              flex: 'none',
              border: 0,
              background: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              color: LIVE_TOKENS.mute,
              p: '2px 4px'
            }}
          >
            ×
          </Box>
        </Box>
        {children}
      </Box>
    </>
  );
};

/** Calls/min, failed, median and slowest 5 %, in one hairline row. */
export const StatRow = ({
  stats
}: {
  stats: Pick<TrafficStats, 'callsPerMin' | 'failedPct' | 'p50Ms' | 'p95Ms'>;
}) => {
  const { t } = useTranslation('traffic');
  const cells: [string, string][] = [
    [t('callsPerMin'), formatRate(stats.callsPerMin)],
    [t('failed'), formatPct(stats.failedPct)],
    [t('median'), stats.p50Ms === null ? '–' : formatMs(stats.p50Ms)],
    [t('p95'), stats.p95Ms === null ? '–' : formatMs(stats.p95Ms)]
  ];
  return (
    <Box
      sx={{
        ...sectionSx,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        columnGap: '8px'
      }}
    >
      {cells.map(([label, value]) => (
        <Box key={label}>
          <Box sx={{ ...captionSx, fontSize: 9 }}>{label}</Box>
          <Box
            sx={{
              mt: '2px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.02em'
            }}
          >
            {value}
          </Box>
        </Box>
      ))}
    </Box>
  );
};
