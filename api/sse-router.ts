import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { sseBus } from "./lib/sse";

export const sseRouter = createRouter({
  /** Get SSE connection stats (admin only) */
  stats: authedQuery.query(() => {
    return sseBus.getStats();
  }),

  /** Get recent events for catch-up after reconnection */
  recentEvents: authedQuery
    .input(z.object({ since: z.number().optional() }).optional())
    .query(({ input, ctx }) => {
      return sseBus.getRecentEvents(ctx.tenant.id, input?.since);
    }),
});

/**
 * Create an SSE response for a tenant's event stream.
 * Used as a raw HTTP endpoint, not tRPC.
 *
 * @param tenantId - The tenant to subscribe to events for
 * @param userId - The user ID to filter events for
 * @param lastEventId - Optional Last-Event-ID for reconnection catch-up
 * @returns Response with SSE stream
 */
export function createSSEResponse(
  tenantId: number,
  userId: number,
  lastEventId?: string,
): Response {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      const connected = `data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(connected));

      // Subscribe to events
      unsubscribe = sseBus.subscribe(tenantId, userId, controller);

      // Send catch-up events if reconnecting
      if (lastEventId) {
        const since = parseInt(lastEventId, 10);
        if (!isNaN(since)) {
          const missed = sseBus.getRecentEvents(tenantId, since);
          for (const event of missed) {
            const payload = `id: ${event.timestamp}\ndata: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          }
        }
      }

      // Heartbeat every 30 seconds to keep connection alive
      heartbeat = setInterval(() => {
        try {
          const ping = `:heartbeat ${Date.now()}\n\n`;
          controller.enqueue(encoder.encode(ping));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
          if (unsubscribe) unsubscribe();
        }
      }, 30_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
