/**
 * Status Indicator Component
 * 
 * Displays a colored health status indicator for monitored nodes.
 * Supports animations for status changes and pulsing effects.
 */
import React, { useMemo } from 'react';
import { Box, keyframes } from '@mui/material';
import type { NodeHealthStatus } from 'src/types/liveAnalytics';

const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const glowAnimation = keyframes`
  0% {
    box-shadow: 0 0 2px 1px currentColor;
  }
  50% {
    box-shadow: 0 0 8px 3px currentColor;
  }
  100% {
    box-shadow: 0 0 2px 1px currentColor;
  }
`;

/**
 * Status color mapping
 */
const statusColors: Record<NodeHealthStatus, string> = {
  healthy: '#22c55e',   // Green
  warning: '#f59e0b',   // Amber/Orange
  critical: '#ef4444',  // Red
  unknown: '#6b7280',   // Gray
  offline: '#374151'    // Dark Gray
};

/**
 * Status labels for accessibility
 */
const statusLabels: Record<NodeHealthStatus, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
  offline: 'Offline'
};

export interface StatusIndicatorProps {
  /** Current health status */
  status: NodeHealthStatus;
  /** Size of the indicator in pixels */
  size?: number;
  /** Whether to show pulse animation for critical/warning states */
  animated?: boolean;
  /** Whether to show a glow effect */
  glow?: boolean;
  /** Additional styling */
  sx?: object;
  /** Click handler */
  onClick?: () => void;
  /** Whether the indicator is interactive */
  interactive?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  size = 12,
  animated = true,
  glow = false,
  sx,
  onClick,
  interactive = false
}) => {
  const color = statusColors[status];
  const label = statusLabels[status];
  
  const shouldAnimate = animated && (status === 'critical' || status === 'warning');
  
  const indicatorStyles = useMemo(() => ({
    width: size,
    height: size,
    borderRadius: '50%',
    backgroundColor: color,
    color: color, // For glow animation
    transition: 'all 0.3s ease-in-out',
    cursor: interactive || onClick ? 'pointer' : 'default',
    ...(shouldAnimate && {
      animation: `${pulseAnimation} 2s ease-in-out infinite`
    }),
    ...(glow && {
      animation: `${glowAnimation} 2s ease-in-out infinite`
    }),
    ...(interactive && {
      '&:hover': {
        transform: 'scale(1.2)',
        boxShadow: `0 0 8px 2px ${color}`
      }
    }),
    ...sx
  }), [size, color, shouldAnimate, glow, interactive, onClick, sx]);

  return (
    <Box
      component="span"
      role="status"
      aria-label={`Status: ${label}`}
      title={label}
      onClick={onClick}
      sx={indicatorStyles}
    />
  );
};

/**
 * Status Indicator with Label
 */
export interface StatusIndicatorWithLabelProps extends StatusIndicatorProps {
  /** Whether to show the label text */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'left' | 'right';
  /** Font size for the label */
  fontSize?: number;
}

export const StatusIndicatorWithLabel: React.FC<StatusIndicatorWithLabelProps> = ({
  status,
  showLabel = true,
  labelPosition = 'right',
  fontSize = 12,
  ...indicatorProps
}) => {
  const label = statusLabels[status];
  const color = statusColors[status];

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        flexDirection: labelPosition === 'left' ? 'row-reverse' : 'row'
      }}
    >
      <StatusIndicator status={status} {...indicatorProps} />
      {showLabel && (
        <Box
          component="span"
          sx={{
            fontSize,
            color,
            fontWeight: 500,
            textTransform: 'capitalize'
          }}
        >
          {label}
        </Box>
      )}
    </Box>
  );
};

export default StatusIndicator;
