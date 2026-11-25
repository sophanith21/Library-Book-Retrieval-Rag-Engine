import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

/**
 * Bootstraps OpenTelemetry (traces, metrics, and logs) over OTLP/HTTP for
 * Grafana otel-lgtm. Call at the very top of each service's main.ts before
 * NestFactory creates the application so auto-instrumentations (Express,
 * HTTP, amqplib, pg) patch modules cleanly.
 *
 * Set OTEL_SDK_DISABLED=true or omit OTEL_EXPORTER_OTLP_ENDPOINT to run
 * without exporting telemetry.
 */
export function initTelemetry(defaultServiceName: string): NodeSDK | null {
  if (sdk) return sdk;
  if (process.env.OTEL_SDK_DISABLED === 'true') return null;

  const rawEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!rawEndpoint) return null;

  const endpoint = rawEndpoint.replace(/\/+$/, '');
  const serviceName = process.env.OTEL_SERVICE_NAME ?? defaultServiceName;

  diag.setLogger(
    new DiagConsoleLogger(),
    process.env.OTEL_LOG_LEVEL === 'DEBUG'
      ? DiagLogLevel.DEBUG
      : DiagLogLevel.WARN,
  );

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: Number(
        process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 15_000,
      ),
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${endpoint}/v1/logs`,
        }),
        { scheduledDelayMillis: 1000 },
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is very noisy in NestJS watch mode
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(
    `[OTel] Exporting traces, metrics & logs for "${serviceName}" -> ${endpoint}`,
  );

  const shutdown = () => {
    sdk
      ?.shutdown()
      .catch((err) => console.error('OTel shutdown error:', err));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
}
