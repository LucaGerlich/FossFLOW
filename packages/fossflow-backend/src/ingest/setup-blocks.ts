export interface SetupStep {
  kind: 'install' | 'env' | 'file';
  file?: string;
  code: string;
}

export interface SetupBlock {
  id: 'node-cjs' | 'node-esm' | 'nextjs';
  steps: SetupStep[];
}

export interface SetupInput {
  endpoint: string;
  key: string;
  serviceName: string;
}

const BASE_PACKAGES = '@opentelemetry/api @opentelemetry/auto-instrumentations-node';

/** The OTEL_* lines every setup shares; the service name is validated to need no quoting. */
const otelLines = ({ endpoint, key, serviceName }: SetupInput): string[] => [
  `OTEL_SERVICE_NAME=${serviceName}`,
  'OTEL_TRACES_EXPORTER=otlp',
  'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
  `OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
  `OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=${key}`,
  'OTEL_BSP_SCHEDULE_DELAY=1000',
  'OTEL_TRACES_SAMPLER=always_on',
  'OTEL_METRICS_EXPORTER=none',
  'OTEL_LOGS_EXPORTER=none'
];

const install = (packages: string): SetupStep => ({ kind: 'install', code: `npm i ${packages}` });
const env = (lines: string[]): SetupStep => ({ kind: 'env', code: lines.join('\n') });

/** Copy-paste setup for each supported runtime, with the new key filled in. */
export function setupBlocks(input: SetupInput): SetupBlock[] {
  const lines = otelLines(input);
  return [
    {
      id: 'node-cjs',
      steps: [
        install(BASE_PACKAGES),
        env([...lines, 'NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"'])
      ]
    },
    {
      id: 'node-esm',
      steps: [
        // The loader hook lives in @opentelemetry/instrumentation; strict package managers need it direct.
        install(`${BASE_PACKAGES} @opentelemetry/instrumentation`),
        env([
          ...lines,
          'NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register"'
        ])
      ]
    },
    {
      id: 'nextjs',
      steps: [
        install('@opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node'),
        {
          kind: 'file',
          file: 'instrumentation.ts',
          code: [
            'export async function register() {',
            "  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation.node');",
            '}'
          ].join('\n')
        },
        {
          kind: 'file',
          file: 'instrumentation.node.ts',
          code: [
            "import { NodeSDK } from '@opentelemetry/sdk-node';",
            "import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';",
            '',
            'new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] }).start();'
          ].join('\n')
        },
        env([...lines, 'NEXT_OTEL_FETCH_DISABLED=1'])
      ]
    }
  ];
}
