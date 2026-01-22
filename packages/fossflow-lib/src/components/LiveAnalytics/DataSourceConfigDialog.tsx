/**
 * Data Source Configuration Dialog
 * 
 * A dialog for configuring data sources that provide live metrics to nodes.
 */
import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Switch,
  FormControlLabel,
  Alert,
  Collapse,
  Chip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type {
  DataSourceConfig,
  DataSourceType,
  GrafanaDataSourceConfig,
  PrometheusDataSourceConfig,
  RestApiDataSourceConfig,
  StaticDataSourceConfig,
  NodeHealthStatus
} from 'src/types/liveAnalytics';
import { useDataSources } from 'src/stores/liveAnalyticsStore';

const dataSourceTypeLabels: Record<DataSourceType, string> = {
  grafana: 'Grafana',
  prometheus: 'Prometheus',
  rest_api: 'REST API',
  webhook: 'Webhook (Push)',
  static: 'Static Value (Demo)'
};

const dataSourceTypeDescriptions: Record<DataSourceType, string> = {
  grafana: 'Connect to Grafana dashboards and panels for live metrics',
  prometheus: 'Query Prometheus directly using PromQL',
  rest_api: 'Fetch data from any REST API endpoint',
  webhook: 'Receive push updates via webhook endpoint',
  static: 'Use fixed values for testing and demos'
};

interface DataSourceFormState {
  type: DataSourceType;
  name: string;
  enabled: boolean;
  refreshIntervalMs: number;
  // Grafana
  grafanaUrl: string;
  grafanaApiKey: string;
  grafanaDashboardUid: string;
  grafanaPanelId: string;
  grafanaQuery: string;
  // Prometheus
  prometheusUrl: string;
  prometheusQuery: string;
  // REST API
  restApiUrl: string;
  restApiMethod: 'GET' | 'POST';
  restApiHeaders: string;
  restApiBody: string;
  restApiValuePath: string;
  // Static
  staticValue: string;
  staticStatus: NodeHealthStatus;
}

const defaultFormState: DataSourceFormState = {
  type: 'rest_api',
  name: '',
  enabled: true,
  refreshIntervalMs: 30000,
  grafanaUrl: '',
  grafanaApiKey: '',
  grafanaDashboardUid: '',
  grafanaPanelId: '',
  grafanaQuery: '',
  prometheusUrl: '',
  prometheusQuery: '',
  restApiUrl: '',
  restApiMethod: 'GET',
  restApiHeaders: '{}',
  restApiBody: '',
  restApiValuePath: '$.value',
  staticValue: '0',
  staticStatus: 'healthy'
};

interface DataSourceConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export const DataSourceConfigDialog: React.FC<DataSourceConfigDialogProps> = ({
  open,
  onClose
}) => {
  const { dataSources, addDataSource, removeDataSource, updateDataSource } = useDataSources();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<DataSourceFormState>(defaultFormState);
  const [expandedSection, setExpandedSection] = useState<string | null>('type');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const generateId = () => `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleInputChange = (field: keyof DataSourceFormState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { value: unknown } }
  ) => {
    setFormState(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const handleSwitchChange = (field: keyof DataSourceFormState) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormState(prev => ({
      ...prev,
      [field]: event.target.checked
    }));
  };

  const buildDataSourceConfig = (): DataSourceConfig => {
    const baseConfig = {
      id: editingId || generateId(),
      name: formState.name,
      enabled: formState.enabled,
      refreshIntervalMs: formState.refreshIntervalMs
    };

    switch (formState.type) {
      case 'grafana':
        return {
          ...baseConfig,
          type: 'grafana',
          url: formState.grafanaUrl,
          apiKey: formState.grafanaApiKey || undefined,
          dashboardUid: formState.grafanaDashboardUid || undefined,
          panelId: formState.grafanaPanelId ? parseInt(formState.grafanaPanelId) : undefined,
          query: formState.grafanaQuery || undefined
        } as GrafanaDataSourceConfig;

      case 'prometheus':
        return {
          ...baseConfig,
          type: 'prometheus',
          url: formState.prometheusUrl,
          query: formState.prometheusQuery
        } as PrometheusDataSourceConfig;

      case 'rest_api':
        return {
          ...baseConfig,
          type: 'rest_api',
          url: formState.restApiUrl,
          method: formState.restApiMethod,
          headers: formState.restApiHeaders ? JSON.parse(formState.restApiHeaders) : undefined,
          body: formState.restApiBody || undefined,
          valuePath: formState.restApiValuePath || undefined
        } as RestApiDataSourceConfig;

      case 'static':
        return {
          ...baseConfig,
          type: 'static',
          value: isNaN(Number(formState.staticValue)) 
            ? formState.staticValue 
            : Number(formState.staticValue),
          status: formState.staticStatus
        } as StaticDataSourceConfig;

      default:
        throw new Error(`Unsupported data source type: ${formState.type}`);
    }
  };

  const handleSave = () => {
    try {
      const config = buildDataSourceConfig();
      
      if (editingId) {
        updateDataSource(editingId, config);
      } else {
        addDataSource(config);
      }

      setShowForm(false);
      setEditingId(null);
      setFormState(defaultFormState);
      setTestResult(null);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save data source'
      });
    }
  };

  const handleEdit = (dataSource: DataSourceConfig) => {
    setEditingId(dataSource.id);
    
    // Populate form state from data source
    const newState: DataSourceFormState = {
      ...defaultFormState,
      type: dataSource.type,
      name: dataSource.name,
      enabled: dataSource.enabled,
      refreshIntervalMs: dataSource.refreshIntervalMs
    };

    switch (dataSource.type) {
      case 'grafana':
        newState.grafanaUrl = dataSource.url;
        newState.grafanaApiKey = dataSource.apiKey || '';
        newState.grafanaDashboardUid = dataSource.dashboardUid || '';
        newState.grafanaPanelId = dataSource.panelId?.toString() || '';
        newState.grafanaQuery = dataSource.query || '';
        break;
      case 'prometheus':
        newState.prometheusUrl = dataSource.url;
        newState.prometheusQuery = dataSource.query;
        break;
      case 'rest_api':
        newState.restApiUrl = dataSource.url;
        newState.restApiMethod = dataSource.method;
        newState.restApiHeaders = JSON.stringify(dataSource.headers || {});
        newState.restApiBody = typeof dataSource.body === 'string' 
          ? dataSource.body 
          : JSON.stringify(dataSource.body || '');
        newState.restApiValuePath = dataSource.valuePath || '';
        break;
      case 'static':
        newState.staticValue = dataSource.value.toString();
        newState.staticStatus = dataSource.status;
        break;
    }

    setFormState(newState);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this data source?')) {
      removeDataSource(id);
    }
  };

  const handleTestConnection = async () => {
    setTestResult({ success: false, message: 'Testing...' });
    
    try {
      const config = buildDataSourceConfig();
      
      // Perform a simple connectivity test
      if (config.type === 'rest_api' || config.type === 'prometheus' || config.type === 'grafana') {
        const testUrl = config.type === 'prometheus' 
          ? `${config.url}/api/v1/status/runtimeinfo`
          : config.type === 'grafana'
          ? `${config.url}/api/health`
          : config.url;

        const response = await fetch(testUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          setTestResult({ success: true, message: 'Connection successful!' });
        } else {
          setTestResult({ 
            success: false, 
            message: `Connection failed: HTTP ${response.status}` 
          });
        }
      } else if (config.type === 'static') {
        setTestResult({ success: true, message: 'Static data source - always available' });
      } else {
        setTestResult({ success: true, message: 'Webhook endpoint will be available when saved' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed'
      });
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const renderFormSection = (
    title: string,
    sectionKey: string,
    children: React.ReactNode
  ) => (
    <Box sx={{ mb: 2 }}>
      <Box
        onClick={() => toggleSection(sectionKey)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          py: 1,
          px: 1,
          borderRadius: 1,
          '&:hover': { backgroundColor: 'action.hover' }
        }}
      >
        <Typography variant="subtitle2" fontWeight={600}>
          {title}
        </Typography>
        {expandedSection === sectionKey ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </Box>
      <Collapse in={expandedSection === sectionKey}>
        <Box sx={{ px: 1, py: 1 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );

  const renderTypeSpecificFields = () => {
    switch (formState.type) {
      case 'grafana':
        return (
          <>
            <TextField
              fullWidth
              label="Grafana URL"
              placeholder="https://grafana.example.com"
              value={formState.grafanaUrl}
              onChange={handleInputChange('grafanaUrl')}
              margin="dense"
              size="small"
            />
            <TextField
              fullWidth
              label="API Key (optional)"
              type="password"
              value={formState.grafanaApiKey}
              onChange={handleInputChange('grafanaApiKey')}
              margin="dense"
              size="small"
              helperText="Required for authenticated access"
            />
            <TextField
              fullWidth
              label="Dashboard UID"
              value={formState.grafanaDashboardUid}
              onChange={handleInputChange('grafanaDashboardUid')}
              margin="dense"
              size="small"
            />
            <TextField
              fullWidth
              label="Panel ID"
              type="number"
              value={formState.grafanaPanelId}
              onChange={handleInputChange('grafanaPanelId')}
              margin="dense"
              size="small"
            />
            <TextField
              fullWidth
              label="Query (PromQL)"
              multiline
              rows={2}
              value={formState.grafanaQuery}
              onChange={handleInputChange('grafanaQuery')}
              margin="dense"
              size="small"
              placeholder="e.g., rate(http_requests_total[5m])"
            />
          </>
        );

      case 'prometheus':
        return (
          <>
            <TextField
              fullWidth
              label="Prometheus URL"
              placeholder="https://prometheus.example.com"
              value={formState.prometheusUrl}
              onChange={handleInputChange('prometheusUrl')}
              margin="dense"
              size="small"
            />
            <TextField
              fullWidth
              label="PromQL Query"
              multiline
              rows={3}
              value={formState.prometheusQuery}
              onChange={handleInputChange('prometheusQuery')}
              margin="dense"
              size="small"
              placeholder="e.g., node_cpu_seconds_total{mode='idle'}"
            />
          </>
        );

      case 'rest_api':
        return (
          <>
            <TextField
              fullWidth
              label="API URL"
              placeholder="https://api.example.com/metrics"
              value={formState.restApiUrl}
              onChange={handleInputChange('restApiUrl')}
              margin="dense"
              size="small"
            />
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Method</InputLabel>
              <Select
                value={formState.restApiMethod}
                label="Method"
                onChange={(e) => setFormState(prev => ({ 
                  ...prev, 
                  restApiMethod: e.target.value as 'GET' | 'POST' 
                }))}
              >
                <MenuItem value="GET">GET</MenuItem>
                <MenuItem value="POST">POST</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Headers (JSON)"
              multiline
              rows={2}
              value={formState.restApiHeaders}
              onChange={handleInputChange('restApiHeaders')}
              margin="dense"
              size="small"
              placeholder='{"Authorization": "Bearer token"}'
            />
            {formState.restApiMethod === 'POST' && (
              <TextField
                fullWidth
                label="Request Body"
                multiline
                rows={2}
                value={formState.restApiBody}
                onChange={handleInputChange('restApiBody')}
                margin="dense"
                size="small"
              />
            )}
            <TextField
              fullWidth
              label="Value JSONPath"
              value={formState.restApiValuePath}
              onChange={handleInputChange('restApiValuePath')}
              margin="dense"
              size="small"
              placeholder="$.data.value"
              helperText="JSONPath expression to extract the metric value"
            />
          </>
        );

      case 'static':
        return (
          <>
            <TextField
              fullWidth
              label="Value"
              value={formState.staticValue}
              onChange={handleInputChange('staticValue')}
              margin="dense"
              size="small"
            />
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={formState.staticStatus}
                label="Status"
                onChange={(e) => setFormState(prev => ({ 
                  ...prev, 
                  staticStatus: e.target.value as NodeHealthStatus 
                }))}
              >
                <MenuItem value="healthy">Healthy</MenuItem>
                <MenuItem value="warning">Warning</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
                <MenuItem value="unknown">Unknown</MenuItem>
                <MenuItem value="offline">Offline</MenuItem>
              </Select>
            </FormControl>
          </>
        );

      default:
        return (
          <Typography color="text.secondary">
            Webhook configuration will be available after creating the data source.
          </Typography>
        );
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {showForm 
          ? (editingId ? 'Edit Data Source' : 'Add Data Source')
          : 'Data Source Configuration'
        }
      </DialogTitle>
      
      <DialogContent>
        {!showForm ? (
          <>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Configure data sources to provide live metrics to your diagram nodes.
              </Typography>
            </Box>

            {dataSources.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary" gutterBottom>
                  No data sources configured
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setShowForm(true)}
                >
                  Add Data Source
                </Button>
              </Box>
            ) : (
              <>
                <List>
                  {dataSources.map((ds) => (
                    <React.Fragment key={ds.id}>
                      <ListItem>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography>{ds.name}</Typography>
                              <Chip 
                                label={dataSourceTypeLabels[ds.type]} 
                                size="small" 
                                variant="outlined"
                              />
                              {!ds.enabled && (
                                <Chip label="Disabled" size="small" color="default" />
                              )}
                            </Box>
                          }
                          secondary={`Refresh: ${ds.refreshIntervalMs / 1000}s`}
                        />
                        <ListItemSecondaryAction>
                          <IconButton 
                            edge="end" 
                            aria-label="edit"
                            onClick={() => handleEdit(ds)}
                            sx={{ mr: 1 }}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton 
                            edge="end" 
                            aria-label="delete"
                            onClick={() => handleDelete(ds.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                      <Divider />
                    </React.Fragment>
                  ))}
                </List>

                <Box sx={{ mt: 2, textAlign: 'center' }}>
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setShowForm(true)}
                  >
                    Add Data Source
                  </Button>
                </Box>
              </>
            )}
          </>
        ) : (
          <>
            {renderFormSection('Data Source Type', 'type', (
              <>
                <FormControl fullWidth margin="dense" size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={formState.type}
                    label="Type"
                    onChange={(e) => setFormState(prev => ({ 
                      ...prev, 
                      type: e.target.value as DataSourceType 
                    }))}
                  >
                    {Object.entries(dataSourceTypeLabels).map(([type, label]) => (
                      <MenuItem key={type} value={type}>{label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {dataSourceTypeDescriptions[formState.type]}
                </Typography>
              </>
            ))}

            {renderFormSection('Basic Settings', 'basic', (
              <>
                <TextField
                  fullWidth
                  label="Name"
                  value={formState.name}
                  onChange={handleInputChange('name')}
                  margin="dense"
                  size="small"
                  required
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formState.enabled}
                      onChange={handleSwitchChange('enabled')}
                    />
                  }
                  label="Enabled"
                />
                <TextField
                  fullWidth
                  label="Refresh Interval (ms)"
                  type="number"
                  value={formState.refreshIntervalMs}
                  onChange={handleInputChange('refreshIntervalMs')}
                  margin="dense"
                  size="small"
                  inputProps={{ min: 1000, max: 3600000, step: 1000 }}
                  helperText="Minimum 1000ms (1 second)"
                />
              </>
            ))}

            {renderFormSection('Connection Settings', 'connection', (
              renderTypeSpecificFields()
            ))}

            {testResult && (
              <Alert 
                severity={testResult.success ? 'success' : 'error'}
                sx={{ mt: 2 }}
              >
                {testResult.message}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        {showForm ? (
          <>
            <Button onClick={handleTestConnection} color="info">
              Test Connection
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => {
              setShowForm(false);
              setEditingId(null);
              setFormState(defaultFormState);
              setTestResult(null);
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              variant="contained"
              disabled={!formState.name}
            >
              {editingId ? 'Update' : 'Add'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default DataSourceConfigDialog;
