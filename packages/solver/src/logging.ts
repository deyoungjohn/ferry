import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

const LEVELS: Readonly<Record<number, string>> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const MAX_DETAIL = 200;

function firstLine(text: string): string {
  const line = (text.split('\n')[0] ?? '').trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL)}…` : line;
}

/**
 * Formats a log record into a single short line for terminal output.
 * Full structured records are written to file.
 */
export function formatConsoleLine(raw: string): string {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return firstLine(raw);
  }

  const time =
    typeof record.time === 'number'
      ? new Date(record.time).toISOString().slice(11, 19)
      : '--:--:--';
  const level = LEVELS[Number(record.level)] ?? 'LOG';
  const parts = [`${time} ${level.padEnd(5)} ${String(record.msg ?? '')}`];

  if (typeof record.orderId === 'string') {
    parts.push(`order=${record.orderId.slice(0, 10)}…`);
  }

  const err = record.err as
    { shortMessage?: unknown; message?: unknown } | undefined;
  const detail = err?.shortMessage ?? err?.message;
  if (typeof detail === 'string' && detail.length > 0) {
    parts.push(`— ${firstLine(detail)}`);
  }

  return parts.join(' ');
}

export function createConsoleStream(
  write: (line: string) => void = (line) => console.log(line),
): Writable {
  let pending = '';
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length > 0) {
          write(formatConsoleLine(line));
        }
      }
      callback();
    },
  });
}

export interface LoggerOptions {
  logFilePath?: string | undefined;
  minLevel?: pino.Level | undefined;
}

export function createSolverLogger(options: LoggerOptions = {}): Logger {
  const consoleStream = createConsoleStream();
  const streams: Array<{ level: pino.Level; stream: pino.DestinationStream }> =
    [{ level: 'warn', stream: consoleStream }];

  if (options.logFilePath) {
    const fileStream = pino.destination({
      dest: options.logFilePath,
      sync: false,
      mkdir: true,
    });
    streams.push({ level: options.minLevel ?? 'debug', stream: fileStream });
  }

  return pino(
    {
      level: options.minLevel ?? 'debug',
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}
