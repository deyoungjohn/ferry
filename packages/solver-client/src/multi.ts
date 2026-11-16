import {
  QuoteRequestSchema,
  type QuoteRefusal,
  type QuoteRequest,
} from '@ferry/core/api';
import { SolverClient, type FetchLike } from './client.js';
import {
  QuoteVerificationError,
  SolverHttpError,
  SolverNetworkError,
  SolverRefusalError,
  SolverSchemaError,
  SolverTimeoutError,
} from './errors.js';
import {
  verifyQuote,
  type QuoteCheckContext,
  type VerifiedQuote,
} from './verify.js';

export interface BestQuoteOptions extends QuoteCheckContext {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly nowMs?: () => number;
}

export interface VerifiedSolverQuote {
  readonly solverUrl: string;
  readonly latencyMs: number;
  readonly quote: VerifiedQuote;
}

export type SolverFailureKind =
  'refusal' | 'verification' | 'timeout' | 'network' | 'http' | 'schema';

export interface SolverQuoteFailure {
  readonly solverUrl: string;
  readonly kind: SolverFailureKind;
  readonly latencyMs: number;
  readonly message: string;
  readonly refusal?: QuoteRefusal;
  readonly field?: string;
}

export interface BestQuoteResult {
  readonly best: VerifiedSolverQuote | null;
  readonly quotes: readonly VerifiedSolverQuote[];
  readonly failures: readonly SolverQuoteFailure[];
}

function classifyFailure(
  solverUrl: string,
  latencyMs: number,
  error: unknown,
): SolverQuoteFailure {
  if (error instanceof SolverRefusalError) {
    return {
      solverUrl,
      kind: 'refusal',
      latencyMs,
      message: error.message,
      refusal: error.refusal,
    };
  }
  if (error instanceof QuoteVerificationError) {
    return {
      solverUrl,
      kind: 'verification',
      latencyMs,
      message: error.message,
      field: error.field,
    };
  }
  if (error instanceof SolverTimeoutError) {
    return {
      solverUrl,
      kind: 'timeout',
      latencyMs,
      message: error.message,
    };
  }
  if (error instanceof SolverSchemaError) {
    return {
      solverUrl,
      kind: 'schema',
      latencyMs,
      message: error.message,
    };
  }
  if (error instanceof SolverHttpError) {
    return {
      solverUrl,
      kind: 'http',
      latencyMs,
      message: error.message,
    };
  }
  if (error instanceof SolverNetworkError) {
    return {
      solverUrl,
      kind: 'network',
      latencyMs,
      message: error.message,
    };
  }
  return {
    solverUrl,
    kind: 'network',
    latencyMs,
    message: error instanceof Error ? error.message : 'Unknown solver error',
  };
}

export async function bestQuote(
  solvers: readonly string[],
  request: QuoteRequest,
  options: BestQuoteOptions,
): Promise<BestQuoteResult> {
  const parsedRequest = QuoteRequestSchema.parse(request);
  const nowMs = options.nowMs ?? Date.now;

  const settled = await Promise.all(
    solvers.map(
      async (
        solverUrl,
      ): Promise<
        | { ok: true; entry: VerifiedSolverQuote }
        | { ok: false; failure: SolverQuoteFailure }
      > => {
        const startedAt = nowMs();
        try {
          const client = new SolverClient({
            baseUrl: solverUrl,
            ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
            ...(options.timeoutMs !== undefined
              ? { timeoutMs: options.timeoutMs }
              : {}),
          });
          const rawQuote = await client.quote(parsedRequest);
          const verified = await verifyQuote(rawQuote, parsedRequest, options);
          const latencyMs = Math.max(0, nowMs() - startedAt);
          return {
            ok: true,
            entry: { solverUrl: client.baseUrl, latencyMs, quote: verified },
          };
        } catch (error) {
          const latencyMs = Math.max(0, nowMs() - startedAt);
          return {
            ok: false,
            failure: classifyFailure(solverUrl, latencyMs, error),
          };
        }
      },
    ),
  );

  const quotes: VerifiedSolverQuote[] = [];
  const failures: SolverQuoteFailure[] = [];

  for (const item of settled) {
    if (item.ok) {
      quotes.push(item.entry);
    } else {
      failures.push(item.failure);
    }
  }

  quotes.sort((left, right) => {
    if (left.quote.receiveAmount !== right.quote.receiveAmount) {
      return left.quote.receiveAmount > right.quote.receiveAmount ? -1 : 1;
    }
    return left.latencyMs - right.latencyMs;
  });

  return {
    best: quotes[0] ?? null,
    quotes,
    failures,
  };
}
