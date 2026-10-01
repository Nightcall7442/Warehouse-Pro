import { LeadInbox } from "@/components/superadmin/LeadInbox";
import { PageHead } from "@/components/superadmin/console/ui";

/** «Заявки» — с формы на сайте: оставили телефон и ждут звонка (/super-admin/leads). */
export default function Leads() {
  return (
    <div>
      <PageHead title="Заявки" subtitle="С формы на сайте: оставили телефон и ждут звонка." />
      <LeadInbox />
    </div>
  );
}
