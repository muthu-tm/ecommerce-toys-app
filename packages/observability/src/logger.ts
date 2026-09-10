import { pino } from 'pino';
import type { DestinationStream, Level, Logger, LoggerOptions as PinoLoggerOptions } from 'pino';

import { getRequestContext } from './correlation';
import { createRedactor } from './redact';
import type { RedactOptions } from './redact';

/**
 * The structured logger.
 *
 * `no-console` is a lint error across the workspace, so this is the only way
 * anything gets logged. Two properties are non-negotiable:
 *
 *  1. **Every line carries the correlation ID**, injected from the ambient request
 *     context rather than passed by the caller — a caller who has to remember will
 *     eventually not.
 *  2. **Every line is redacted before serialisation.** The hook runs on the whole
 *     merged object, so `logger.info({ user })` cannot leak a phone number or email
 *     no matter how deeply it is nested.
 */

export type LogLevel = Level;

export interface LoggerOptions {
  /** Service name — `storefront`, `admin`, `api`, `functions`. */
  readonly name: string;
  readonly level?: LogLevel;
  /** Pretty-print for local development. Never in production: it costs throughput. */
  readonly pretty?: boolean;
  readonly redact?: RedactOptions;
  /** Fields attached to every line, e.g. release and store ID. */
  readonly base?: Readonly<Record<string, unknown>>;
  /** Override the output stream. Used by tests to capture lines. */
  readonly destination?: DestinationStream;
}

export type AppLogger = Logger;

export function createLogger(options: LoggerOptions): AppLogger {
  const redactor = createRedactor(options.redact);

  const pinoOptions = {
    name: options.name,
    level: options.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    base: { service: options.name, ...options.base },

    // Applied to the merged object of every line, which is what makes redaction a
    // property of the logger rather than a discipline expected of callers.
    formatters: {
      log: (object: Record<string, unknown>): Record<string, unknown> =>
        redactor(object) as Record<string, unknown>,
      // Emit `level: "info"` rather than `level: 30`. Log search is read by people.
      level: (label: string) => ({ level: label }),
    },

    // Injected per line, so context follows the async chain instead of the call site.
    mixin: (): Record<string, unknown> => {
      const context = getRequestContext();
      if (context === undefined) return {};
      return {
        requestId: context.requestId,
        ...(context.uid === undefined ? {} : { uid: context.uid }),
        ...(context.route === undefined ? {} : { route: context.route }),
      };
    },

    // Cloud Logging reads `message` and an ISO timestamp.
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
  } satisfies PinoLoggerOptions;

  if (options.destination !== undefined) {
    return pino(pinoOptions, options.destination);
  }

  if (options.pretty === true) {
    return pino({
      ...pinoOptions,
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } },
    });
  }

  return pino(pinoOptions);
}

/**
 * A logger that discards everything.
 *
 * For unit tests of code that logs, where the assertion is about behaviour and log
 * output is noise. Tests that assert *on* log content should use `destination`
 * instead so they read the real serialisation path, redaction included.
 */
export function createSilentLogger(): AppLogger {
  return pino({ level: 'silent' });
}
