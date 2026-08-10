import { trpc } from "@/providers/trpc";

/**
 * Hook for notification state.
 *
 * SSE connection lives in TRPCProvider's SSEListener (single connection for the
 * whole app). This hook just reads the unread count from tRPC query — the query
 * is auto-invalidated by SSEListener when notification events arrive.
 */
export function useNotifications() {
  const { data } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000, // Poll every 30s as fallback if SSE drops
  });

  return { unreadCount: data?.count ?? 0 };
}
