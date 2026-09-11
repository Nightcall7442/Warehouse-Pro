import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "date-fns";
import {
  RotateCcw, Check, X, PackageCheck, FileSpreadsheet, ChevronDown, ChevronRight,
} from "lucide-react";

/**
 * Возвраты: приём, рассмотрение, проведение.
 *
 * ── Зачем эта страница появилась ────────────────────────────────────────────
 *
 * Её не было вовсе, и это оказалось дырой в самом центре денег.
 *
 * Возврат заводит агент из мобильного приложения — он приходит в состоянии
 * «на рассмотрении». Дальше его должен посмотреть человек в офисе: одобрить
 * или отказать, а одобренный — провести, вернув товар на склад и уменьшив долг
 * магазина.
 *
 * Ручка, которая это делает (returns.updateStatus), была написана и НЕ
 * ВЫЗЫВАЛАСЬ НИОТКУДА: ни отсюда — страницы не существовало, — ни из мобилки.
 * То есть состояние «проведён» было недостижимо через продукт, а на него
 * опираются долг магазина, прибыль, комиссия агента, доля возвратов в KPI и
 * рейтинг магазина. Все эти расчёты считали правильно то, чего не бывает.
 *
 * ── Почему список, а не карточки ────────────────────────────────────────────
 *
 * Здесь работают, а не любуются: возвраты разбирают пачкой, по одному
 * состоянию за раз. Поэтому таблица, фильтр по состоянию, разворачиваемые
 * строки с составом и выгрузка — по возвратам спорят с магазинами, и спор
 * идёт по бумаге.
 */

type Status = "pending" | "approved" | "rejected" | "completed";
type Disposition = "restock" | "write_off";
/** Та же логика, что defaultDisposition на сервере: брак, просрочка, порча — списать. */
const defaultDisposition = (reason: string | null | undefined): Disposition =>
  reason === "defect" || reason === "expired" || reason === "damaged" ? "write_off" : "restock";

const STATUS_CHIP: Record<Status, string> = {
  pending:   "bg-warning/15 text-warning border-warning/30",
  approved:  "bg-info/15 text-info border-info/30",
  rejected:  "bg-danger/15 text-danger border-danger/30",
  completed: "bg-success/15 text-success border-success/30",
};

/**
 * Что можно сделать с возвратом в этом состоянии.
 *
 * Повторяет правило сервера (returns-router.ts): на рассмотрении — одобрить
 * или отказать, одобренный — провести, отказанный и проведённый терминальны.
 * Кнопка, которой сервер откажет, — это обещание, которого продукт не держит.
 */
const NEXT: Record<Status, Status[]> = {
  pending:   ["approved", "rejected"],
  approved:  ["completed"],
  rejected:  [],
  completed: [],
};

export default function Returns() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const [status, setStatus] = useState<Status | "all">("pending");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const STATUS_LABEL: Record<Status, string> = {
    pending:   t("на рассмотрении", "ko'rib chiqilmoqda"),
    approved:  t("одобрен", "tasdiqlangan"),
    rejected:  t("отклонён", "rad etilgan"),
    completed: t("проведён", "o'tkazilgan"),
  };

  const REASON_LABEL: Record<string, string> = {
    defect:     t("брак", "brak"),
    wrong_item: t("не тот товар", "noto'g'ri mahsulot"),
    expired:    t("истёк срок", "muddati o'tgan"),
    damaged:    t("повреждён", "shikastlangan"),
    other:      t("другое", "boshqa"),
  };

  const listQ = trpc.returns.list.useQuery({
    ...(status === "all" ? {} : { status }),
    page, pageSize: 25,
  });
  const summaryQ = trpc.returns.summary.useQuery();
  const detailQ = trpc.returns.getById.useQuery(
    { id: openId ?? 0 },
    { enabled: openId != null },
  );

  const move = trpc.returns.updateStatus.useMutation({
    onSuccess: (_res, vars) => {
      notify.success(
        vars.status === "completed" ? t("Возврат проведён", "Qaytarish o'tkazildi")
          : vars.status === "approved" ? t("Возврат одобрен", "Qaytarish tasdiqlandi")
          : t("Возврат отклонён", "Qaytarish rad etildi"),
      );
      utils.returns.list.invalidate();
      utils.returns.summary.invalidate();
      utils.returns.getById.invalidate();
    },
    onError: e => notify.error(e.message),
  });

  /*
    Проведение спрашивает подтверждение, одобрение — нет.

    «Одобрен» ещё ничего не двигает: это решение человека, и передумать можно.
    «Проведён» возвращает товар на склад и уменьшает долг магазина, и обратной
    дороги у него нет — состояние терминальное.
  */
  const act = async (id: number, to: Status, number: string, disposition?: Disposition) => {
    if (to === "completed") {
      const restock = disposition !== "write_off";
      const ok = await confirm({
        title: restock ? t("Провести возврат на склад?", "Omborga qaytarish o'tkazilsinmi?") : t("Провести возврат списанием?", "Hisobdan chiqarib o'tkazilsinmi?"),
        message: restock
          ? t(`${number}: товар вернётся на склад, долг магазина уменьшится. Отменить проведение нельзя.`,
              `${number}: mahsulot omborga qaytadi, do'kon qarzi kamayadi. Bekor qilib bo'lmaydi.`)
          : t(`${number}: товар списывается и на склад не попадёт, долг магазина уменьшится. Отменить проведение нельзя.`,
              `${number}: mahsulot hisobdan chiqariladi va omborga tushmaydi, do'kon qarzi kamayadi. Bekor qilib bo'lmaydi.`),
        confirmText: restock ? t("На склад", "Omborga") : t("Списать", "Hisobdan chiqarish"),
        danger: !restock,
      });
      if (!ok) return;
    }
    move.mutate({ id, status: to, disposition });
  };

  const rows = listQ.data?.data ?? [];
  const total = listQ.data?.total ?? 0;

  /* Выгрузка по-русски всегда: это бумага, а не экран. */
  const handleExport = async () => {
    if (rows.length === 0) {
      notify.info(t("Нечего выгружать", "Yuklab olish uchun hech narsa yo'q"));
      return;
    }
    const RU: Record<Status, string> = {
      pending: "На рассмотрении", approved: "Одобрен",
      rejected: "Отклонён", completed: "Проведён",
    };
    const REASON_RU: Record<string, string> = {
      defect: "Брак", wrong_item: "Не тот товар", expired: "Истёк срок",
      damaged: "Повреждён", other: "Другое",
    };
    await exportToExcel([{
      name: "Возвраты",
      data: rows.map(r => ({
        number: r.returnNumber,
        date: r.createdAt ? format(new Date(r.createdAt), "dd.MM.yyyy") : "",
        shop: r.shopName ?? "",
        order: r.orderId ?? "",
        reason: REASON_RU[r.reason ?? ""] ?? r.reason ?? "",
        amount: Number(r.totalAmount ?? 0),
        status: RU[r.status as Status],
        notes: r.notes ?? "",
      })),
      columns: [
        { key: "number", header: "Номер", width: 18 },
        { key: "date", header: "Дата", width: 12 },
        { key: "shop", header: "Магазин", width: 28 },
        { key: "order", header: "Заказ", width: 10 },
        { key: "reason", header: "Причина", width: 16 },
        { key: "amount", header: "Сумма", width: 14 },
        { key: "status", header: "Состояние", width: 18 },
        { key: "notes", header: "Примечание", width: 30 },
      ],
    }], "vozvraty");
  };

  if (listQ.isLoadingError) return <QueryErrorFallback onRetry={() => listQ.refetch()} />;

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
            {t("Возвраты", "Qaytarishlar")}
          </h1>
          <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>
            {t("Агент заводит — офис проводит", "Agent yaratadi — ofis o'tkazadi")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumSelect
            value={status}
            onChange={v => { setStatus(v as Status | "all"); setPage(1); }}
            options={[
              { value: "pending", label: STATUS_LABEL.pending },
              { value: "approved", label: STATUS_LABEL.approved },
              { value: "completed", label: STATUS_LABEL.completed },
              { value: "rejected", label: STATUS_LABEL.rejected },
              { value: "all", label: t("все", "hammasi") },
            ]}
          />
          <button className="neo-btn" onClick={handleExport} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <FileSpreadsheet size={15} />
            <span className="hidden sm:inline">Excel</span>
          </button>
        </div>
      </div>

      {/*
        Свод — по причинам, а не по состояниям: состояние видно в фильтре, а
        вопрос, на который отвечает офис, другой — ПОЧЕМУ возвращают. Сумма
        считается только по проведённым: отклонённый возврат денег не двигал.
      */}
      {(summaryQ.data?.length ?? 0) > 0 && (
        <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
          <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, marginBottom: "12px" }}>
            {t("Проведено за месяц — по причинам", "Oy davomida — sabablar bo'yicha")}
          </div>
          <div className="flex flex-wrap gap-4">
            {summaryQ.data!.map(s => (
              <div key={s.reason ?? "none"}>
                <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1 }}>
                  {fmt(Number(s.totalAmount ?? 0))}
                </div>
                <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px" }}>
                  {REASON_LABEL[s.reason ?? ""] ?? s.reason ?? t("без причины", "sababsiz")} · {Number(s.count ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
        {listQ.isLoading ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-surface-light animate-pulse rounded-xl" />)}
          </div>
        ) : rows.length === 0 ? (
          <SectionNotice
            kind="empty"
            message={status === "pending"
              ? t("Нерассмотренных возвратов нет", "Ko'rib chiqilmagan qaytarishlar yo'q")
              : t("Возвратов в этом состоянии нет", "Bu holatda qaytarishlar yo'q")}
          />
        ) : (
          <>
            {/* Широкий экран — таблица: возвраты разбирают пачкой. */}
            <div className="hidden lg:block overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: "36px" }} />
                    <th style={thStyle}>{t("Номер", "Raqam")}</th>
                    <th style={thStyle}>{t("Магазин", "Do'kon")}</th>
                    <th style={thStyle}>{t("Причина", "Sabab")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th>
                    <th style={thStyle}>{t("Состояние", "Holat")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("Действие", "Amal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const st = r.status as Status;
                    const open = openId === r.id;
                    return (
                      <>
                        <tr key={r.id}>
                          <td style={{ ...tdStyle, paddingRight: 0 }}>
                            <button
                              onClick={() => setOpenId(open ? null : r.id)}
                              aria-label={t("Состав возврата", "Qaytarish tarkibi")}
                              className="text-secondary"
                            >
                              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{r.returnNumber}</div>
                            <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                              {r.createdAt ? format(new Date(r.createdAt), "dd.MM.yyyy") : ""}
                              {r.orderId ? ` · ${t("заказ", "buyurtma")} №${r.orderId}` : ""}
                            </div>
                          </td>
                          <td style={tdStyle}>{r.shopName ?? "—"}</td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                            {REASON_LABEL[r.reason ?? ""] ?? r.reason ?? "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {fmt(Number(r.totalAmount ?? 0))}
                          </td>
                          <td style={tdStyle}>
                            <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${STATUS_CHIP[st]}`}>
                              {STATUS_LABEL[st]}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <Actions
                              status={st} pending={move.isPending}
                              onAct={(to, d) => act(r.id, to, r.returnNumber, d)} reason={r.reason}
                              t={t}
                            />
                          </td>
                        </tr>
                        {open && (
                          <tr key={`${r.id}-items`}>
                            <td colSpan={7} style={{ ...tdStyle, background: COLORS.surfaceLight }}>
                              <ReturnItems
                                items={detailQ.data?.items ?? []}
                                notes={detailQ.data?.notes ?? null}
                                loading={detailQ.isLoading}
                                failed={detailQ.isLoadingError}
                                onRetry={() => detailQ.refetch()}
                                t={t} fmt={fmt}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Телефон — те же данные карточками. */}
            <div className="lg:hidden space-y-2 p-1">
              {rows.map(r => {
                const st = r.status as Status;
                return (
                  <div key={r.id} className="neo-card-sm" style={{ borderRadius: "16px", padding: "14px" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>
                          {r.returnNumber}
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                          {r.shopName ?? "—"} · {REASON_LABEL[r.reason ?? ""] ?? r.reason ?? "—"}
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${STATUS_CHIP[st]}`}>
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: COLORS.textPrimary }}>
                        {fmt(Number(r.totalAmount ?? 0))}
                      </span>
                      <Actions
                        status={st} pending={move.isPending}
                        onAct={(to, d) => act(r.id, to, r.returnNumber, d)} reason={r.reason}
                        t={t}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {total > 25 && (
        <div className="flex items-center justify-between">
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>
            {t("Всего", "Jami")}: {total}
          </span>
          <div className="flex gap-2">
            <button className="neo-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              {t("Назад", "Orqaga")}
            </button>
            <button className="neo-btn" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>
              {t("Вперёд", "Oldinga")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Кнопки перехода — ровно те, что примет сервер. */
function Actions({ status, pending, onAct, reason, t }: {
  status: Status; pending: boolean;
  onAct: (to: Status, disposition?: Disposition) => void;
  reason?: string | null;
  t: (ru: string, uz: string) => string;
}) {
  const next = NEXT[status];
  if (next.length === 0) {
    return <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>—</span>;
  }
  return (
    <div className="flex items-center justify-end gap-2">
      {next.includes("approved") && (
        <button className="neo-btn" disabled={pending} onClick={() => onAct("approved")}
          style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
          <Check size={14} />{t("Одобрить", "Tasdiqlash")}
        </button>
      )}
      {next.includes("rejected") && (
        <button className="neo-btn text-danger" disabled={pending} onClick={() => onAct("rejected")}
          style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
          <X size={14} />{t("Отклонить", "Rad etish")}
        </button>
      )}
      {/* Две кнопки вместо одной: куда девать товар — решение оператора.
          Главная — та, что подсказана причиной возврата. */}
      {next.includes("completed") && (() => {
        const suggested = defaultDisposition(reason);
        const btn = (d: Disposition, label: string, testId: string) => (
          <button key={d} className={suggested === d ? "neo-btn-primary" : "neo-btn"} disabled={pending}
            onClick={() => onAct("completed", d)} data-testid={testId}
            style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
            <PackageCheck size={14} />{label}
          </button>
        );
        return (
          <>
            {btn("restock", t("На склад", "Omborga"), "return-restock")}
            {btn("write_off", t("Списать", "Hisobdan chiqarish"), "return-write-off")}
          </>
        );
      })()}
    </div>
  );
}

/** Одна строка возврата — как её отдаёт returns.getById. */
interface ReturnLine {
  id: number;
  productName: string | null;
  productCode: string | null;
  quantity: string;
  unitPrice: string;
  subtotal: string;
}

/**
 * Состав возврата — что именно вернулось.
 *
 * Строки и примечание приходят готовыми, а не через объект запроса: getById
 * отвечает `null`, когда возврата нет, и тип ответа становится объединением —
 * читать `.items` у него нельзя, не разобрав объединение прямо здесь. Разбор
 * делает вызывающий, у которого для этого есть всё.
 */
function ReturnItems({ items, notes, loading, failed, onRetry, t, fmt }: {
  items: ReturnLine[];
  notes: string | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  t: (ru: string, uz: string) => string;
  fmt: (v: number) => string;
}) {
  if (failed) {
    return <SectionNotice kind="error" message={t("Не удалось загрузить состав", "Tarkibni yuklab bo'lmadi")} onRetry={onRetry} />;
  }
  if (loading) return <div className="h-8 bg-surface animate-pulse rounded" />;

  if (items.length === 0) {
    /*
      Возврат без позиций — не редкость и не поломка: курьер отмечает «магазин
      вернул всё» одним движением, без разбора по товарам. Сказать об этом
      прямо лучше, чем показать пустоту.
    */
    return (
      <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>
        {t("Без разбивки по товарам", "Mahsulotlar bo'yicha taqsimlanmagan")}
        {notes ? ` · ${notes}` : ""}
      </span>
    );
  }
  return (
    <div className="space-y-1">
      {items.map(i => (
        <div key={i.id} className="flex items-center justify-between" style={{ fontSize: "13px" }}>
          <span style={{ color: COLORS.textSecondary }}>
            {i.productName ?? "—"}
            {i.productCode ? <span style={{ color: COLORS.textTertiary }}> · {i.productCode}</span> : null}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {Number(i.quantity)} × {fmt(Number(i.unitPrice ?? 0))} = <b style={{ color: COLORS.textPrimary }}>{fmt(Number(i.subtotal ?? 0))}</b>
          </span>
        </div>
      ))}
    </div>
  );
}

/* Значок раздела — чтобы меню не искало его в другом файле. */
export const ReturnsIcon = RotateCcw;
