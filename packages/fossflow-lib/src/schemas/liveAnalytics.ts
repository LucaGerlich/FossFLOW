/**
 * Zod schemas for Live Analytics data validation
 */
import { z } from 'zod';
import { id } from './common';

/**
 * Data source types
 */
export const dataSourceTypeSchema = z.enum([
  'grafana',
  'prometheus',
  'rest_api',
  'webhook',
  'static'
]);

/**
 * Node health status
 */
export const nodeHealthStatusSchema = z.enum([
  'healthy',
  'warning',
  'critical',
  'unknown',
  'offline'
]);

/**
 * Base data source configuration
 */
export const baseDataSourceConfigSchema = z.object({
  id,
  type: dataSourceTypeSchema,
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  refreshIntervalMs: z.number().min(1000).max(3600000).default(30000),
  timeout: z.number().min(1000).max(60000).optional()
});

/**
 * Grafana data source configuration
 */
export const grafanaDataSourceConfigSchema = baseDataSourceConfigSchema.extend({
  type: z.literal('grafana'),
  url: z.string().url(),
  apiKey: z.string().optional(),
  orgId: z.string().optional(),
  dashboardUid: z.string().optional(),
  panelId: z.number().optional(),
  query: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional()
});

/**
 * Prometheus data source configuration
 */
export const prometheusDataSourceConfigSchema = baseDataSourceConfigSchema.extend({
  type: z.literal('prometheus'),
  url: z.string().url(),
  query: z.string().min(1),
  step: z.string().optional(),
  labelSelectors: z.record(z.string(), z.string()).optional()
});

/**
 * REST API data source configuration
 */
export const restApiDataSourceConfigSchema = baseDataSourceConfigSchema.extend({
  type: z.literal('rest_api'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  valuePath: z.string().optional(),
  statusPath: z.string().optional()
});

/**
 * Webhook data source configuration
 */
export const webhookDataSourceConfigSchema = baseDataSourceConfigSchema.extend({
  type: z.literal('webhook'),
  endpointPath: z.string().min(1).max(200),
  secret: z.string().optional(),
  payloadSchema: z.record(z.string(), z.unknown()).optional()
});

/**
 * Static data source configuration
 */
export const staticDataSourceConfigSchema = baseDataSourceConfigSchema.extend({
  type: z.literal('static'),
  value: z.union([z.number(), z.string()]),
  status: nodeHealthStatusSchema
});

/**
 * Union type for all data source configurations
 */
export const dataSourceConfigSchema = z.discriminatedUnion('type', [
  grafanaDataSourceConfigSchema,
  prometheusDataSourceConfigSchema,
  restApiDataSourceConfigSchema,
  webhookDataSourceConfigSchema,
  staticDataSourceConfigSchema
]);

/**
 * Metric threshold configuration
 */
export const metricThresholdSchema = z.object({
  healthy: z.number(),
  warning: z.number(),
  critical: z.number(),
  operator: z.enum(['lt', 'gt', 'lte', 'gte']).default('lt')
});

/**
 * Metric binding configuration
 */
export const metricBindingSchema = z.object({
  id,
  dataSourceId: z.string().min(1),
  displayName: z.string().min(1).max(50),
  unit: z.string().max(10).optional(),
  thresholds: metricThresholdSchema.optional(),
  showOnNode: z.boolean().default(true),
  showInTooltip: z.boolean().default(true),
  format: z.string().max(20).optional()
});

/**
 * Node live data binding
 */
export const nodeLiveDataBindingSchema = z.object({
  nodeId: z.string().min(1),
  primaryDataSourceId: z.string().optional(),
  metrics: z.array(metricBindingSchema),
  statusOverride: nodeHealthStatusSchema.optional(),
  statusMessage: z.string().max(200).optional()
});

/**
 * Global live analytics configuration
 */
export const liveAnalyticsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dataSources: z.array(dataSourceConfigSchema).default([]),
  nodeBindings: z.array(nodeLiveDataBindingSchema).default([]),
  defaultRefreshIntervalMs: z.number().min(1000).max(3600000).default(30000),
  showStatusIndicators: z.boolean().default(true),
  showMiniMetrics: z.boolean().default(true),
  animateStatusChanges: z.boolean().default(true)
});
