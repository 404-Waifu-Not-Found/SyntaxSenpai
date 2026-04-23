export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

export type LogFormat = "json" | "pretty";

export interface LoggerOptions {
  name?: string;
  level?: LogLevel;
  format?: LogFormat;
  bindings?: Record<string, unknown>;
}

export interface Logger {
  level: LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
  child(bindings: Record<string, unknown>): Logger;
  trace(msg: string): void;
  trace(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export function createLogger(options?: LoggerOptions): Logger;

export function generateRequestId(): string;

export const LEVELS: Readonly<Record<LogLevel, number>>;
