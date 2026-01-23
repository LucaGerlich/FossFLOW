/**
 * Node Live Data Overlay Component
 * 
 * Displays live metrics and status indicator directly on a diagram node.
 * This component is designed to be rendered as part of the node visualization.
 */
import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { StatusIndicator } from './StatusIndicator';
import { MiniMetricsDisplay } from './MiniMetricsDisplay';
import { useNodeLiveData } from 'src/stores/liveAnalyticsStore';
import { useLiveAnalyticsStore } from 'src/stores/liveAnalyticsStore';
import type { NodeHealthStatus, MetricValue } from 'src/types/liveAnalytics';

/**
 * Default metric value when no data is available
 */
const createDefaultMetricValue = (): MetricValue => ({
  value: null,
  timestamp: new Date(),
  status: 'unknown' as NodeHealthStatus,
  loading: true
});

export interface NodeLiveDataOverlayProps {
  /** The node ID to display live data for */
  nodeId: string;
  /** Whether to show the status indicator */
  showStatus?: boolean;
  /** Whether to show metrics on the node */
  showMetrics?: boolean;
  /** Maximum number of metrics to display */
  maxMetrics?: number;
  /** Position of the status indicator */
  statusPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Position of the metrics display */
  metricsPosition?: 'top' | 'bottom' | 'left' | 'right';
  /** Size of the status indicator */
  statusSize?: number;
  /** Whether to use compact display */
  compact?: boolean;
}

/**
 * Position styles for status indicator
 */
const statusPositionStyles: Record<string, object> = {
  'top-left': { top: -4, left: -4 },
  'top-right': { top: -4, right: -4 },
  'bottom-left': { bottom: -4, left: -4 },
  'bottom-right': { bottom: -4, right: -4 }
};

/**
 * Position styles for metrics display
 */
const metricsPositionStyles: Record<string, object> = {
  'top': { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 },
  'bottom': { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 },
  'left': { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 4 },
  'right': { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 4 }
};

export const NodeLiveDataOverlay: React.FC<NodeLiveDataOverlayProps> = ({
  nodeId,
  showStatus = true,
  showMetrics = true,
  maxMetrics = 2,
  statusPosition = 'top-right',
  metricsPosition = 'bottom',
  statusSize = 10,
  compact = true
}) => {
  const { state, status } = useNodeLiveData(nodeId);
  const store = useLiveAnalyticsStore();

  // Get the metric bindings for this node
  const binding = useMemo(() => 
    store.config.nodeBindings.find(b => b.nodeId === nodeId),
    [store.config.nodeBindings, nodeId]
  );

  // Prepare metrics for display
  const displayMetrics = useMemo(() => {
    if (!state?.metrics || !binding?.metrics) return [];
    
    return binding.metrics
      .filter(m => m.showOnNode)
      .map(metricBinding => ({
        id: metricBinding.id,
        name: metricBinding.displayName,
        value: state.metrics[metricBinding.id] || createDefaultMetricValue(),
        unit: metricBinding.unit,
        format: metricBinding.format
      }))
      .slice(0, maxMetrics);
  }, [state?.metrics, binding?.metrics, maxMetrics]);

  // Don't render if live analytics is disabled or no data
  if (!store.config.enabled || (!showStatus && !showMetrics)) {
    return null;
  }

  // Don't render if no binding exists for this node
  if (!binding) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none'
      }}
    >
      {/* Status Indicator */}
      {showStatus && store.config.showStatusIndicators && (
        <Box
          sx={{
            position: 'absolute',
            ...statusPositionStyles[statusPosition],
            pointerEvents: 'auto'
          }}
        >
          <StatusIndicator
            status={status}
            size={statusSize}
            animated={store.config.animateStatusChanges}
            glow={status === 'critical'}
          />
        </Box>
      )}

      {/* Metrics Display */}
      {showMetrics && store.config.showMiniMetrics && displayMetrics.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            ...metricsPositionStyles[metricsPosition],
            pointerEvents: 'auto',
            zIndex: 1
          }}
        >
          <MiniMetricsDisplay
            metrics={displayMetrics}
            maxDisplay={maxMetrics}
            compact={compact}
            direction={metricsPosition === 'top' || metricsPosition === 'bottom' ? 'row' : 'column'}
          />
        </Box>
      )}
    </Box>
  );
};

export default NodeLiveDataOverlay;
