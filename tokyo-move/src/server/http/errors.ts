/**
 * HTTP error type used by every route and service. The error handler in app.ts turns these into the
 * `ApiError` envelope from src/shared/types.ts. Messages must never contain record bodies or secrets.
 */
import type { ApiError } from '../../shared/types';

export type ApiErrorCode = ApiError['error'];

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const notFound = (what = 'Record'): HttpError => new HttpError(404, 'not_found', `${what} not found`);
export const unauthenticated = (message = 'Sign in required'): HttpError => new HttpError(401, 'unauthenticated', message);
export const forbidden = (message: string): HttpError => new HttpError(403, 'forbidden', message);
export const notAuthorizedInMode = (message: string): HttpError =>
  new HttpError(403, 'not_authorized_in_mode', message);
export const validationError = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'validation', message, details);
export const conflictError = (message: string, details?: unknown): HttpError =>
  new HttpError(409, 'conflict', message, details);
