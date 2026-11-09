import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'src/stores/localeStore';
import type { Coords } from 'src/types';
import { formatBytesPerSec, formatPercent, formatUptime } from './format';
import {
  LIVE_TOKENS,
  STATUS_COLOR,
  VITAL_CRITICAL,
  VITAL_WARNING
} from './tokens';
import type { LiveSystem } from './types';

const CARD_WIDTH = 216;
/**
 * The card sits left of the server: auto-placed servers occupy the left
 * corner of their plate, so that side is free (plates leave a gap for it).
 * Offsets are from the server's tile centre, in scene pixels.
 */
const CARD_RIGHT_GAP = 72;
const CARD_TOP = -196; // bottom clears the server's metric chip
const LEADER_START = { x: -44, y: -18 };

const valueColour = (value: number): string => {
  if (value >= VITAL_CRITICAL) return LIVE_TOKENS.criticalDeep;
  if (value >= VITAL_WARNING) return LIVE_TOKENS.warningDeep;
  return LIVE_TOKENS.ink;
};

const Sparkline = ({ values }: { values: number[] }) => {
  const width = 64;
  const height = 16;
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(10, hi - lo);
  const base = lo - (span - (hi - lo)) / 2;
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 1 - ((value - base) / span) * (height - 2)
  ]);
  const last = points[points.length - 1] as number[];
  return (
    <svg
      width={width}
      height={height}
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      <polyline
        points={points
          .map(([x, y]) => `${x?.toFixed(1)},${y?.toFixed(1)}`)
          .join(' ')}
        fill="none"
        stroke={LIVE_TOKENS.ink}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={1.6} fill={LIVE_TOKENS.ink} />
    </svg>
  );
};

interface VitalsCardProps {
  system: LiveSystem;
  /** Scene position of the server's tile centre. */
  anchor: Coords;
}

/** Vitals for one server: a card on a leader line beside its node. */
export const VitalsCard = ({ system, anchor }: VitalsCardProps) => {
  const { t } = useTranslation('live');
  const { vitals, history } = system;
  const degraded = system.status === 'warning' || system.status === 'critical';
  const lineColour = degraded
    ? STATUS_COLOR[system.status]
    : LIVE_TOKENS.hairlineStrong;

  const start = { x: anchor.x + LEADER_START.x, y: anchor.y + LEADER_START.y };
  const card = {
    x: anchor.x - CARD_RIGHT_GAP - CARD_WIDTH,
    y: anchor.y + CARD_TOP
  };
  const cardRight = card.x + CARD_WIDTH;
  const joinY = card.y + 26;
  const elbowX = start.x - 14;
  const svgLeft = cardRight - 3;
  const svgTop = Math.min(start.y, joinY) - 3;
  const svgHeight = Math.abs(start.y - joinY) + 6;
  const sx = (x: number): number => x - svgLeft;
  const sy = (y: number): number => y - svgTop;

  const rows: Array<[string, number, number[]]> = [
    [t('cpu'), vitals.cpu, history.cpu],
    [t('memory'), vitals.memory, history.memory],
    [t('disk'), vitals.disk, history.disk]
  ];
  const footer = [
    vitals.load ? `${t('load')} ${vitals.load[0].toFixed(2)}` : null,
    `${t('uptime')} ${formatUptime(vitals.uptimeSec)}`,
    vitals.temperatureC !== null
      ? `${t('temperature')} ${Math.round(vitals.temperatureC)} °C`
      : null
  ].filter(Boolean);

  return (
    <>
      <svg
        style={{
          position: 'absolute',
          left: svgLeft,
          top: svgTop,
          overflow: 'visible',
          pointerEvents: 'none'
        }}
        width={start.x - svgLeft + 3}
        height={svgHeight}
        aria-hidden
      >
        <polyline
          points={`${sx(start.x)},${sy(start.y)} ${sx(elbowX)},${sy(start.y)} ${sx(elbowX)},${sy(joinY)} ${sx(cardRight)},${sy(joinY)}`}
          fill="none"
          stroke={lineColour}
          strokeWidth={1}
        />
        <circle cx={sx(start.x)} cy={sy(start.y)} r={2} fill={lineColour} />
      </svg>
      <Box
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
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: '8px'
          }}
        >
          <Box
            sx={{
              fontFamily: LIVE_TOKENS.mono,
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: LIVE_TOKENS.mute,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {system.name}
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontFamily: LIVE_TOKENS.mono,
              fontSize: 10,
              color: LIVE_TOKENS.mute
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: STATUS_COLOR[system.status]
              }}
            />
            {system.state === 'down' ? t('down') : t('live')}
          </Box>
        </Box>
        {rows.map(([label, value, series]) => (
          <Box
            key={label}
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 64px 44px',
              alignItems: 'center',
              columnGap: '8px',
              py: '5px',
              borderTop: `1px solid ${LIVE_TOKENS.hairline}`
            }}
          >
            <Box sx={{ fontSize: 12, color: LIVE_TOKENS.body }}>{label}</Box>
            <Sparkline values={series} />
            <Box
              sx={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.03em',
                textAlign: 'right',
                color: valueColour(value)
              }}
            >
              {formatPercent(value)}
            </Box>
          </Box>
        ))}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            py: '5px',
            borderTop: `1px solid ${LIVE_TOKENS.hairline}`,
            fontSize: 12,
            color: LIVE_TOKENS.body
          }}
        >
          <span>{t('network')}</span>
          <Box
            component="span"
            sx={{
              fontFamily: LIVE_TOKENS.mono,
              fontSize: 11,
              color: LIVE_TOKENS.ink
            }}
          >
            {formatBytesPerSec(vitals.networkBytesPerSec)}
          </Box>
        </Box>
        <Box
          sx={{
            mt: '6px',
            fontFamily: LIVE_TOKENS.mono,
            fontSize: 10,
            color: LIVE_TOKENS.mute
          }}
        >
          {footer.join(' · ')}
        </Box>
      </Box>
    </>
  );
};
