/**
 * Live Analytics Context and Provider
 * 
 * Manages the global state for live data subscriptions and provides
 * real-time metric updates to diagram nodes.
 */
import React, { createContext, useContext, useRef, useEffect, useCallback, useState } from 'react';
import type {
  LiveAnalyticsConfig,
  NodeLiveDataState,
  MetricValue,
  NodeHealthStatus,
  DataSourceConfig,
  MetricBinding,
  MetricUpdateEvent,
  StatusChangeEvent
} from 'src/types/liveAnalytics';

/**
 * Event handlers for live data updates
 */
export interface LiveAnalyticsEventHandlers {
  onMetricUpdate?: (event: MetricUpdateEvent) => void;
  onStatusChange?: (event: StatusChangeEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error, context: string) => void;
}

/**
 * Live Analytics Store State
 */
export interface LiveAnalyticsState {
  /** Current configuration */
  config: LiveAnalyticsConfig;
  /** Live data state for all nodes */
  nodeStates: Map<string, NodeLiveDataState>;
  /** Whether the system is initialized */
  initialized: boolean;
  /** Global connection status */
  connected: boolean;
}

/**
 * Live Analytics Store Actions
 */
export interface LiveAnalyticsActions {
  /** Initialize the live analytics system */
  initialize: (config: LiveAnalyticsConfig) => void;
  /** Update configuration */
  updateConfig: (config: Partial<LiveAnalyticsConfig>) => void;
  /** Add a data source */
  addDataSource: (dataSource: DataSourceConfig) => void;
  /** Remove a data source */
  removeDataSource: (dataSourceId: string) => void;
  /** Update a data source */
  updateDataSource: (dataSourceId: string, updates: Partial<DataSourceConfig>) => void;
  /** Bind metrics to a node */
  bindNodeMetrics: (nodeId: string, metrics: MetricBinding[]) => void;
  /** Unbind all metrics from a node */
  unbindNodeMetrics: (nodeId: string) => void;
  /** Get current metric value for a node */
  getNodeMetrics: (nodeId: string) => NodeLiveDataState | undefined;
  /** Get overall status for a node */
  getNodeStatus: (nodeId: string) => NodeHealthStatus;
  /** Force refresh all data */
  refreshAll: () => void;
  /** Force refresh a specific node */
  refreshNode: (nodeId: string) => void;
  /** Set event handlers */
  setEventHandlers: (handlers: LiveAnalyticsEventHandlers) => void;
  /** Enable/disable live analytics */
  setEnabled: (enabled: boolean) => void;
  /** Cleanup and stop all subscriptions */
  cleanup: () => void;
}

export interface LiveAnalyticsStore extends LiveAnalyticsState {
  actions: LiveAnalyticsActions;
}

const defaultConfig: LiveAnalyticsConfig = {
  enabled: false,
  dataSources: [],
  nodeBindings: [],
  defaultRefreshIntervalMs: 30000,
  showStatusIndicators: true,
  showMiniMetrics: true,
  animateStatusChanges: true
};

const defaultState: LiveAnalyticsState = {
  config: defaultConfig,
  nodeStates: new Map(),
  initialized: false,
  connected: false
};

/**
 * Create the initial store state
 */
const createInitialState = (): LiveAnalyticsStore => {
  const state: LiveAnalyticsState = { ...defaultState };
  const eventHandlersRef: { current: LiveAnalyticsEventHandlers } = { current: {} };
  const refreshIntervalsRef: { current: Map<string, NodeJS.Timeout> } = { current: new Map() };

  /**
   * Compute overall status from individual metric statuses
   */
  const computeOverallStatus = (metrics: Record<string, MetricValue>): NodeHealthStatus => {
    const statuses = Object.values(metrics).map(m => m.status);
    
    if (statuses.some(s => s === 'critical')) return 'critical';
    if (statuses.some(s => s === 'offline')) return 'offline';
    if (statuses.some(s => s === 'warning')) return 'warning';
    if (statuses.every(s => s === 'healthy')) return 'healthy';
    return 'unknown';
  };

  /**
   * Determine status from value and thresholds
   */
  const computeStatusFromThreshold = (
    value: number,
    thresholds: { healthy: number; warning: number; critical: number; operator: string }
  ): NodeHealthStatus => {
    const { healthy, warning, critical, operator } = thresholds;
    
    switch (operator) {
      case 'lt':
      case 'lte':
        if (value >= critical) return 'critical';
        if (value >= warning) return 'warning';
        return 'healthy';
      case 'gt':
      case 'gte':
        if (value <= critical) return 'critical';
        if (value <= warning) return 'warning';
        return 'healthy';
      default:
        return 'unknown';
    }
  };

  /**
   * Fetch data from a data source
   */
  const fetchFromDataSource = async (
    dataSource: DataSourceConfig,
    binding: MetricBinding
  ): Promise<MetricValue> => {
    const timestamp = new Date();
    
    try {
      switch (dataSource.type) {
        case 'static':
          return {
            value: dataSource.value,
            timestamp,
            status: dataSource.status,
            loading: false
          };

        case 'rest_api': {
          const response = await fetch(dataSource.url, {
            method: dataSource.method,
            headers: dataSource.headers,
            body: dataSource.method === 'POST' && dataSource.body
              ? JSON.stringify(dataSource.body)
              : undefined,
            signal: AbortSignal.timeout(dataSource.timeout || 10000)
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          const value = dataSource.valuePath
            ? extractJsonPath(data, dataSource.valuePath)
            : data;

          const numericValue = typeof value === 'number' ? value : parseFloat(value);
          const status = binding.thresholds && !isNaN(numericValue)
            ? computeStatusFromThreshold(numericValue, binding.thresholds)
            : 'unknown';

          return {
            value: isNaN(numericValue) ? value : numericValue,
            timestamp,
            status,
            loading: false
          };
        }

        case 'prometheus': {
          const queryUrl = new URL(`${dataSource.url}/api/v1/query`);
          queryUrl.searchParams.set('query', dataSource.query);

          const response = await fetch(queryUrl.toString(), {
            signal: AbortSignal.timeout(dataSource.timeout || 10000)
          });

          if (!response.ok) {
            throw new Error(`Prometheus query failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.status !== 'success' || !data.data?.result?.[0]?.value) {
            throw new Error('No data returned from Prometheus');
          }

          const rawValue = data.data.result[0].value[1];
          const numericValue = parseFloat(rawValue);
          const status = binding.thresholds && !isNaN(numericValue)
            ? computeStatusFromThreshold(numericValue, binding.thresholds)
            : 'unknown';

          return {
            value: numericValue,
            timestamp,
            status,
            loading: false
          };
        }

        case 'grafana': {
          // Grafana queries require more complex setup
          // For now, return placeholder - full implementation would use Grafana API
          console.warn('Grafana data source queries not yet fully implemented');
          return {
            value: null,
            timestamp,
            status: 'unknown',
            loading: false,
            error: 'Grafana queries require API key configuration'
          };
        }

        case 'webhook':
          // Webhooks are push-based, so we don't fetch
          return {
            value: null,
            timestamp,
            status: 'unknown',
            loading: false
          };

        default:
          return {
            value: null,
            timestamp,
            status: 'unknown',
            loading: false,
            error: 'Unknown data source type'
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      eventHandlersRef.current.onError?.(
        new Error(errorMessage),
        `Fetching from ${dataSource.name}`
      );
      
      return {
        value: null,
        timestamp,
        status: 'offline',
        loading: false,
        error: errorMessage
      };
    }
  };

  /**
   * Simple JSONPath-like extraction
   */
  const extractJsonPath = (data: unknown, path: string): unknown => {
    const parts = path.replace(/^\$\.?/, '').split('.');
    let current = data;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      
      // Handle array access like items[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = (current as Record<string, unknown>)[key];
        current = (current as unknown[])?.[parseInt(index, 10)];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }
    
    return current;
  };

  /**
   * Refresh metrics for a specific node
   */
  const refreshNodeData = async (nodeId: string) => {
    const binding = state.config.nodeBindings.find(b => b.nodeId === nodeId);
    if (!binding || binding.metrics.length === 0) return;

    const currentState = state.nodeStates.get(nodeId);
    const newMetrics: Record<string, MetricValue> = { ...currentState?.metrics };

    for (const metricBinding of binding.metrics) {
      const dataSource = state.config.dataSources.find(
        ds => ds.id === metricBinding.dataSourceId
      );
      
      if (!dataSource || !dataSource.enabled) continue;

      const previousValue = newMetrics[metricBinding.id];
      const newValue = await fetchFromDataSource(dataSource, metricBinding);
      newMetrics[metricBinding.id] = newValue;

      // Emit metric update event
      eventHandlersRef.current.onMetricUpdate?.({
        nodeId,
        metricId: metricBinding.id,
        value: newValue,
        previousValue
      });
    }

    const newOverallStatus = binding.statusOverride || computeOverallStatus(newMetrics);
    const previousStatus = currentState?.overallStatus || 'unknown';

    // Update node state
    const newNodeState: NodeLiveDataState = {
      nodeId,
      overallStatus: newOverallStatus,
      metrics: newMetrics,
      lastUpdated: new Date(),
      loading: false,
      connected: true
    };

    state.nodeStates.set(nodeId, newNodeState);

    // Emit status change event if status changed
    if (previousStatus !== newOverallStatus) {
      eventHandlersRef.current.onStatusChange?.({
        nodeId,
        newStatus: newOverallStatus,
        previousStatus,
        reason: 'Metric update'
      });
    }
  };

  /**
   * Setup refresh intervals for all bound nodes
   */
  const setupRefreshIntervals = () => {
    // Clear existing intervals
    refreshIntervalsRef.current.forEach(interval => clearInterval(interval));
    refreshIntervalsRef.current.clear();

    if (!state.config.enabled) return;

    // Setup intervals for each node binding
    for (const binding of state.config.nodeBindings) {
      // Find the shortest refresh interval among the node's data sources
      let refreshInterval = state.config.defaultRefreshIntervalMs;
      
      for (const metricBinding of binding.metrics) {
        const dataSource = state.config.dataSources.find(
          ds => ds.id === metricBinding.dataSourceId
        );
        if (dataSource && dataSource.refreshIntervalMs < refreshInterval) {
          refreshInterval = dataSource.refreshIntervalMs;
        }
      }

      // Initial fetch
      refreshNodeData(binding.nodeId);

      // Setup interval
      const interval = setInterval(() => {
        refreshNodeData(binding.nodeId);
      }, refreshInterval);

      refreshIntervalsRef.current.set(binding.nodeId, interval);
    }
  };

  const actions: LiveAnalyticsActions = {
    initialize: (config: LiveAnalyticsConfig) => {
      state.config = { ...defaultConfig, ...config };
      state.initialized = true;
      setupRefreshIntervals();
    },

    updateConfig: (updates: Partial<LiveAnalyticsConfig>) => {
      state.config = { ...state.config, ...updates };
      setupRefreshIntervals();
    },

    addDataSource: (dataSource: DataSourceConfig) => {
      state.config.dataSources = [...state.config.dataSources, dataSource];
    },

    removeDataSource: (dataSourceId: string) => {
      state.config.dataSources = state.config.dataSources.filter(
        ds => ds.id !== dataSourceId
      );
      // Remove any bindings that reference this data source
      state.config.nodeBindings = state.config.nodeBindings.map(binding => ({
        ...binding,
        metrics: binding.metrics.filter(m => m.dataSourceId !== dataSourceId)
      }));
    },

    updateDataSource: (dataSourceId: string, updates: Partial<DataSourceConfig>) => {
      state.config.dataSources = state.config.dataSources.map(ds =>
        ds.id === dataSourceId ? { ...ds, ...updates } as DataSourceConfig : ds
      );
    },

    bindNodeMetrics: (nodeId: string, metrics: MetricBinding[]) => {
      const existingIndex = state.config.nodeBindings.findIndex(
        b => b.nodeId === nodeId
      );
      
      if (existingIndex >= 0) {
        state.config.nodeBindings[existingIndex] = {
          ...state.config.nodeBindings[existingIndex],
          metrics
        };
      } else {
        state.config.nodeBindings.push({ nodeId, metrics });
      }
      
      setupRefreshIntervals();
    },

    unbindNodeMetrics: (nodeId: string) => {
      state.config.nodeBindings = state.config.nodeBindings.filter(
        b => b.nodeId !== nodeId
      );
      state.nodeStates.delete(nodeId);
      
      const interval = refreshIntervalsRef.current.get(nodeId);
      if (interval) {
        clearInterval(interval);
        refreshIntervalsRef.current.delete(nodeId);
      }
    },

    getNodeMetrics: (nodeId: string) => {
      return state.nodeStates.get(nodeId);
    },

    getNodeStatus: (nodeId: string) => {
      return state.nodeStates.get(nodeId)?.overallStatus || 'unknown';
    },

    refreshAll: () => {
      for (const binding of state.config.nodeBindings) {
        refreshNodeData(binding.nodeId);
      }
    },

    refreshNode: (nodeId: string) => {
      refreshNodeData(nodeId);
    },

    setEventHandlers: (handlers: LiveAnalyticsEventHandlers) => {
      eventHandlersRef.current = handlers;
    },

    setEnabled: (enabled: boolean) => {
      state.config.enabled = enabled;
      setupRefreshIntervals();
      eventHandlersRef.current.onConnectionChange?.(enabled);
    },

    cleanup: () => {
      refreshIntervalsRef.current.forEach(interval => clearInterval(interval));
      refreshIntervalsRef.current.clear();
      state.nodeStates.clear();
      state.initialized = false;
      state.connected = false;
    }
  };

  return {
    ...state,
    actions
  };
};

/**
 * Live Analytics Context
 */
const LiveAnalyticsContext = createContext<LiveAnalyticsStore | null>(null);

/**
 * Provider Props
 */
interface LiveAnalyticsProviderProps {
  children: React.ReactNode;
  initialConfig?: Partial<LiveAnalyticsConfig>;
  eventHandlers?: LiveAnalyticsEventHandlers;
}

/**
 * Live Analytics Provider Component
 */
export const LiveAnalyticsProvider: React.FC<LiveAnalyticsProviderProps> = ({
  children,
  initialConfig,
  eventHandlers
}) => {
  const storeRef = useRef<LiveAnalyticsStore | null>(null);
  const [, forceUpdate] = useState({});

  if (!storeRef.current) {
    storeRef.current = createInitialState();
  }

  useEffect(() => {
    if (initialConfig) {
      storeRef.current?.actions.initialize({
        ...defaultConfig,
        ...initialConfig
      });
      forceUpdate({});
    }
  }, []);

  useEffect(() => {
    if (eventHandlers) {
      storeRef.current?.actions.setEventHandlers(eventHandlers);
    }
  }, [eventHandlers]);

  useEffect(() => {
    return () => {
      storeRef.current?.actions.cleanup();
    };
  }, []);

  return (
    <LiveAnalyticsContext.Provider value={storeRef.current}>
      {children}
    </LiveAnalyticsContext.Provider>
  );
};

/**
 * Hook to access the live analytics store
 */
export const useLiveAnalyticsStore = (): LiveAnalyticsStore => {
  const store = useContext(LiveAnalyticsContext);
  
  if (!store) {
    throw new Error('useLiveAnalyticsStore must be used within a LiveAnalyticsProvider');
  }
  
  return store;
};

/**
 * Hook to get live data for a specific node
 */
export const useNodeLiveData = (nodeId: string) => {
  const store = useLiveAnalyticsStore();
  const [nodeState, setNodeState] = useState<NodeLiveDataState | undefined>(
    store.actions.getNodeMetrics(nodeId)
  );

  useEffect(() => {
    // Poll for updates (in a real implementation, this would use a subscription)
    const interval = setInterval(() => {
      const newState = store.actions.getNodeMetrics(nodeId);
      setNodeState(newState);
    }, 1000);

    return () => clearInterval(interval);
  }, [nodeId, store.actions]);

  return {
    state: nodeState,
    status: nodeState?.overallStatus || 'unknown',
    metrics: nodeState?.metrics || {},
    loading: nodeState?.loading || false,
    connected: nodeState?.connected || false,
    lastUpdated: nodeState?.lastUpdated || null,
    refresh: useCallback(() => store.actions.refreshNode(nodeId), [store.actions, nodeId])
  };
};

/**
 * Hook to manage data sources
 */
export const useDataSources = () => {
  const store = useLiveAnalyticsStore();
  
  return {
    dataSources: store.config.dataSources,
    addDataSource: store.actions.addDataSource,
    removeDataSource: store.actions.removeDataSource,
    updateDataSource: store.actions.updateDataSource
  };
};

/**
 * Hook to manage node metric bindings
 */
export const useNodeMetricBindings = (nodeId: string) => {
  const store = useLiveAnalyticsStore();
  
  const binding = store.config.nodeBindings.find(b => b.nodeId === nodeId);
  
  return {
    metrics: binding?.metrics || [],
    bindMetrics: useCallback(
      (metrics: MetricBinding[]) => store.actions.bindNodeMetrics(nodeId, metrics),
      [store.actions, nodeId]
    ),
    unbindMetrics: useCallback(
      () => store.actions.unbindNodeMetrics(nodeId),
      [store.actions, nodeId]
    )
  };
};

/**
 * Hook to get global live analytics configuration
 */
export const useLiveAnalyticsConfig = () => {
  const store = useLiveAnalyticsStore();
  
  return {
    config: store.config,
    enabled: store.config.enabled,
    setEnabled: store.actions.setEnabled,
    updateConfig: store.actions.updateConfig,
    refreshAll: store.actions.refreshAll
  };
};
