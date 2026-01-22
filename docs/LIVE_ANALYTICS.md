# Live Analytics Feature

FossFLOW's Live Analytics feature transforms your infrastructure diagrams into real-time monitoring dashboards. Connect nodes to data sources like Grafana, Prometheus, and REST APIs to visualize the health and metrics of your systems directly on the diagram.

## Overview

The Live Analytics feature allows you to:

- **Connect to Multiple Data Sources**: Grafana, Prometheus, REST APIs, Webhooks, and static values for testing
- **Display Real-Time Metrics**: Show live values directly on diagram nodes
- **Health Status Indicators**: Visual color-coded indicators (green/yellow/red) based on configurable thresholds
- **Embed Grafana Panels**: View detailed Grafana dashboards in node tooltips
- **Configure Thresholds**: Set custom threshold values to determine healthy, warning, and critical states

## Quick Start

### 1. Enable Live Analytics

1. Open **Settings** → **Live Analytics** tab
2. Toggle **Enable Live Analytics** to ON
3. Configure your preferred display options

### 2. Add a Data Source

1. Click **Configure Data Sources** in the Live Analytics settings
2. Click **Add Data Source**
3. Select a data source type:
   - **Grafana**: Connect to Grafana dashboards
   - **Prometheus**: Query metrics directly via PromQL
   - **REST API**: Fetch data from any HTTP endpoint
   - **Static**: Use fixed values for testing

4. Fill in the connection details
5. Click **Test Connection** to verify
6. Save the data source

### 3. Bind Metrics to a Node

1. Right-click on a node in your diagram
2. Select **Configure Live Data**
3. Click **Add Metric Binding**
4. Select the data source and configure the metric
5. Set thresholds for status colors
6. Click **Apply Changes**

## Data Source Types

### Grafana

Connect to Grafana to use existing dashboards and queries.

**Configuration:**
- **URL**: Your Grafana instance URL (e.g., `https://grafana.example.com`)
- **API Key**: (Optional) For authenticated access
- **Dashboard UID**: The unique identifier of the dashboard
- **Panel ID**: The specific panel to query
- **Query**: PromQL or native Grafana query

**Example:**
```
URL: https://grafana.example.com
Dashboard UID: abc123
Panel ID: 1
Query: rate(http_requests_total[5m])
```

### Prometheus

Query Prometheus directly using PromQL.

**Configuration:**
- **URL**: Your Prometheus server URL
- **Query**: PromQL expression

**Example:**
```
URL: https://prometheus.example.com
Query: 100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

### REST API

Fetch metrics from any REST endpoint.

**Configuration:**
- **URL**: The API endpoint URL
- **Method**: GET or POST
- **Headers**: Custom headers (JSON format)
- **Body**: Request body for POST requests
- **Value JSONPath**: Path to extract the value (e.g., `$.data.value`)

**Example:**
```
URL: https://api.example.com/metrics/cpu
Method: GET
Headers: {"Authorization": "Bearer token123"}
Value JSONPath: $.cpu_percent
```

### Static (Demo)

Use fixed values for testing and demonstrations.

**Configuration:**
- **Value**: A fixed numeric or string value
- **Status**: The health status to display

## Threshold Configuration

Thresholds determine when a node's status changes from healthy (green) to warning (yellow) to critical (red).

### Comparison Operators

- **Less than (alert when HIGH)**: Used for metrics where higher values indicate problems (CPU %, memory %, error rates)
- **Greater than (alert when LOW)**: Used for metrics where lower values indicate problems (uptime %, success rates)

### Example: CPU Usage Monitoring

For a CPU usage metric where high values are bad:

| Threshold | Value | Status |
|-----------|-------|--------|
| Healthy   | 70    | Green (0-69%) |
| Warning   | 85    | Yellow (70-84%) |
| Critical  | 95    | Red (85%+) |

### Example: Uptime Monitoring

For an uptime metric where low values are bad:

| Threshold | Value | Status |
|-----------|-------|--------|
| Healthy   | 99.9  | Green (99.9%+) |
| Warning   | 99.0  | Yellow (99.0-99.9%) |
| Critical  | 95.0  | Red (<95%) |

## Components

### StatusIndicator

A colored dot showing the health status of a node.

- **Green**: Healthy
- **Yellow/Amber**: Warning
- **Red**: Critical
- **Gray**: Unknown/Offline

### MiniMetricsDisplay

Compact metric values displayed directly on nodes showing current values with units.

### NodeLiveDataOverlay

The overlay component that adds live data visualization to existing nodes without modifying the base node component.

### GrafanaPanelEmbed

Embeds an interactive Grafana panel within the diagram interface.

## API Reference

### Types

```typescript
// Data source configuration
interface DataSourceConfig {
  id: string;
  type: 'grafana' | 'prometheus' | 'rest_api' | 'webhook' | 'static';
  name: string;
  enabled: boolean;
  refreshIntervalMs: number;
  // Type-specific fields...
}

// Metric binding for a node
interface MetricBinding {
  id: string;
  dataSourceId: string;
  displayName: string;
  unit?: string;
  thresholds?: MetricThreshold;
  showOnNode: boolean;
  showInTooltip: boolean;
  format?: string;
}

// Health status enum
type NodeHealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown' | 'offline';
```

### Hooks

```typescript
// Access the live analytics store
const { config, enabled, setEnabled, updateConfig, refreshAll } = useLiveAnalyticsConfig();

// Get live data for a specific node
const { state, status, metrics, refresh } = useNodeLiveData(nodeId);

// Manage data sources
const { dataSources, addDataSource, removeDataSource, updateDataSource } = useDataSources();

// Manage node metric bindings
const { metrics, bindMetrics, unbindMetrics } = useNodeMetricBindings(nodeId);
```

## Best Practices

1. **Start with Static Data Sources**: Test your configuration with static values before connecting to production systems

2. **Set Appropriate Refresh Intervals**: Balance between real-time updates and API rate limits
   - Critical metrics: 5-15 seconds
   - Standard metrics: 30-60 seconds
   - Low-priority metrics: 2-5 minutes

3. **Use Meaningful Thresholds**: Base thresholds on historical data and SLOs

4. **Limit Metrics Per Node**: Show 2-3 most important metrics on nodes, use tooltips for details

5. **Test Connections**: Always test data source connections before binding to nodes

## Troubleshooting

### Data Source Connection Failed

- Verify the URL is correct and accessible
- Check if CORS is enabled on the server
- Ensure API keys/authentication are valid
- Check network connectivity

### Metrics Not Updating

- Verify the data source is enabled
- Check the refresh interval
- Look for errors in the browser console
- Test the data source connection

### Status Shows Unknown

- The data source may not have returned a value
- Thresholds might not be configured
- Check if the metric binding's data source exists

## Security Considerations

- API keys are stored in browser memory and diagram exports
- Consider using environment variables for sensitive credentials in production
- Use HTTPS for all data source connections
- Be cautious when embedding external Grafana panels (iframe security)

## Future Enhancements

- [ ] WebSocket support for real-time streaming
- [ ] Alert notifications
- [ ] Historical trend charts
- [ ] More data source integrations (Datadog, CloudWatch, etc.)
- [ ] Export live data configurations separately from diagrams
