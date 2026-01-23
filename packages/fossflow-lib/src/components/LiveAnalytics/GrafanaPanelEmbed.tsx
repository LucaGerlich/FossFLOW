/**
 * Grafana Panel Embed Component
 * 
 * Embeds a Grafana panel iframe within the diagram, typically shown
 * in node tooltips or expanded labels for detailed metrics visualization.
 */
import React, { useMemo, useState } from 'react';
import { Box, CircularProgress, Typography, IconButton } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { GrafanaPanelEmbedProps } from 'src/types/liveAnalytics';

export const GrafanaPanelEmbed: React.FC<GrafanaPanelEmbedProps> = ({
  url,
  dashboardUid,
  panelId,
  width = 300,
  height = 200,
  theme = 'light',
  from = 'now-1h',
  to = 'now',
  variables = {}
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Build the Grafana panel embed URL
  const embedUrl = useMemo(() => {
    try {
      const baseUrl = new URL(url);
      baseUrl.pathname = `/d-solo/${dashboardUid}`;
      
      // Add query parameters
      baseUrl.searchParams.set('orgId', '1');
      baseUrl.searchParams.set('panelId', panelId.toString());
      baseUrl.searchParams.set('from', from);
      baseUrl.searchParams.set('to', to);
      baseUrl.searchParams.set('theme', theme);
      
      // Add custom variables
      Object.entries(variables).forEach(([key, value]) => {
        baseUrl.searchParams.set(`var-${key}`, value);
      });

      return baseUrl.toString();
    } catch (e) {
      setError('Invalid Grafana URL');
      return '';
    }
  }, [url, dashboardUid, panelId, from, to, theme, variables]);

  // Build the full dashboard URL for the "open in new window" link
  const dashboardUrl = useMemo(() => {
    try {
      const baseUrl = new URL(url);
      baseUrl.pathname = `/d/${dashboardUid}`;
      baseUrl.searchParams.set('from', from);
      baseUrl.searchParams.set('to', to);
      
      Object.entries(variables).forEach(([key, value]) => {
        baseUrl.searchParams.set(`var-${key}`, value);
      });

      return baseUrl.toString();
    } catch {
      return '';
    }
  }, [url, dashboardUid, from, to, variables]);

  const handleLoad = () => {
    setLoading(false);
    setError(null);
  };

  const handleError = () => {
    setLoading(false);
    setError('Failed to load Grafana panel');
  };

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    setRefreshKey(prev => prev + 1);
  };

  const handleOpenInNew = () => {
    if (dashboardUrl) {
      window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (error) {
    return (
      <Box
        sx={{
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'grey.100',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'grey.300'
        }}
      >
        <Typography color="error" variant="caption">
          {error}
        </Typography>
        <IconButton size="small" onClick={handleRefresh}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'relative',
        width,
        height,
        borderRadius: 1,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'grey.300',
        backgroundColor: theme === 'dark' ? 'grey.900' : 'white'
      }}
    >
      {/* Controls overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          zIndex: 10,
          display: 'flex',
          gap: 0.5,
          opacity: 0,
          transition: 'opacity 0.2s',
          '&:hover': { opacity: 1 },
          '.MuiBox-root:hover > &': { opacity: 1 }
        }}
      >
        <IconButton
          size="small"
          onClick={handleRefresh}
          sx={{
            backgroundColor: 'rgba(255,255,255,0.8)',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.95)' }
          }}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={handleOpenInNew}
          sx={{
            backgroundColor: 'rgba(255,255,255,0.8)',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.95)' }
          }}
        >
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Loading indicator */}
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.8)',
            zIndex: 5
          }}
        >
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Grafana iframe */}
      {embedUrl && (
        <iframe
          key={refreshKey}
          src={embedUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          onLoad={handleLoad}
          onError={handleError}
          title={`Grafana Panel ${panelId}`}
          style={{
            border: 'none',
            backgroundColor: 'transparent'
          }}
        />
      )}
    </Box>
  );
};

/**
 * Simplified Grafana link component for when embedding is not possible
 */
export interface GrafanaLinkProps {
  url: string;
  dashboardUid: string;
  dashboardName?: string;
  from?: string;
  to?: string;
  variables?: Record<string, string>;
}

export const GrafanaLink: React.FC<GrafanaLinkProps> = ({
  url,
  dashboardUid,
  dashboardName = 'Dashboard',
  from = 'now-1h',
  to = 'now',
  variables = {}
}) => {
  const dashboardUrl = useMemo(() => {
    try {
      const baseUrl = new URL(url);
      baseUrl.pathname = `/d/${dashboardUid}`;
      baseUrl.searchParams.set('from', from);
      baseUrl.searchParams.set('to', to);
      
      Object.entries(variables).forEach(([key, value]) => {
        baseUrl.searchParams.set(`var-${key}`, value);
      });

      return baseUrl.toString();
    } catch {
      return '';
    }
  }, [url, dashboardUid, from, to, variables]);

  return (
    <Box
      component="a"
      href={dashboardUrl}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        color: 'primary.main',
        textDecoration: 'none',
        fontSize: 12,
        '&:hover': {
          textDecoration: 'underline'
        }
      }}
    >
      <OpenInNewIcon sx={{ fontSize: 14 }} />
      {dashboardName}
    </Box>
  );
};

export default GrafanaPanelEmbed;
