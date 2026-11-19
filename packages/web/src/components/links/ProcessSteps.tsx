import { Fragment } from 'react';
import { TxLink } from '../TxLink';

export interface ProcessTx {
  readonly label: string;
  readonly hash: string;
  readonly url: string | null;
}

export interface ProcessStep {
  readonly id: string;
  readonly label: string;
  readonly state: 'done' | 'active' | 'todo';
  /** What the step is waiting for, shown under the active step. */
  readonly note?: string | undefined;
  /** When the step happened (Unix seconds), from the server's record. */
  readonly at?: number | undefined;
  /** The transactions of this step, each a link to the block explorer. */
  readonly txs?: readonly ProcessTx[] | undefined;
}

/** The step-by-step blocks of a swap, joined by a line: done, the one in progress, still to come. */
export function ProcessSteps({
  steps,
}: {
  readonly steps: readonly ProcessStep[];
}) {
  return (
    <ol className="flex flex-1 flex-col" data-testid="process-steps">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          <li
            data-testid={`process-step-${step.id}`}
            data-state={step.state}
            className={`relative flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              step.state === 'active'
                ? 'border-lime/40 bg-surface-2'
                : step.state === 'done'
                  ? 'border-hairline bg-surface-1/50'
                  : 'border-hairline bg-surface-1'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${
                step.state === 'done'
                  ? 'bg-lime text-lime-ink'
                  : step.state === 'active'
                    ? 'border border-lime text-lime'
                    : 'border border-hairline text-text-dim'
              }`}
            >
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <div className="min-w-0">
              <p
                className={
                  step.state === 'active'
                    ? 'font-medium text-text'
                    : step.state === 'done'
                      ? 'text-text-muted'
                      : 'text-text-dim'
                }
              >
                {step.label}
              </p>
              {step.at ? (
                <p className="mt-0.5 text-xs tabular-nums text-text-dim">
                  {formatStepTime(step.at)}
                </p>
              ) : null}
              {step.state === 'active' && step.note && (
                <p className="mt-0.5 text-xs text-text-muted">{step.note}</p>
              )}
              {step.txs?.map((tx) => (
                <TxLink key={tx.label} {...tx} />
              ))}
            </div>
          </li>
          {index < steps.length - 1 && (
            <li
              aria-hidden="true"
              className={`ml-[22px] min-h-3 w-px flex-1 ${
                step.state === 'done' ? 'bg-lime' : 'bg-hairline'
              }`}
            />
          )}
        </Fragment>
      ))}
    </ol>
  );
}

function formatStepTime(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(seconds * 1000));
}
