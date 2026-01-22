/**
 * Live Analytics Types
 * 
 * Types for integrating live data from Grafana, Prometheus, APIs, and webhooks
 * into the FossFLOW diagramming tool.
 */

/**
 * Supported data source types for live analytics
 */
export type DataSourceType = 
  | 'grafana' 
  | 'prometheus' 
  | 'rest_api' 
  | 'webhook' 
  | 'static';

/**
 * Health status for a monitored node
 */
export type NodeHealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown' | 'offline';

/**
 * Base configuration for all data sources
 */
export interface BaseDataSourceConfig {
  id: string;
  type: DataSourceType;
  name: string;
  enabled: boolean;
  refreshIntervalMs: number;
  timeout?: number;
}

/**
 * Grafana data source configuration
 */
export interface GrafanaDataSourceConfig extends BaseDataSourceConfig {
  type: 'grafana';
  url: string;
  apiKey?: string;
  orgId?: string;
  dashboardUid?: string;
  panelId?: number;
  /** PromQL or Grafana query expression */
  query?: string;
  /** Variables to substitute in the query */
  variables?: Record<string, string>;
}

/**
 * Prometheus data source configuration
 */
export interface PrometheusDataSourceConfig extends BaseDataSourceConfig {
  type: 'prometheus';
  url: string;
  /** PromQL query expression */
  query: string;
  /** Step interval for range queries */
  step?: string;
  /** Labels to extract from the result */
  labelSelectors?: Record<string, string>;
}

/**
 * REST API data source configuration
 */
export interface RestApiDataSourceConfig extends BaseDataSourceConfig {
  type: 'rest_api';
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | object;
  /** JSONPath expression to extract value from response */
  valuePath?: string;
  /** JSONPath expression to extract status from response */
  statusPath?: string;
}

/**
 * Webhook data source configuration (push-based)
 */
export interface WebhookDataSourceConfig extends BaseDataSourceConfig {
  type: 'webhook';
  /** Unique endpoint path for this webhook */
  endpointPath: string;
  /** Secret for webhook authentication */
  secret?: string;
  /** Expected payload schema (for validation) */
  payloadSchema?: object;
}

/**
 * Static data source for testing/demo purposes
 */
export interface StaticDataSourceConfig extends BaseDataSourceConfig {
  type: 'static';
  value: number | string;
  status: NodeHealthStatus;
}

/**
 * Union type for all data source configurations
 */
export type DataSourceConfig = 
  | GrafanaDataSourceConfig
  | PrometheusDataSourceConfig
  | RestApiDataSourceConfig
  | WebhookDataSourceConfig
  | StaticDataSourceConfig;

/**
 * Threshold configuration for status determination
 */
export interface MetricThreshold {
  /** Value below which status is healthy */
  healthy: number;
  /** Value below which status is warning (above healthy) */
  warning: number;
  /** Value at or above this is critical */
  critical: number;
  /** Comparison operator */
  operator: 'lt' | 'gt' | 'lte' | 'gte';
}

/**
 * Metric binding configuration for a node
 */
export interface MetricBinding {
  /** Unique identifier for this binding */
  id: string;
  /** Reference to the data source configuration */
  dataSourceId: string;
  /** Display name for the metric */
  displayName: string;
  /** Unit for the metric (e.g., '%', 'ms', 'req/s') */
  unit?: string;
  /** Thresholds for determining status */
  thresholds?: MetricThreshold;
  /** Whether to show this metric on the node */
  showOnNode: boolean;
  /** Whether to show this metric in tooltip */
  showInTooltip: boolean;
  /** Format string for display (e.g., '0.00', '0%') */
  format?: string;
}

/**
 * Live data binding for a model item (node)
 */
export interface NodeLiveDataBinding {
  /** The model item (node) ID this binding applies to */
  nodeId: string;
  /** Primary data source for overall node status */
  primaryDataSourceId?: string;
  /** Metric bindings for this node */
  metrics: MetricBinding[];
  /** Override the node's status indicator color */
  statusOverride?: NodeHealthStatus;
  /** Custom status message */
  statusMessage?: string;
}

/**
 * Real-time metric value with metadata
 */
export interface MetricValue {
  /** The raw value */
  value: number | string | null;
  /** Timestamp of the value */
  timestamp: Date;
  /** Computed status based on thresholds */
  status: NodeHealthStatus;
  /** Error message if fetch failed */
  error?: string;
  /** Whether the value is currently loading */
  loading: boolean;
}

/**
 * Live data state for a node
 */
export interface NodeLiveDataState {
  nodeId: string;
  /** Overall health status (computed from metrics) */
  overallStatus: NodeHealthStatus;
  /** Individual metric values */
  metrics: Record<string, MetricValue>;
  /** Last successful update time */
  lastUpdated: Date | null;
  /** Whether any metric is currently loading */
  loading: boolean;
  /** Connection status */
  connected: boolean;
}

/**
 * Global live analytics configuration
 */
export interface LiveAnalyticsConfig {
  /** Whether live analytics is enabled globally */
  enabled: boolean;
  /** Registered data sources */
  dataSources: DataSourceConfig[];
  /** Node-specific data bindings */
  nodeBindings: NodeLiveDataBinding[];
  /** Default refresh interval in milliseconds */
  defaultRefreshIntervalMs: number;
  /** Whether to show status indicators on nodes */
  showStatusIndicators: boolean;
  /** Whether to show mini-metrics on nodes */
  showMiniMetrics: boolean;
  /** Animation settings for status changes */
  animateStatusChanges: boolean;
}

/**
 * Props for components that display live data
 */
export interface LiveDataDisplayProps {
  nodeId: string;
  compact?: boolean;
  showStatus?: boolean;
  showMetrics?: boolean;
  maxMetrics?: number;
}

/**
 * Props for the Grafana panel embed component
 */
export interface GrafanaPanelEmbedProps {
  url: string;
  dashboardUid: string;
  panelId: number;
  width?: number | string;
  height?: number | string;
  theme?: 'light' | 'dark';
  from?: string;
  to?: string;
  variables?: Record<string, string>;
}

/**
 * Event emitted when metric data is updated
 */
export interface MetricUpdateEvent {
  nodeId: string;
  metricId: string;
  value: MetricValue;
  previousValue?: MetricValue;
}

/**
 * Event emitted when node status changes
 */
export interface StatusChangeEvent {
  nodeId: string;
  newStatus: NodeHealthStatus;
  previousStatus: NodeHealthStatus;
  reason: string;
}
