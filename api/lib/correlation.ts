/**
 * Correlation ID utilities for request tracing.
 * Generates a unique ID per request for distributed tracing and debugging.
 */
import { nanoid } from "nanoid";

const CORRELATION_HEADER = "x-correlation-id";
const DEFAULT_ID_LENGTH = 12;

export function generateCorrelationId(): string {
  return nanoid(DEFAULT_ID_LENGTH);
}

export { CORRELATION_HEADER };
