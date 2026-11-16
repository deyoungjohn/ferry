import { NETWORK_LABEL, NETWORK_CONFIG_ERRORS } from '../lib/config';
import { AlertTriangleIcon } from './icons';

export function NetworkBlockedPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-warn/15 text-warn mb-6">
        <AlertTriangleIcon className="size-8" />
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {NETWORK_LABEL} Configuration Incomplete
      </h1>

      <p className="mt-3 text-sm text-text-muted leading-relaxed">
        The mainnet deployment profile is empty by default and has not yet been
        provisioned with verified contract addresses and endpoints.
      </p>

      {NETWORK_CONFIG_ERRORS.length > 0 && (
        <div className="mt-6 w-full rounded-xl border border-hairline bg-surface-2 p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-dim mb-2">
            Configuration Status
          </p>
          <ul className="space-y-1.5 text-xs text-warn list-disc list-inside">
            {NETWORK_CONFIG_ERRORS.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-xs text-text-dim">
        Review deployment settings in your environment configuration.
      </p>
    </main>
  );
}
