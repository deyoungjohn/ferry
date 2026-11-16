import {
  formatQuoteRefusalMessage,
  type ApiErrorCode,
  type ApiErrorResponse,
  type QuoteRefusal,
} from '@ferry/core/api';
import type { z } from 'zod';

export class SolverNetworkError extends Error {
  readonly url: string;

  constructor(url: string, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SolverNetworkError';
    this.url = url;
  }
}

export class SolverTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Solver request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'SolverTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class SolverRefusalError extends Error {
  readonly url: string;
  readonly status: number;
  readonly refusal: QuoteRefusal;

  constructor(url: string, status: number, refusal: QuoteRefusal) {
    super(formatQuoteRefusalMessage(refusal));
    this.name = 'SolverRefusalError';
    this.url = url;
    this.status = status;
    this.refusal = refusal;
  }
}

export class SolverHttpError extends Error {
  readonly url: string;
  readonly status: number;
  readonly code: ApiErrorCode | undefined;
  readonly apiError: ApiErrorResponse | undefined;
  readonly bodyText: string | undefined;

  constructor(params: {
    url: string;
    status: number;
    message: string;
    apiError?: ApiErrorResponse;
    bodyText?: string;
  }) {
    super(params.message);
    this.name = 'SolverHttpError';
    this.url = params.url;
    this.status = params.status;
    this.apiError = params.apiError;
    this.code = params.apiError?.error.code;
    this.bodyText = params.bodyText;
  }
}

export class SolverSchemaError extends Error {
  readonly url: string;
  readonly route: string;
  readonly issues: readonly z.ZodIssue[] | undefined;

  constructor(params: {
    url: string;
    route: string;
    message: string;
    issues?: readonly z.ZodIssue[];
  }) {
    super(params.message);
    this.name = 'SolverSchemaError';
    this.url = params.url;
    this.route = params.route;
    this.issues = params.issues;
  }
}

export class QuoteVerificationError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Quote verification failed for ${field}: ${reason}`);
    this.name = 'QuoteVerificationError';
    this.field = field;
    this.reason = reason;
  }
}
