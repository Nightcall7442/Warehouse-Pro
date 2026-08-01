/**
 * FIX: production monitoring — an order that was already deleted showed up as
 * `500 INTERNAL_SERVER_ERROR — "Заказ не найден или уже удалён"`, with a stack
 * trace and a Sentry event. It is a user hitting delete twice, not a server fault.
 *
 * Services throw plain `Error`, and tRPC has no way to tell "the row is gone" from
 * "the database fell over", so everything became a 500. A `DomainError` carries the
 * category with the message; `withDomainErrors` in api/middleware.ts turns it into
 * the matching tRPC code, and services stay free of tRPC imports (they are also
 * called from webhooks, cron and the public API).
 */

export type DomainErrorCode =
  /** The thing being acted on does not exist, or is not visible to this tenant. */
  | "NOT_FOUND"
  /** The request is understood but the current state does not allow it. */
  | "CONFLICT"
  /** The caller may not do this to this object. */
  | "FORBIDDEN"
  /** The input itself is wrong. */
  | "BAD_REQUEST";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(message: string, code: DomainErrorCode = "BAD_REQUEST") {
    super(message);
    this.name = "DomainError";
    this.code = code;
    // Keeps `instanceof` working when the class is extended or the output is
    // down-levelled by a bundler.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static notFound(message: string): DomainError {
    return new DomainError(message, "NOT_FOUND");
  }

  /** State does not permit this: wrong status, already deleted, not enough stock. */
  static conflict(message: string): DomainError {
    return new DomainError(message, "CONFLICT");
  }

  static forbidden(message: string): DomainError {
    return new DomainError(message, "FORBIDDEN");
  }

  static badRequest(message: string): DomainError {
    return new DomainError(message, "BAD_REQUEST");
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
