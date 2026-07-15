import { TRPCError } from "@trpc/server";

type ErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR";

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST:         400,
  UNAUTHORIZED:        401,
  FORBIDDEN:           403,
  NOT_FOUND:           404,
  CONFLICT:            409,
  TOO_MANY_REQUESTS:   429,
  INTERNAL_SERVER_ERROR: 500,
};

export function asHttpStatus(code: ErrorCode): number {
  return CODE_TO_STATUS[code] ?? 500;
}

export function createError(code: ErrorCode, message: string) {
  return new TRPCError({ code, message });
}

export const AppErrors = {
  badRequest:      (msg: string) => createError("BAD_REQUEST", msg),
  unauthorized:    (msg: string) => createError("UNAUTHORIZED", msg),
  forbidden:       (msg: string) => createError("FORBIDDEN", msg),
  notFound:        (msg: string) => createError("NOT_FOUND", msg),
  conflict:        (msg: string) => createError("CONFLICT", msg),
  tooManyRequests: (msg: string) => createError("TOO_MANY_REQUESTS", msg),
  internal:        (msg: string) => createError("INTERNAL_SERVER_ERROR", msg),
} as const;
