import { ConsoleLogger } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

/**
 * Drop-in NestJS Logger that keeps normal console output (for docker compose
 * logs) while forwarding every log entry to OpenTelemetry (Grafana Loki)
 * with automatic trace_id / span_id correlation.
 */
export class OtelLogger extends ConsoleLogger {
  private readonly serviceName: string;

  constructor(serviceName?: string) {
    super();
    this.serviceName =
      serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'lbre-service';
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message, ...optionalParams);
    this.emitOtel(SeverityNumber.INFO, 'INFO', message, optionalParams);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message, ...optionalParams);
    this.emitOtel(SeverityNumber.WARN, 'WARN', message, optionalParams);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...optionalParams);
    this.emitOtel(SeverityNumber.ERROR, 'ERROR', message, optionalParams);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message, ...optionalParams);
    this.emitOtel(SeverityNumber.DEBUG, 'DEBUG', message, optionalParams);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message, ...optionalParams);
    this.emitOtel(SeverityNumber.TRACE, 'VERBOSE', message, optionalParams);
  }

  private emitOtel(
    severityNumber: SeverityNumber,
    severityText: string,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    try {
      const otelLogger = logs.getLogger(this.serviceName);
      const context =
        optionalParams.length > 0 &&
        typeof optionalParams[optionalParams.length - 1] === 'string'
          ? (optionalParams[optionalParams.length - 1] as string)
          : undefined;

      const body =
        typeof message === 'string'
          ? message
          : message instanceof Error
            ? message.stack ?? message.message
            : JSON.stringify(message);

      otelLogger.emit({
        severityNumber,
        severityText,
        body,
        attributes: {
          'service.name': this.serviceName,
          ...(context ? { 'nest.context': context } : {}),
        },
      });
    } catch {
      // Never let telemetry emission break application logging
    }
  }
}
