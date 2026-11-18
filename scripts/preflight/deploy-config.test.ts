import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${root}/${relative}`, 'utf8');
}

describe('Caddy configuration', () => {
  const caddy = read('deploy/Caddyfile');

  it('serves the web build and proxies the one-origin API', () => {
    expect(caddy).toContain('example.org');
    expect(caddy).toContain('root * /var/www/ferry/dist');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:8787');
    expect(caddy).toContain('try_files {path} /index.html');
    expect(caddy).toContain('/swap/<hash>');
    expect(caddy).not.toContain('handle /swap/*');
    expect(caddy).toContain('file_server');
    expect(caddy).toContain('encode zstd gzip');
    expect(caddy.indexOf('handle /v1/*')).toBeLessThan(
      caddy.indexOf('handle {'),
    );
  });

  it('has the security headers and no CDN trust', () => {
    expect(caddy).toContain('Strict-Transport-Security');
    expect(caddy).toContain('X-Frame-Options "DENY"');
    expect(caddy).toContain('X-Content-Type-Options "nosniff"');
    expect(caddy).toContain('Referrer-Policy');
    expect(caddy).toContain('Permissions-Policy');
    expect(caddy).toContain('Content-Security-Policy');
    expect(caddy).toContain("connect-src 'self'");
    expect(caddy).toContain("frame-ancestors 'none'");
    expect(caddy).not.toContain('trusted_proxies');
    expect(caddy).not.toContain('solver.');
  });

  it('truncates client addresses in the access log', () => {
    expect(caddy).toContain('request>remote_ip ip_mask');
    expect(caddy).toContain('request>client_ip ip_mask');
    expect(caddy).toContain('request>headers>X-Forwarded-For delete');
    expect(caddy).toContain('common_log delete');
    expect(caddy).toContain('ipv4 24');
    expect(caddy).toContain('ipv6 56');
    expect(caddy).not.toMatch(
      /\b(?!203\.0\.113\.10\b)\d{1,3}(?:\.\d{1,3}){3}\b.*example\.org/,
    );
  });
});

describe('systemd units', () => {
  const solver = read('deploy/systemd/ferry-solver.service');
  const backup = read('deploy/systemd/ferry-backup.service');
  const backupTimer = read('deploy/systemd/ferry-backup.timer');
  const health = read('deploy/systemd/ferry-health.service');
  const healthTimer = read('deploy/systemd/ferry-health.timer');

  it('runs the solver from source in the one clone, the way the tests run it', () => {
    expect(solver).toMatch(
      /^WorkingDirectory=\/opt\/ferry\/packages\/solver$/m,
    );
    expect(solver).toMatch(
      /^ExecStart=\/usr\/local\/bin\/node --conditions=ferry-source --import tsx src\/main\.ts$/m,
    );
    expect(solver).not.toContain('/home/');
  });

  it('runs the solver as ferry with a strict sandbox and graceful stop', () => {
    expect(solver).toMatch(/^User=ferry$/m);
    expect(solver).toMatch(/^Group=ferry$/m);
    expect(solver).toContain('EnvironmentFile=/etc/ferry/solver.env');
    expect(solver).toContain('NoNewPrivileges=true');
    expect(solver).toContain('ProtectSystem=strict');
    expect(solver).toContain('ReadWritePaths=/var/lib/ferry /var/log/ferry');
    expect(solver).toContain('Restart=on-failure');
    expect(solver).toContain('RestartSteps=10');
    expect(solver).toContain('TimeoutStopSec=90s');
    expect(solver).toMatch(/^MemoryMax=/m);
  });

  it('backs up SQLite every 15 minutes and keeps 48 files', () => {
    const script = read('deploy/backup.sh');
    expect(backup).toContain('ConditionPathExists=/var/lib/ferry/solver.db');
    expect(backupTimer).toContain('OnUnitInactiveSec=15min');
    expect(script).toContain('.backup');
    expect(script).toContain('tail -n +49');
    expect(script).toContain('daily-backup.sh');
  });

  it('checks both health endpoints every minute', () => {
    const script = read('deploy/healthcheck.sh');
    expect(health).toContain('ExecStart=/usr/local/sbin/ferry-healthcheck');
    expect(healthTimer).toContain('OnUnitInactiveSec=1min');
    expect(script).toContain('/v1/health');
    expect(script).toContain('/v1/ready');
    expect(script).toContain('ferry-health: health=%s ready=%s');
  });
});

describe('bootstrap and file safety', () => {
  const bootstrap = read('deploy/bootstrap.sh');

  it('is idempotent, fail-closed and installs the required services', () => {
    expect(bootstrap).toContain('set -euo pipefail');
    expect(bootstrap).toContain('ufw');
    expect(bootstrap).toContain('fail2ban');
    expect(bootstrap).toContain('unattended-upgrades');
    expect(bootstrap).toContain('fnm');
    expect(bootstrap).toContain('pnpm@');
    expect(bootstrap).toContain('caddy');
    expect(bootstrap).toContain('chmod 0600 /etc/ferry/solver.env');
    expect(bootstrap).toContain('/var/lib/ferry');
    expect(bootstrap).toContain('/var/log/ferry');
  });

  it('contains no real key, WIF or non-example public IP', () => {
    const files = [
      bootstrap,
      read('deploy/backup.sh'),
      read('deploy/healthcheck.sh'),
      read('deploy/Caddyfile'),
      read('deploy/README.md'),
    ].join('\n');
    expect(files).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(files).not.toMatch(/\b[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}\b/);
  });

  it('has valid shell syntax', () => {
    for (const file of [
      'deploy/bootstrap.sh',
      'deploy/backup.sh',
      'deploy/healthcheck.sh',
    ]) {
      expect(() =>
        execFileSync('bash', ['-n', `${root}/${file}`], {
          stdio: 'pipe',
        }),
      ).not.toThrow();
    }
  });
});

describe('the server operations script', () => {
  const ops = read('deploy/ferry-ops.sh');

  it('stops on errors, runs the self-check as the service user with its settings, and never prints them', () => {
    expect(ops).toContain('set -euo pipefail');
    expect(ops).toContain('sudo -u ferry');
    expect(ops).toContain('with-solver-env.sh');
    expect(ops).toContain('src/selfcheck.ts');
    expect(ops).toContain('/etc/ferry/solver.env');
    expect(ops).not.toMatch(/cat\s+"?\$ENV_FILE/);
    expect(ops).not.toMatch(/echo[^\n]*\$ENV_FILE/);
  });

  it('offers update, health, caddy, logs and rollback', () => {
    for (const word of [
      'health)',
      'update)',
      'caddy)',
      'env)',
      'logs)',
      'rollback)',
    ]) {
      expect(ops).toContain(word);
    }
  });

  it('is valid shell', () => {
    execFileSync('bash', ['-n', `${root}/deploy/ferry-ops.sh`]);
    execFileSync('bash', ['-n', `${root}/deploy/with-solver-env.sh`]);
  });

  it('loads KEY=value lines the way the service does: quotes, comments, URLs, blanks, bad names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-env-'));
    try {
      const file = join(dir, 'solver.env');
      writeFileSync(
        file,
        [
          '# a comment',
          'SOLVER_EVM_PRIVATE_KEY=0xabc123',
          'QUOTED="two words & more"',
          "SINGLE='x=y#z'",
          'URLS=wss://a.example:50004,wss://b.example:50004',
          'EMPTY=',
          'bad key=ignored',
          '',
        ].join('\n'),
      );
      const out = execFileSync(
        'bash',
        [
          `${root}/deploy/with-solver-env.sh`,
          'bash',
          '-c',
          'printf "%s|%s|%s|%s|%s" "$SOLVER_EVM_PRIVATE_KEY" "$QUOTED" "$SINGLE" "$URLS" "$EMPTY"',
        ],
        { env: { ENV_FILE: file, PATH: process.env.PATH ?? '' } },
      ).toString();
      expect(out).toBe(
        '0xabc123|two words & more|x=y#z|wss://a.example:50004,wss://b.example:50004|',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores carriage returns and stray spaces, as systemd does (a file saved on Windows)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-env-'));
    try {
      const file = join(dir, 'solver.env');
      writeFileSync(
        file,
        'NETWORK=mainnet\r\n  KEY = 0xabc  \r\nexport OTHER="a b"\r\nLAST=end',
      );
      const out = execFileSync(
        'bash',
        [
          `${root}/deploy/with-solver-env.sh`,
          'bash',
          '-c',
          'printf "[%s][%s][%s][%s]" "$NETWORK" "$KEY" "$OTHER" "$LAST"',
        ],
        { env: { ENV_FILE: file, PATH: process.env.PATH ?? '' } },
      ).toString();
      expect(out).toBe('[mainnet][0xabc][a b][end]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses plainly when the env file is missing', () => {
    expect(() =>
      execFileSync('bash', [`${root}/deploy/with-solver-env.sh`, 'true'], {
        env: {
          ENV_FILE: '/nonexistent/solver.env',
          PATH: process.env.PATH ?? '',
        },
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
