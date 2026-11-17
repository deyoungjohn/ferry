import { listDeployedContracts } from '@ferry/chain-config/browser';
import chainsData from '../../../chain-config/src/data/chains.json';
import { BANNER_CONFIG } from '../lib/config';
import { PegCards } from '../components/PegCards';
import { RecentSwapsTable } from '../components/RecentSwapsTable';
import { StatsRow } from '../components/StatsRow';

const deployed = listDeployedContracts(chainsData);

const TESTED = [
  [
    'Contract tests',
    '54 Foundry tests, fuzzing at 20,000 runs, invariants at 10,000 runs of depth 100.',
  ],
  [
    'Mutation testing',
    'The contract test suite catches 35 of 38 deliberate code mutations; the other 3 change only gas use.',
  ],
  [
    'Bitcoin Cash covenant',
    'Over 1,100 deliberately altered claim and refund transactions per token are rejected, apart from a short list of documented harmless variants.',
  ],
  [
    'Attack scenarios',
    '28 adversarial tests: replayed signatures, late locks, wrong secrets, unlisted tokens, oversized requests, and more.',
  ],
  [
    'End to end',
    'Full swaps run against forks of Base, Ethereum, Arbitrum and BNB Chain with the real token contracts, plus a 200-swap load run with no failures.',
  ],
] as const;

const NOT_YET = [
  'No outside security audit has been done.',
  'Real-money swaps are only starting; volume is small and capped.',
  'Arc and Robinhood Chain routes are not enabled: the contract has not been proven on Arc, and Robinhood has no issuer-documented stablecoin.',
  'The solver must be online to quote. Refunds and recovery do not need it.',
] as const;

export function StatsPage() {
  const repo = BANNER_CONFIG.repoUrl;
  return (
    <div className="pb-16">
      <section className="mx-auto max-w-3xl px-4 pt-14 pb-6 text-center sm:px-6">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-5xl">
          Stats
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-text-muted sm:text-base">
          Live numbers from the solver, then what is deployed, what we tested,
          and what we have not done. Test figures are as of 17 November 2026.
        </p>
      </section>

      <section aria-label="Live numbers" className="mx-auto mt-2 max-w-6xl">
        <StatsRow />
        <RecentSwapsTable />
        <PegCards />
      </section>

      <section
        aria-labelledby="deployed-title"
        className="mx-auto mt-6 max-w-4xl px-4 sm:px-6"
      >
        <h2
          id="deployed-title"
          className="text-lg font-semibold tracking-[-0.02em] text-text"
        >
          Deployed contracts
        </h2>
        {deployed.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            No contract is recorded as deployed yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {deployed.map((item) => (
              <li
                key={`${item.chain}-${item.address}`}
                className="rounded-card border border-hairline bg-surface-1/40 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text">{item.name}</p>
                  {item.verified && (
                    <span className="rounded-pill border border-hairline bg-surface-2 px-2.5 py-0.5 text-[11px] text-ok">
                      Source verified
                    </span>
                  )}
                </div>
                <p className="mt-2 break-all font-mono text-xs text-text-muted">
                  {item.address}
                </p>
                <p className="mt-2 text-xs text-text-dim">
                  Chain ID {item.chainId}
                  {item.deployBlock !== null
                    ? ` · deployed at block ${item.deployBlock}`
                    : ''}
                </p>
                <a
                  href={`${item.explorerUrl}/address/${item.address}#code`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-block text-xs text-lime hover:underline"
                >
                  Read the source on the explorer
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-text-dim">
          The same contract is deployed at the same address on every chain we
          enable, through a standard deterministic deployer, so the address
          itself is checkable from the code.
        </p>
      </section>

      <section
        aria-labelledby="tested-title"
        className="mx-auto mt-12 max-w-4xl px-4 sm:px-6"
      >
        <h2
          id="tested-title"
          className="text-lg font-semibold tracking-[-0.02em] text-text"
        >
          What we tested
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TESTED.map(([title, body]) => (
            <div
              key={title}
              className="rounded-card border border-hairline bg-surface-1/40 p-5"
            >
              <dt className="text-sm font-semibold text-text">{title}</dt>
              <dd className="mt-1.5 text-xs leading-relaxed text-text-muted">
                {body}
              </dd>
            </div>
          ))}
        </dl>
        {repo && (
          <p className="mt-4 text-xs text-text-dim">
            The tests and the list of attacks we tried are in the{' '}
            <a
              href={repo}
              target="_blank"
              rel="noreferrer noopener"
              className="text-lime hover:underline"
            >
              open repository
            </a>
            .
          </p>
        )}
      </section>

      <section
        aria-labelledby="notyet-title"
        className="mx-auto mt-12 max-w-4xl px-4 sm:px-6"
      >
        <h2
          id="notyet-title"
          className="text-lg font-semibold tracking-[-0.02em] text-text"
        >
          What we have not done
        </h2>
        <ul className="mt-4 space-y-2">
          {NOT_YET.map((line) => (
            <li
              key={line}
              className="rounded-card border border-hairline bg-surface-1/40 px-5 py-3 text-sm text-text-muted"
            >
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="verify-title"
        className="mx-auto mt-12 max-w-4xl px-4 sm:px-6"
      >
        <h2
          id="verify-title"
          className="text-lg font-semibold tracking-[-0.02em] text-text"
        >
          Verify it yourself
        </h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-text-muted">
          <li>
            Read the contract source on the explorer and compare its address
            with the one above.
          </li>
          <li>
            Download the recovery file before you lock funds; with the command
            line recovery tool you can finish or refund without our site.
          </li>
          <li>
            Check any quote: its reference prices and their sources are inside
            the signed terms and shown in the quote row.
          </li>
          <li>
            Open My Activity: it is rebuilt from the Bitcoin Cash chain, not
            from our database.
          </li>
        </ul>
      </section>
    </div>
  );
}
