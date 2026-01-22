/**
 * Node Data Binding Dialog
 * 
 * Dialog for binding live metrics to a specific node in the diagram.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Chip,
  Grid,
  Tooltip,
  Paper
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import InfoIcon from '@mui/icons-material/Info';
import type {
  MetricBinding,
  MetricThreshold,
  NodeHealthStatus,
  DataSourceConfig
} from 'src/types/liveAnalytics';
import { useDataSources, useNodeMetricBindings, useNodeLiveData } from 'src/stores/liveAnalyticsStore';
import { StatusIndicator } from './StatusIndicator';

interface NodeDataBindingDialogProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeName?: string;
}

interface MetricBindingFormState {
  id: string;
  dataSourceId: string;
  displayName: string;
  unit: string;
  showOnNode: boolean;
  showInTooltip: boolean;
  format: string;
  useThresholds: boolean;
  thresholdOperator: 'lt' | 'gt' | 'lte' | 'gte';
  thresholdHealthy: string;
  thresholdWarning: string;
  thresholdCritical: string;
}

const defaultMetricFormState: MetricBindingFormState = {
  id: '',
  dataSourceId: '',
  displayName: '',
  unit: '',
  showOnNode: true,
  showInTooltip: true,
  format: '',
  useThresholds: true,
  thresholdOperator: 'lt',
  thresholdHealthy: '70',
  thresholdWarning: '85',
  thresholdCritical: '95'
};

const operatorLabels: Record<string, string> = {
  lt: 'Less than (alert when HIGH)',
  gt: 'Greater than (alert when LOW)',
  lte: 'Less than or equal',
  gte: 'Greater than or equal'
};

export const NodeDataBindingDialog: React.FC<NodeDataBindingDialogProps> = ({
  open,
  onClose,
  nodeId,
  nodeName
}) => {
  const { dataSources } = useDataSources();
  const { metrics, bindMetrics, unbindMetrics } = useNodeMetricBindings(nodeId);
  const { state: liveData, status } = useNodeLiveData(nodeId);
  
  const [showForm, setShowForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formState, setFormState] = useState<MetricBindingFormState>(defaultMetricFormState);
  const [localMetrics, setLocalMetrics] = useState<MetricBinding[]>([]);

  // Initialize local metrics from store
  useEffect(() => {
    setLocalMetrics(metrics);
  }, [metrics, open]);

  const generateId = () => `mb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleInputChange = (field: keyof MetricBindingFormState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { value: unknown } }
  ) => {
    setFormState(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const handleSwitchChange = (field: keyof MetricBindingFormState) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormState(prev => ({
      ...prev,
      [field]: event.target.checked
    }));
  };

  const buildMetricBinding = (): MetricBinding => {
    const binding: MetricBinding = {
      id: formState.id || generateId(),
      dataSourceId: formState.dataSourceId,
      displayName: formState.displayName,
      unit: formState.unit || undefined,
      showOnNode: formState.showOnNode,
      showInTooltip: formState.showInTooltip,
      format: formState.format || undefined
    };

    if (formState.useThresholds) {
      binding.thresholds = {
        operator: formState.thresholdOperator,
        healthy: parseFloat(formState.thresholdHealthy) || 70,
        warning: parseFloat(formState.thresholdWarning) || 85,
        critical: parseFloat(formState.thresholdCritical) || 95
      };
    }

    return binding;
  };

  const handleSaveMetric = () => {
    const binding = buildMetricBinding();
    
    if (editingIndex !== null) {
      // Update existing metric
      const updated = [...localMetrics];
      updated[editingIndex] = binding;
      setLocalMetrics(updated);
    } else {
      // Add new metric
      setLocalMetrics(prev => [...prev, binding]);
    }

    setShowForm(false);
    setEditingIndex(null);
    setFormState(defaultMetricFormState);
  };

  const handleEditMetric = (index: number) => {
    const metric = localMetrics[index];
    
    setFormState({
      id: metric.id,
      dataSourceId: metric.dataSourceId,
      displayName: metric.displayName,
      unit: metric.unit || '',
      showOnNode: metric.showOnNode,
      showInTooltip: metric.showInTooltip,
      format: metric.format || '',
      useThresholds: !!metric.thresholds,
      thresholdOperator: metric.thresholds?.operator || 'lt',
      thresholdHealthy: metric.thresholds?.healthy?.toString() || '70',
      thresholdWarning: metric.thresholds?.warning?.toString() || '85',
      thresholdCritical: metric.thresholds?.critical?.toString() || '95'
    });
    
    setEditingIndex(index);
    setShowForm(true);
  };

  const handleDeleteMetric = (index: number) => {
    setLocalMetrics(prev => prev.filter((_, i) => i !== index));
  };

  const handleApply = () => {
    bindMetrics(localMetrics);
    onClose();
  };

  const handleRemoveAllBindings = () => {
    if (window.confirm('Remove all metric bindings from this node?')) {
      unbindMetrics();
      setLocalMetrics([]);
    }
  };

  const getDataSourceName = (dataSourceId: string) => {
    return dataSources.find(ds => ds.id === dataSourceId)?.name || 'Unknown';
  };

  const getMetricCurrentValue = (metricId: string) => {
    return liveData?.metrics[metricId];
  };

  const renderMetricList = () => (
    <>
      {localMetrics.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary" gutterBottom>
            No metrics bound to this node
          </Typography>
          {dataSources.length === 0 ? (
            <Typography variant="caption" color="error">
              Add data sources first in Settings → Data Sources
            </Typography>
          ) : (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setShowForm(true)}
            >
              Add Metric Binding
            </Button>
          )}
        </Box>
      ) : (
        <>
          <List dense>
            {localMetrics.map((metric, index) => {
              const currentValue = getMetricCurrentValue(metric.id);
              
              return (
                <React.Fragment key={metric.id}>
                  <ListItem>
                    <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
                      <StatusIndicator 
                        status={currentValue?.status || 'unknown'} 
                        size={10}
                        animated={false}
                      />
                    </Box>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" fontWeight={500}>
                            {metric.displayName}
                          </Typography>
                          {metric.unit && (
                            <Typography variant="caption" color="text.secondary">
                              ({metric.unit})
                            </Typography>
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          <Chip 
                            label={getDataSourceName(metric.dataSourceId)} 
                            size="small" 
                            variant="outlined"
                          />
                          {metric.showOnNode && (
                            <Chip label="On Node" size="small" color="primary" variant="outlined" />
                          )}
                          {currentValue?.value != null && (
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              Current: {currentValue.value}{metric.unit || ''}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton 
                        edge="end" 
                        aria-label="edit"
                        onClick={() => handleEditMetric(index)}
                        size="small"
                        sx={{ mr: 0.5 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton 
                        edge="end" 
                        aria-label="delete"
                        onClick={() => handleDeleteMetric(index)}
                        size="small"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              );
            })}
          </List>

          <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setShowForm(true)}
              disabled={dataSources.length === 0}
            >
              Add Metric
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={handleRemoveAllBindings}
            >
              Remove All
            </Button>
          </Box>
        </>
      )}
    </>
  );

  const renderMetricForm = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl fullWidth size="small" required>
        <InputLabel>Data Source</InputLabel>
        <Select
          value={formState.dataSourceId}
          label="Data Source"
          onChange={(e) => setFormState(prev => ({ 
            ...prev, 
            dataSourceId: e.target.value 
          }))}
        >
          {dataSources.map(ds => (
            <MenuItem key={ds.id} value={ds.id} disabled={!ds.enabled}>
              {ds.name}
              {!ds.enabled && ' (disabled)'}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        label="Display Name"
        value={formState.displayName}
        onChange={handleInputChange('displayName')}
        size="small"
        required
        placeholder="e.g., CPU Usage"
      />

      <Grid container spacing={2}>
        <Grid item xs={6}>
          <TextField
            fullWidth
            label="Unit"
            value={formState.unit}
            onChange={handleInputChange('unit')}
            size="small"
            placeholder="%, ms, req/s"
          />
        </Grid>
        <Grid item xs={6}>
          <TextField
            fullWidth
            label="Format"
            value={formState.format}
            onChange={handleInputChange('format')}
            size="small"
            placeholder="0.00 or 0%"
            helperText="Number format"
          />
        </Grid>
      </Grid>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={formState.showOnNode}
              onChange={handleSwitchChange('showOnNode')}
              size="small"
            />
          }
          label="Show on Node"
        />
        <FormControlLabel
          control={
            <Switch
              checked={formState.showInTooltip}
              onChange={handleSwitchChange('showInTooltip')}
              size="small"
            />
          }
          label="Show in Tooltip"
        />
      </Box>

      <Divider />

      <FormControlLabel
        control={
          <Switch
            checked={formState.useThresholds}
            onChange={handleSwitchChange('useThresholds')}
          />
        }
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography>Use Thresholds for Status</Typography>
            <Tooltip title="Define value ranges for healthy, warning, and critical states">
              <InfoIcon fontSize="small" color="action" />
            </Tooltip>
          </Box>
        }
      />

      {formState.useThresholds && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Comparison</InputLabel>
            <Select
              value={formState.thresholdOperator}
              label="Comparison"
              onChange={(e) => setFormState(prev => ({ 
                ...prev, 
                thresholdOperator: e.target.value as 'lt' | 'gt' | 'lte' | 'gte'
              }))}
            >
              {Object.entries(operatorLabels).map(([key, label]) => (
                <MenuItem key={key} value={key}>{label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Grid container spacing={2}>
            <Grid item xs={4}>
              <TextField
                fullWidth
                label="Healthy"
                type="number"
                value={formState.thresholdHealthy}
                onChange={handleInputChange('thresholdHealthy')}
                size="small"
                InputProps={{
                  startAdornment: (
                    <StatusIndicator status="healthy" size={8} animated={false} />
                  )
                }}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                label="Warning"
                type="number"
                value={formState.thresholdWarning}
                onChange={handleInputChange('thresholdWarning')}
                size="small"
                InputProps={{
                  startAdornment: (
                    <StatusIndicator status="warning" size={8} animated={false} />
                  )
                }}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                label="Critical"
                type="number"
                value={formState.thresholdCritical}
                onChange={handleInputChange('thresholdCritical')}
                size="small"
                InputProps={{
                  startAdornment: (
                    <StatusIndicator status="critical" size={8} animated={false} />
                  )
                }}
              />
            </Grid>
          </Grid>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {formState.thresholdOperator === 'lt' || formState.thresholdOperator === 'lte'
              ? `Values ≥ ${formState.thresholdCritical} = Critical, ≥ ${formState.thresholdWarning} = Warning, < ${formState.thresholdHealthy} = Healthy`
              : `Values ≤ ${formState.thresholdCritical} = Critical, ≤ ${formState.thresholdWarning} = Warning, > ${formState.thresholdHealthy} = Healthy`
            }
          </Typography>
        </Paper>
      )}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <StatusIndicator status={status} size={12} animated={false} />
          <Typography variant="h6">
            {showForm 
              ? (editingIndex !== null ? 'Edit Metric Binding' : 'Add Metric Binding')
              : `Live Data: ${nodeName || nodeId}`
            }
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {!showForm ? (
          <>
            {dataSources.length === 0 && (
              <Alert severity="info" sx={{ mb: 2 }}>
                No data sources configured. Add data sources in the settings to bind live metrics to this node.
              </Alert>
            )}
            {renderMetricList()}
          </>
        ) : (
          renderMetricForm()
        )}
      </DialogContent>

      <DialogActions>
        {showForm ? (
          <>
            <Button onClick={() => {
              setShowForm(false);
              setEditingIndex(null);
              setFormState(defaultMetricFormState);
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveMetric} 
              variant="contained"
              disabled={!formState.dataSourceId || !formState.displayName}
            >
              {editingIndex !== null ? 'Update' : 'Add'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button onClick={handleApply} variant="contained">
              Apply Changes
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default NodeDataBindingDialog;
