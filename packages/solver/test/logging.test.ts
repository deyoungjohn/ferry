import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  createConsoleStream,
  createRotatingFileStream,
  formatConsoleLine,
} from '../src/logging.js';

describe('Quiet logging formatting', () => {
  it('turns a 20 KB error object into one short line', () => {
    const huge = 'x'.repeat(20_000);
    const line = formatConsoleLine(
      JSON.stringify({
        level: 50,
        time: 1793377346896,
        msg: 'Transaction submission rejected',
        orderId: `0x${'ab'.repeat(32)}`,
        err: {
          shortMessage: 'Execution reverted: invalid signature.',
          message: `${huge}\nVersion: viem`,
          stack: huge,
        },
      }),
    );

    expect(line).toContain('ERROR Transaction submission rejected');
    expect(line).toContain('order=0xabababab');
    expect(line).toContain('Execution reverted: invalid signature.');
    expect(line.length).toBeLessThan(300);
    expect(line.includes('\n')).toBe(false);
  });

  it('truncates a long first line at 200 characters and handles non-JSON plain text', () => {
    const line = formatConsoleLine(
      JSON.stringify({
        level: 40,
        time: 1793377346896,
        msg: 'Warning message',
        err: { message: 'y'.repeat(900) },
      }),
    );
    expect(line.length).toBeLessThan(320);
    expect(line).toContain('…');
    expect(formatConsoleLine('plain string without json')).toBe(
      'plain string without json',
    );
  });

  it('reassembles records split across chunk boundaries in console stream', () => {
    const lines: string[] = [];
    const stream = createConsoleStream((l) => lines.push(l));
    const record = JSON.stringify({
      level: 40,
      time: 0,
      msg: 'split message across chunks',
    });
    stream.write(record.slice(0, 15));
    stream.write(`${record.slice(15)}\n`);
    expect(lines).toEqual(['00:00:00 WARN  split message across chunks']);
  });

  it('rotates log file when size threshold is reached', () => {
    const tmpDir = `/tmp/test-solver-logging-${Date.now()}`;
    const logPath = `${tmpDir}/solver.log`;
    const rotatingStream = createRotatingFileStream(logPath, 100, 3);

    // Write chunks that exceed 100 bytes
    rotatingStream.write(Buffer.from('A'.repeat(60)));
    rotatingStream.write(Buffer.from('B'.repeat(60)));

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
  });
});
