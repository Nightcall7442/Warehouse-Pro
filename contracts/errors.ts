type AppError = { tag: "app_error"; status: number; message: string };

function appError(status: number, message: string): AppError {
  return { tag: "app_error", status, message };
}

export const Errors = {
  badRequest: (msg: string) => appError(400, msg),
  unauthorized: (msg: string) => appError(401, msg),
  forbidden: (msg: string) => appError(403, msg),
  notFound: (msg: string) => appError(404, msg),
  internal: (msg: string) => appError(500, msg),
} as const;

/**
 * Это отказ, который мы решили выдать сами, а не поломка по дороге.
 *
 * Разница важна там, где ошибку перехватывают: «токен не годится» и «не
 * удалось проверить токен» выглядят одинаково — исключение из
 * authenticateRequest, — но означают противоположное. Первое значит «войдите
 * заново», второе — «попробуйте ещё раз».
 */
export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && (e as AppError).tag === "app_error";
}

export type { AppError };
