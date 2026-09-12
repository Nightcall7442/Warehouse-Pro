import { useState } from "react";
import { useCan } from "@/hooks/useCan";
import { Plus, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CounterpartyStats } from "./CounterpartyStats";
import { ReceivablesPanel } from "./ReceivablesPanel";
import { CounterpartyList } from "./CounterpartyList";
import { CounterpartyForm } from "./CounterpartyForm";
import { CounterpartyDetail } from "./CounterpartyDetail";
import { PaymentForm } from "./PaymentForm";
import { SupplierReturnForm } from "./SupplierReturnForm";
import type { CounterpartyRow } from "./CounterpartyList";
import type { PayableSupply } from "./PaymentForm";
import { COLORS } from "./constants";

/**
 * Раздел «Контрагенты и долги» — вкладка страницы «Приходы».
 *
 * Не отдельная страница намеренно: долг перед заводом рождается в момент
 * прихода товара и гасится оттуда же. Разносить их по разным разделам меню
 * значило бы разорвать одно действие на два места, между которыми оператору
 * пришлось бы ходить.
 *
 * Свои запросы компонент делает сам, а не получает готовые данные сверху:
 * пока открыта вкладка приходов, ни один из них не должен уходить на сервер.
 * Страница монтирует этот раздел только когда его выбрали.
 */
export function CounterpartiesSection() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [filter, setFilter] = useState<"all" | "debtors" | "overdue">("all");
  const [sortBy, setSortBy] = useState<"name" | "debtDesc">("name");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CounterpartyRow | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [paying, setPaying] = useState<PayableSupply | null>(null);
  const [returning, setReturning] = useState<PayableSupply | null>(null);
  /*
    Заведение поставщика и оплата ему — деньги, уходящие из организации.
    Арендатор может закрыть это оператору (Настройки → Права оператора).
  */
  const can = useCan();
  const canManageSuppliers = can("suppliers.manage");

  const statsQuery = trpc.supplier.stats.useQuery();
  const listQuery = trpc.supplier.list.useQuery({
    search: debouncedSearch || undefined,
    onlyDebtors: filter === "debtors" || undefined,
    onlyOverdue: filter === "overdue" || undefined,
    sortBy,
  });

  /** После любой денежной правки сводка и списки устаревают разом. */
  const refreshAll = () => {
    utils.supplier.stats.invalidate();
    utils.supplier.list.invalidate();
    utils.supplier.supplies.invalidate();
    utils.supplier.payments.invalidate();
    utils.supplier.reconciliation.invalidate();
    utils.supplier.getSupplyByArrival.invalidate();
    // Список приходов показывает те же деньги колонками — он тоже устарел.
    utils.arrival.list.invalidate();
  };

  const createMutation = trpc.supplier.create.useMutation({
    onSuccess: () => {
      refreshAll();
      setFormOpen(false);
      notify.success(t("Контрагент добавлен", "Kontragent qo'shildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const updateMutation = trpc.supplier.update.useMutation({
    onSuccess: () => {
      refreshAll();
      setFormOpen(false);
      setEditing(null);
      notify.success(t("Сохранено", "Saqlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const returnMutation = trpc.supplier.returnGoods.useMutation({
    onSuccess: (res) => {
      refreshAll();
      setReturning(null);
      notify.success(res.duplicate
        ? t("Этот возврат уже был записан", "Bu qaytarish allaqachon yozilgan")
        : t(`Возврат записан: долг уменьшен на ${res.credited}`, `Qaytarish yozildi: qarz ${res.credited} ga kamaydi`));
    },
    onError: (e) => notify.error(e.message),
  });

  const payMutation = trpc.supplier.pay.useMutation({
    onSuccess: (res) => {
      refreshAll();
      setPaying(null);
      notify.success(res.duplicate
        ? t("Этот платёж уже был записан", "Bu to'lov allaqachon yozilgan")
        : t("Платёж записан", "To'lov yozildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  if (listQuery.isError) return <QueryErrorFallback onRetry={listQuery.refetch} />;

  const rows = (listQuery.data ?? []) as CounterpartyRow[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {statsQuery.data && <CounterpartyStats stats={statsQuery.data} lang={lang} />}

      {/*
        Вторая сторона расчётов.

        Раздел называется «Контрагенты и долги», а показывал одну сторону —
        наш долг перед заводом. Сколько должны НАМ, лежало в другом разделе
        одним числом без возраста, и свести обе стороны человек мог только в
        уме. Между тем это один вопрос: сколько денег зависло и с какой
        стороны.
      */}
      <ReceivablesPanel />

      {/* Фильтры и добавление */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary }} />
          <input
            data-testid="counterparty-search"
            style={{
              padding: "10px 14px 10px 36px", borderRadius: "12px", fontSize: "13px",
              background: COLORS.surfaceLight, border: "none", color: COLORS.textPrimary,
              outline: "none", width: "100%",
            }}
            placeholder={t("Поиск контрагента…", "Kontragent qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <PremiumSelect
          value={filter}
          onChange={v => setFilter(v as "all" | "debtors" | "overdue")}
          options={[
            { value: "all",      label: t("Все", "Barchasi") },
            { value: "debtors",  label: t("С долгом", "Qarzdor") },
            { value: "overdue",  label: t("Просроченные", "Muddati o'tgan") },
          ]}
          width="170px"
        />
        <PremiumSelect
          value={sortBy}
          onChange={v => setSortBy(v as "name" | "debtDesc")}
          options={[
            { value: "name",     label: t("По названию", "Nomi bo'yicha") },
            { value: "debtDesc", label: t("Сначала долг", "Avval qarz") },
          ]}
          width="170px"
        />
        {canManageSuppliers && <button
          data-testid="counterparty-new"
          onClick={() => { setEditing(null); setFormOpen(true); }}
          className="neo-btn-primary"
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px" }}
        >
          <Plus size={15} /> {t("Контрагент", "Kontragent")}
        </button>}
      </div>

      <CounterpartyList rows={rows} lang={lang} onOpen={setDetailId} />

      {/* Заведение и правка — одно окно. key сбрасывает его состояние при
          переходе с «нового» на правку и обратно: без него в форме остались
          бы поля от прошлого открытия. */}
      {formOpen && (
        <CounterpartyForm
          key={editing?.id ?? "new"}
          open={formOpen}
          initial={editing}
          isPending={createMutation.isPending || updateMutation.isPending}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSave={(values) => {
            const payload = {
              name:        values.name.trim(),
              contactName: values.contactName.trim() || undefined,
              phone:       values.phone.trim() || undefined,
              inn:         values.inn.trim() || undefined,
              address:     values.address.trim() || undefined,
              notes:       values.notes.trim() || undefined,
            };
            if (editing) updateMutation.mutate({ id: editing.id, ...payload });
            else createMutation.mutate(payload);
          }}
        />
      )}

      {detailId !== null && (
        <CounterpartyDetail
          supplierId={detailId}
          lang={lang}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            const row = rows.find(r => r.id === detailId) ?? null;
            setEditing(row);
            setFormOpen(true);
          }}
          onPay={canManageSuppliers ? setPaying : undefined}
          onReturn={canManageSuppliers ? setReturning : undefined}
        />
      )}

      {returning && (
        <SupplierReturnForm
          key={`r-${returning.id}`}
          open
          supply={returning}
          lang={lang}
          isPending={returnMutation.isPending}
          onClose={() => setReturning(null)}
          onSubmit={(values) => returnMutation.mutate(values)}
        />
      )}

      {paying && (
        <PaymentForm
          key={paying.id}
          open
          supply={paying}
          lang={lang}
          isPending={payMutation.isPending}
          onClose={() => setPaying(null)}
          onPay={(values) => payMutation.mutate(values)}
        />
      )}
    </div>
  );
}
