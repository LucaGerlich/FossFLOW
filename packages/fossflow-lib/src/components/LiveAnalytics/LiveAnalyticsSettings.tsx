/**
 * Live Analytics Settings Component
 * 
 * Settings panel for configuring global live analytics options.
 */
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Slider,
  Button,
  Divider,
  Paper,
  Chip,
  Stack,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageIcon from '@mui/icons-material/Storage';
import InfoIcon from '@mui/icons-material/Info';
import { useLiveAnalyticsConfig, useDataSources } from 'src/stores/liveAnalyticsStore';
import { DataSourceConfigDialog } from './DataSourceConfigDialog';
import { StatusIndicator } from './StatusIndicator';

export interface LiveAnalyticsSettingsProps {
  onClose?: () => void;
}

export const LiveAnalyticsSettings: React.FC<LiveAnalyticsSettingsProps> = ({ onClose }) => {
  const { config, enabled, setEnabled, updateConfig, refreshAll } = useLiveAnalyticsConfig();
  const { dataSources } = useDataSources();
  const [showDataSourceDialog, setShowDataSourceDialog] = useState(false);

  const handleRefreshIntervalChange = (_event: Event, newValue: number | number[]) => {
    updateConfig({ defaultRefreshIntervalMs: (newValue as number) * 1000 });
  };

  const enabledDataSources = dataSources.filter(ds => ds.enabled).length;
  const totalDataSources = dataSources.length;
  const boundNodes = config.nodeBindings.length;

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Live Analytics
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Connect your diagram nodes to live data sources like Grafana, Prometheus, 
        and REST APIs to monitor your infrastructure in real-time.
      </Typography>

      {/* Main Enable/Disable Toggle */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              color="primary"
            />
          }
          label={
            <Box>
              <Typography fontWeight={500}>
                Enable Live Analytics
              </Typography>
              <Typography variant="caption" color="text.secondary">
                When enabled, nodes will display real-time metrics and status indicators
              </Typography>
            </Box>
          }
          sx={{ m: 0, width: '100%', justifyContent: 'space-between' }}
          labelPlacement="start"
        />
      </Paper>

      {/* Status Overview */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <StorageIcon sx={{ mr: 1, color: 'action.active' }} />
          <Typography fontWeight={500}>Status Overview</Typography>
        </Box>
        
        <Stack direction="row" spacing={2}>
          <Chip
            icon={<StatusIndicator status={enabled ? 'healthy' : 'offline'} size={8} animated={false} />}
            label={enabled ? 'Active' : 'Disabled'}
            variant="outlined"
            size="small"
          />
          <Chip
            label={`${enabledDataSources}/${totalDataSources} Data Sources`}
            variant="outlined"
            size="small"
          />
          <Chip
            label={`${boundNodes} Nodes Monitored`}
            variant="outlined"
            size="small"
          />
        </Stack>

        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<SettingsIcon />}
            onClick={() => setShowDataSourceDialog(true)}
          >
            Configure Data Sources
          </Button>
          <Tooltip title="Refresh all metric values now">
            <IconButton onClick={refreshAll} size="small" disabled={!enabled}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>

      {/* Display Options */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography fontWeight={500} gutterBottom>
          Display Options
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.showStatusIndicators}
              onChange={(e) => updateConfig({ showStatusIndicators: e.target.checked })}
              disabled={!enabled}
              size="small"
            />
          }
          label="Show status indicators on nodes"
        />

        <FormControlLabel
          control={
            <Switch
              checked={config.showMiniMetrics}
              onChange={(e) => updateConfig({ showMiniMetrics: e.target.checked })}
              disabled={!enabled}
              size="small"
            />
          }
          label="Show mini metrics on nodes"
        />

        <FormControlLabel
          control={
            <Switch
              checked={config.animateStatusChanges}
              onChange={(e) => updateConfig({ animateStatusChanges: e.target.checked })}
              disabled={!enabled}
              size="small"
            />
          }
          label="Animate status changes"
        />
      </Paper>

      {/* Refresh Interval */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography fontWeight={500}>Default Refresh Interval</Typography>
          <Tooltip title="How often to fetch new data from sources. Individual data sources can override this.">
            <IconButton size="small">
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        
        <Slider
          value={config.defaultRefreshIntervalMs / 1000}
          onChange={handleRefreshIntervalChange}
          min={5}
          max={300}
          step={5}
          marks={[
            { value: 5, label: '5s' },
            { value: 30, label: '30s' },
            { value: 60, label: '1m' },
            { value: 120, label: '2m' },
            { value: 300, label: '5m' }
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}s`}
          disabled={!enabled}
        />
      </Paper>

      {/* Help Section */}
      <Alert severity="info" icon={<InfoIcon />}>
        <Typography variant="body2" fontWeight={500}>
          How to use Live Analytics:
        </Typography>
        <Typography variant="body2" component="div">
          <ol style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li>Configure data sources (Grafana, Prometheus, REST API)</li>
            <li>Right-click on a node and select "Configure Live Data"</li>
            <li>Bind metrics from your data sources to the node</li>
            <li>Set thresholds to control status colors</li>
          </ol>
        </Typography>
      </Alert>

      {/* Data Source Dialog */}
      <DataSourceConfigDialog
        open={showDataSourceDialog}
        onClose={() => setShowDataSourceDialog(false)}
      />
    </Box>
  );
};

export default LiveAnalyticsSettings;
