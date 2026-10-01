import { useSearchParams } from "react-router";
import { SupportInbox } from "@/components/superadmin/SupportInbox";
import { PageHead } from "@/components/superadmin/console/ui";

/**
 * «Обращения» — чат поддержки со стороны платформы (/super-admin/support).
 * Открытый разговор — в адресе (?thread=…): на телефоне это второй экран.
 */
export default function Support() {
  const [params] = useSearchParams();
  const open = params.has("thread");
  return (
    <div>
      <div className={open ? "hidden md:block" : undefined}>
        <PageHead title="Обращения" subtitle="Сначала те, где ждут ответа. Чат доступен организациям на тарифе Эксклюзив." />
      </div>
      <SupportInbox />
    </div>
  );
}
