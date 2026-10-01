import { trpc } from "@/providers/trpc";

/** Сколько ждут ответа: обращения с непрочитанным и новые заявки — для значков меню. */
export function useConsoleBadges(): { support: number; leads: number } {
  const { data: threads } = trpc.support.inbox.useQuery(undefined, { refetchInterval: 60_000, staleTime: 20_000 });
  const { data: leads } = trpc.lead.list.useQuery({ onlyNew: true }, { refetchInterval: 120_000, staleTime: 30_000 });
  return {
    support: (threads ?? []).filter(t => t.unread > 0).length,
    leads: (leads ?? []).length,
  };
}
