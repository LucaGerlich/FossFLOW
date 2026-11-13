import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { LIVE_TOKENS } from 'src/live/tokens';
import { useTranslation } from 'src/stores/localeStore';
import type { Coords } from 'src/types';
import { CardFrame, captionSx, sectionSx, StatRow } from './CardFrame';
import { fill, formatMs } from './format';
import type { ArrowTraffic } from './stats';
import { useTraffic } from './TrafficContext';
import type { TrafficEdgeDetail, TrafficRange } from './types';

const RANGES: TrafficRange[] = ['1h', '24h', '7d'];
const REFRESH_MS = 15000;
const TOP = 5;
const FAILING_SHARE = 0.05;
const BAR_AREA_HEIGHT = 40;

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: TrafficEdgeDetail };

const isFailingBar = (bar: { calls: number; failures: number }): boolean =>
  bar.failures > 0 && bar.failures / bar.calls >= FAILING_SHARE;

const pad = (n: number): string => String(n).padStart(2, '0');

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const BarSeries = ({ series }: { series: TrafficEdgeDetail['series'] }) => {
  const peak = Math.max(1, ...series.map((bar) => bar.calls));
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '1px',
        height: BAR_AREA_HEIGHT
      }}
    >
      {series.map((bar) => {
        const failing = isFailingBar(bar);
        return (
          <Box
            key={bar.at}
            data-bar
            data-failing={failing ? 'true' : 'false'}
            sx={{
              flex: 1,
              minWidth: 1,
              height: `${Math.max(2, (100 * bar.calls) / peak)}%`,
              bgcolor: failing ? LIVE_TOKENS.criticalDeep : LIVE_TOKENS.hairlineStrong
            }}
          />
        );
      })}
    </Box>
  );
};

const Row = ({ cells }: { cells: React.ReactNode[] }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: `1fr repeat(${cells.length - 1}, auto)`,
      columnGap: '10px',
      py: '2px',
      fontFamily: LIVE_TOKENS.mono,
      fontSize: 11,
      color: LIVE_TOKENS.body
    }}
  >
    {cells.map((cell, index) => (
      <Box
        key={index}
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {cell}
      </Box>
    ))}
  </Box>
);

const Detail = ({ detail }: { detail: TrafficEdgeDetail }) => {
  const { t } = useTranslation('traffic');
  const operations = [...detail.operations]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, TOP);
  const failures = detail.failures.slice(0, TOP);
  return (
    <>
      <Box sx={sectionSx}>
        <BarSeries series={detail.series} />
      </Box>
      <Box sx={sectionSx}>
        <Box sx={{ ...captionSx, mb: '4px' }}>{t('busiest')}</Box>
        {operations.map((op) => (
          <Row
            key={op.operation}
            cells={[
              op.operation,
              String(op.calls),
              op.p95Ms === null ? '–' : formatMs(op.p95Ms)
            ]}
          />
        ))}
      </Box>
      <Box sx={sectionSx}>
        <Box sx={{ ...captionSx, mb: '4px' }}>{t('recentFailures')}</Box>
        {failures.length === 0 ? (
          <Box sx={{ fontSize: 12, color: LIVE_TOKENS.body }}>{t('noFailures')}</Box>
        ) : (
          failures.map((failure, index) => (
            <Row
              key={`${failure.at}-${index}`}
              cells={[
                failure.operation,
                timeOf(failure.at),
                failure.status,
                formatMs(failure.durationMs)
              ]}
            />
          ))
        )}
      </Box>
    </>
  );
};

interface ArrowCardProps {
  arrow: ArrowTraffic;
  /** Scene position of the arrow's path midpoint. */
  anchor: Coords;
  /** 'Caller box → Callee box'. */
  title: string;
  onClose: () => void;
}

/** Stats, a bar series, the busiest calls and recent failures for one arrow. */
export const ArrowCard = ({ arrow, anchor, title, onClose }: ArrowCardProps) => {
  const { t } = useTranslation('traffic');
  const traffic = useTraffic();
  const feed = traffic?.feed;
  const [range, setRange] = useState<TrafficRange>('1h');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  // The summary refresh makes a new `pairs` array each time; key on content.
  const pairsKey = JSON.stringify(arrow.pairs);

  useEffect(() => {
    if (!feed) return undefined;
    const pairs: ArrowTraffic['pairs'] = JSON.parse(pairsKey);
    let cancelled = false;
    const fetchDetail = () => {
      feed
        .loadEdge(pairs, range)
        .then((detail) => {
          if (!cancelled) setLoad({ status: 'ready', detail });
        })
        .catch(() => {
          if (!cancelled) setLoad({ status: 'error' });
        });
    };
    setLoad({ status: 'loading' });
    fetchDetail();
    const timer = setInterval(fetchDetail, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [feed, pairsKey, range]);

  const weight = traffic?.weights.get(arrow.connectorId) ?? 1;

  return (
    <CardFrame anchor={anchor} title={title} onClose={onClose}>
      <Box sx={{ fontFamily: LIVE_TOKENS.mono, fontSize: 10, color: LIVE_TOKENS.mute, mb: '6px' }}>
        {fill(t('seenBy'), { caller: arrow.callers.join(', ') })}
      </Box>
      <StatRow stats={arrow} />
      {weight > 1 && (
        <Box sx={{ fontFamily: LIVE_TOKENS.mono, fontSize: 10, color: LIVE_TOKENS.mute, pb: '6px' }}>
          {fill(t('dotWeight'), { n: String(weight) })}
        </Box>
      )}
      <Box sx={{ ...sectionSx, display: 'flex', gap: '4px' }}>
        {RANGES.map((value) => (
          <Box
            key={value}
            component="button"
            type="button"
            aria-pressed={value === range}
            onClick={() => setRange(value)}
            sx={{
              border: `1px solid ${value === range ? LIVE_TOKENS.ink : LIVE_TOKENS.hairline}`,
              borderRadius: '999px',
              background: 'none',
              cursor: 'pointer',
              fontFamily: LIVE_TOKENS.mono,
              fontSize: 10,
              px: '8px',
              py: '1px',
              color: value === range ? LIVE_TOKENS.ink : LIVE_TOKENS.mute
            }}
          >
            {t(`range${value}`)}
          </Box>
        ))}
      </Box>
      {load.status === 'ready' && <Detail detail={load.detail} />}
      {load.status === 'loading' && (
        <Box sx={{ ...sectionSx, fontSize: 12, color: LIVE_TOKENS.mute }}>{t('loading')}</Box>
      )}
      {load.status === 'error' && (
        <Box sx={{ ...sectionSx, fontSize: 12, color: LIVE_TOKENS.criticalDeep }}>
          {t('loadFailed')}
        </Box>
      )}
    </CardFrame>
  );
};
