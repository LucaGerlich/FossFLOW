/**
 * Mini Metrics Display Component
 * 
 * Shows a compact metric value with optional status coloring on nodes.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import type { MetricValue, NodeHealthStatus } from 'src/types/liveAnalytics';

/**
 * Status color mapping
 */
const statusColors: Record<NodeHealthStatus, string> = {
  healthy: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
  unknown: '#6b7280',
  offline: '#374151'
};

export interface MiniMetricProps {
  /** Display name for the metric */
  name: string;
  /** The metric value data */
  value: MetricValue;
  /** Unit to display */
  unit?: string;
  /** Format string (simplified: '0.00' for decimals, '0%' for percentage) */
  format?: string;
  /** Whether to color the value based on status */
  colorByStatus?: boolean;
  /** Compact display mode */
  compact?: boolean;
}

/**
 * Format a numeric value based on a simple format string
 */
const formatValue = (value: number | string | null, format?: string): string => {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'string') return value;
  
  if (!format) return value.toLocaleString();
  
  // Handle percentage format
  if (format.includes('%')) {
    const decimals = (format.match(/0+/g)?.[0]?.length || 1) - 1;
    return `${(value * 100).toFixed(Math.max(0, decimals))}%`;
  }
  
  // Handle decimal format
  const decimalMatch = format.match(/\.(\d+)/);
  if (decimalMatch) {
    return value.toFixed(decimalMatch[1].length);
  }
  
  return value.toLocaleString();
};

export const MiniMetric: React.FC<MiniMetricProps> = ({
  name,
  value,
  unit,
  format,
  colorByStatus = true,
  compact = false
}) => {
  const displayValue = formatValue(value.value, format);
  const color = colorByStatus ? statusColors[value.status] : 'inherit';

  if (compact) {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.25,
          fontSize: 10,
          lineHeight: 1.2
        }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: 'inherit',
            fontWeight: 600,
            color
          }}
        >
          {displayValue}
        </Typography>
        {unit && (
          <Typography
            component="span"
            sx={{
              fontSize: 8,
              color: 'text.secondary'
            }}
          >
            {unit}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        minWidth: 80
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          fontSize: 10,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 60
        }}
      >
        {name}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.25 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color,
            fontSize: 11
          }}
        >
          {displayValue}
        </Typography>
        {unit && (
          <Typography
            variant="caption"
            sx={{
              fontSize: 9,
              color: 'text.secondary'
            }}
          >
            {unit}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export interface MiniMetricsDisplayProps {
  /** Metrics to display */
  metrics: Array<{
    id: string;
    name: string;
    value: MetricValue;
    unit?: string;
    format?: string;
  }>;
  /** Maximum number of metrics to show */
  maxDisplay?: number;
  /** Layout direction */
  direction?: 'row' | 'column';
  /** Compact mode */
  compact?: boolean;
  /** Color values by status */
  colorByStatus?: boolean;
}

export const MiniMetricsDisplay: React.FC<MiniMetricsDisplayProps> = ({
  metrics,
  maxDisplay = 3,
  direction = 'column',
  compact = false,
  colorByStatus = true
}) => {
  const displayMetrics = metrics.slice(0, maxDisplay);
  const hasMore = metrics.length > maxDisplay;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: direction,
        gap: compact ? 0.5 : 0.25,
        padding: compact ? 0 : 0.5,
        backgroundColor: compact ? 'transparent' : 'rgba(255, 255, 255, 0.9)',
        borderRadius: compact ? 0 : 0.5,
        ...(compact && {
          '& > *:not(:last-child)::after': direction === 'row' ? {
            content: '"•"',
            marginLeft: 0.5,
            color: 'text.disabled'
          } : {}
        })
      }}
    >
      {displayMetrics.map((metric) => (
        <MiniMetric
          key={metric.id}
          name={metric.name}
          value={metric.value}
          unit={metric.unit}
          format={metric.format}
          colorByStatus={colorByStatus}
          compact={compact}
        />
      ))}
      {hasMore && (
        <Typography
          variant="caption"
          sx={{
            fontSize: 9,
            color: 'text.disabled',
            fontStyle: 'italic'
          }}
        >
          +{metrics.length - maxDisplay} more
        </Typography>
      )}
    </Box>
  );
};

export default MiniMetricsDisplay;
