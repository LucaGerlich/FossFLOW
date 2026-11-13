import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { z } from 'zod';

export type OtlpFormat = 'protobuf' | 'json';

/** `proto/` at the package root, from both `src/ingest` and `dist/ingest`. */
const PROTO_DIR = fileURLToPath(new URL('../../proto', import.meta.url));
const TRACE_SERVICE_PROTO =
  'opentelemetry/proto/collector/trace/v1/trace_service.proto';
const REQUEST_TYPE =
  'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest';

export class OtlpDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpDecodeError';
  }
}

/** int64 arrives as a decimal string (protobuf, OTLP JSON) or a number. */
const UINT64_MAX = 18446744073709551615n;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

const nanoTime = z
  .union([
    z.string().regex(/^\d{1,20}$/),
    z.number().int().nonnegative().safe()
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value <= UINT64_MAX);

const intValue = z.union([
  z
    .string()
    .regex(/^-?\d{1,20}$/)
    .refine((value) => {
      const parsed = BigInt(value);
      return parsed >= INT64_MIN && parsed <= INT64_MAX;
    }),
  z
    .number()
    .int()
    .refine((value) => value >= -(2 ** 63) && value < 2 ** 63)
]);

const keyValueSchema = z.object({
  key: z.string(),
  value: z
    .object({
      stringValue: z.string().optional(),
      intValue: intValue.optional(),
      boolValue: z.boolean().optional(),
      // NaN and Infinity (protobuf can carry them) drop the value, not the batch.
      doubleValue: z.number().optional().catch(undefined)
    })
    .optional()
});

const spanSchema = z.object({
  kind: z.number().int().optional(),
  name: z.string().optional(),
  startTimeUnixNano: nanoTime,
  endTimeUnixNano: nanoTime,
  attributes: z.array(keyValueSchema).optional(),
  status: z.object({ code: z.number().int().optional() }).optional()
});

const traceRequestSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        resource: z
          .object({ attributes: z.array(keyValueSchema).optional() })
          .optional(),
        scopeSpans: z
          .array(z.object({ spans: z.array(spanSchema).optional() }))
          .optional()
      })
    )
    .optional()
});

export type OtlpTraceRequest = z.infer<typeof traceRequestSchema>;
export type OtlpSpan = z.infer<typeof spanSchema>;
export type OtlpKeyValue = z.infer<typeof keyValueSchema>;

let requestType: protobuf.Type | undefined;

const loadRequestType = (): protobuf.Type => {
  if (!requestType) {
    const root = new protobuf.Root();
    root.resolvePath = (_origin, target) => join(PROTO_DIR, target);
    root.loadSync(TRACE_SERVICE_PROTO);
    requestType = root.lookupType(REQUEST_TYPE);
  }
  return requestType;
};

export const formatOf = (contentType: string | undefined): OtlpFormat | null => {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  if (mediaType === 'application/x-protobuf') return 'protobuf';
  if (mediaType === 'application/json') return 'json';
  return null;
};

const toPlainObject = (body: Buffer, format: OtlpFormat): unknown => {
  if (format === 'json') {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new OtlpDecodeError('Request body is not valid JSON');
    }
  }
  const type = loadRequestType();
  try {
    return type.toObject(type.decode(body), {
      longs: String,
      enums: Number,
      defaults: false
    });
  } catch {
    throw new OtlpDecodeError('Request body is not a valid OTLP protobuf');
  }
};

export const decodeTraceRequest = (
  body: Buffer,
  format: OtlpFormat
): OtlpTraceRequest => {
  const parsed = traceRequestSchema.safeParse(toPlainObject(body, format));
  if (!parsed.success) {
    throw new OtlpDecodeError('Request body is not a valid OTLP trace request');
  }
  return parsed.data;
};
