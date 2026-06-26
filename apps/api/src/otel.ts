import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | undefined;

export function initTelemetry(): void {
  if (!endpoint) {
    return;
  }

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  sdk = new NodeSDK({
    traceExporter,
    // Disable fs instrumentation: it emits a span for every filesystem call
    // (module loads, template reads, static assets), which floods the trace
    // backend and adds measurable per-request overhead for no diagnostic value
    // in this HTTP/DB-bound service.
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'bidstack-api',
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '0.1.0',
    }),
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
