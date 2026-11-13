import React from 'react';
import { Box } from '@mui/material';
import { LIVE_TOKENS } from 'src/live/tokens';
import { useModelStore } from 'src/stores/modelStore';
import { useTranslation } from 'src/stores/localeStore';
import type { Coords } from 'src/types';
import { CardFrame, captionSx, sectionSx, StatRow } from './CardFrame';
import { matchesIdentity } from './match';
import { useTraffic } from './TrafficContext';
import type { TrafficStats, TrafficSummary } from './types';

type BoxStats = Pick<TrafficStats, 'callsPerMin' | 'failedPct' | 'p50Ms' | 'p95Ms'>;

/** Incoming numbers for a bound service; otherwise the matching callees, summed. */
const boxStats = (
  summary: TrafficSummary,
  ids: string[]
): { kind: 'incoming' | 'seenByCallers'; stats: BoxStats } | null => {
  const service = summary.services.find((entry) => ids.includes(entry.service));
  if (service) return { kind: 'incoming', stats: service };

  const matched = summary.callees.filter((entry) =>
    ids.some((id) => matchesIdentity(id, entry.callee))
  );
  if (matched.length === 0) return null;
  const calls = matched.reduce((sum, entry) => sum + entry.calls, 0);
  const failures = matched.reduce((sum, entry) => sum + entry.failures, 0);
  const busiest = matched.reduce((best, entry) =>
    entry.calls > best.calls ? entry : best
  );
  const p95s = matched.flatMap((entry) => (entry.p95Ms === null ? [] : [entry.p95Ms]));
  return {
    kind: 'seenByCallers',
    stats: {
      callsPerMin: matched.reduce((sum, entry) => sum + entry.callsPerMin, 0),
      failedPct: calls === 0 ? 0 : (100 * failures) / calls,
      p50Ms: busiest.p50Ms,
      p95Ms: p95s.length ? Math.max(...p95s) : null
    }
  };
};

interface BoxCardProps {
  itemId: string;
  /** Scene position of the box's tile centre. */
  anchor: Coords;
  onClose: () => void;
}

/** What callers see of a box, and the identities it is bound to (read-only). */
export const BoxCard = ({ itemId, anchor, onClose }: BoxCardProps) => {
  const { t } = useTranslation('traffic');
  const traffic = useTraffic();
  const item = useModelStore((state) => state.items.find((entry) => entry.id === itemId));
  if (!traffic || !item) return null;

  const ids = item.traffic?.ids ?? [];
  const summary = traffic.feed.summary;
  const result = summary ? boxStats(summary, ids) : null;

  return (
    <CardFrame anchor={anchor} title={item.name} onClose={onClose}>
      {result ? (
        <>
          <Box sx={{ ...captionSx, mb: '4px' }}>
            {result.kind === 'incoming' ? t('incoming') : t('seenByCallers')}
          </Box>
          <StatRow stats={result.stats} />
        </>
      ) : (
        <Box sx={{ ...sectionSx, fontSize: 12, color: LIVE_TOKENS.body }}>
          {t('noTraffic')}
        </Box>
      )}
      <Box sx={sectionSx}>
        <Box sx={{ ...captionSx, mb: '4px' }}>{t('identities')}</Box>
        {ids.map((id) => (
          <Box
            key={id}
            sx={{
              fontFamily: LIVE_TOKENS.mono,
              fontSize: 11,
              color: LIVE_TOKENS.body,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {id}
          </Box>
        ))}
      </Box>
    </CardFrame>
  );
};
