import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { F, COLORS } from "@/components/users/types";
import { FieldGroup, FieldRow } from "@/components/settings/ui";
import { Plus, Trash2 } from "lucide-react";

/**
 * Прайс-листы: свои цены для магазина, категории или объёма.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Мобильное приложение прайс-листы ЧИТАЕТ — агент видит в заказе цену,
 * назначенную его магазину. А завести их было нечем: семь ручек управления
 * (создать, переименовать, удалить, положить товар, убрать товар, привязать
 * магазин, отвязать) написаны и не вызывались ниоткуда.
 *
 * То есть возможность продавать разным магазинам по разной цене существовала
 * ровно до первого вопроса «а где их создать».
 *
 * ── Почему приоритет виден человеку ─────────────────────────────────────────
 *
 * Магазину может подойти несколько списков сразу, и цену даёт тот, у кого
 * приоритет ВЫШЕ. Прятать это число — значит оставить человека гадать, почему
 * в заказе не та цена, которую он только что вписал.
 */

const TYPE_KEYS = ["shop", "tier", "volume"] as const;
type ListType = (typeof TYPE_KEYS)[number];

export function PriceListSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; type: ListType; priority: string; description: string; markupPct: string }>(
    { name: "", type: "shop", priority: "0", description: "", markupPct: "" },
  );

  const TYPE_LABEL: Record<ListType, string> = {
    shop:   t("для магазина", "do'kon uchun"),
    tier:   t("по категории", "toifa bo'yicha"),
    volume: t("за объём", "hajm uchun"),
  };

  const listQ = trpc.priceList.list.useQuery();

  const create = trpc.priceList.create.useMutation({
    // Созданный список — сразу в его страницу: следующий шаг всегда «цены и магазины».
    onSuccess: (r) => {
      notify.success(t("Прайс-лист создан", "Narx ro'yxati yaratildi"));
      utils.priceList.list.invalidate();
      setCreating(false);
      setForm({ name: "", type: "shop", priority: "0", description: "", markupPct: "" });
      navigate(`/price-lists/${r.id}`);
    },
    onError: e => notify.error(e.message),
  });

  const update = trpc.priceList.update.useMutation({
    onSuccess: () => { utils.priceList.list.invalidate(); },
    onError: e => notify.error(e.message),
  });

  const remove = trpc.priceList.delete.useMutation({
    onSuccess: () => {
      notify.success(t("Прайс-лист удалён", "Narx ro'yxati o'chirildi"));
      utils.priceList.list.invalidate();
    },
    onError: e => notify.error(e.message),
  });

  const onDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t("Удалить прайс-лист?", "Narx ro'yxati o'chirilsinmi?"),
      message: t(
        `«${name}»: магазины, которым он назначен, вернутся к обычной цене товара.`,
        `«${name}»: unga bog'langan do'konlar oddiy narxga qaytadi.`,
      ),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) remove.mutate({ id });
  };

  const lists = listQ.data ?? [];

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex items-center justify-between gap-3">
        <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>
          {t(
            "Цену даёт список с бо́льшим приоритетом",
            "Narxni yuqori ustuvorlikdagi ro'yxat beradi",
          )}
        </p>
        <button className="neo-btn-primary" onClick={() => setCreating(c => !c)}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Plus size={15} />{t("Создать", "Yaratish")}
        </button>
      </div>

      {creating && (
        <FieldGroup title={t("Новый прайс-лист", "Yangi narx ro'yxati")}>
          <FieldRow>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Название", "Nomi")}</span>
              <input className="neo-input w-full" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Вид", "Turi")}</span>
              <PremiumSelect
                value={form.type}
                onChange={v => setForm(f => ({ ...f, type: v as ListType }))}
                options={TYPE_KEYS.map(k => ({ value: k, label: TYPE_LABEL[k] }))}
              />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                {t("Приоритет — чем больше, тем важнее", "Ustuvorlik — qancha katta, shuncha muhim")}
              </span>
              <DecimalInput className="neo-input w-full" value={form.priority}
                onValueChange={v => setForm(f => ({ ...f, priority: v }))} />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Описание", "Tavsif")}</span>
              <input className="neo-input w-full" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            {/* Правило «к карточке»: −7 — все товары на 7 % дешевле карточки; строки списка — исключения поверх. */}
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("К цене карточки, % (−7 — скидка, 5 — наценка; пусто — только строки)", "Karta narxiga, % (−7 — chegirma, 5 — ustama; bo'sh — faqat qatorlar)")}</span>
              <input className="neo-input w-full font-data" inputMode="decimal" value={form.markupPct} placeholder="−7" data-testid="price-list-markup"
                onChange={e => setForm(f => ({ ...f, markupPct: e.target.value.replace(/[^0-9.,-]/g, "").replace(",", ".") }))} />
            </label>
          </FieldRow>
          <div className="flex justify-end gap-2 mt-4">
            <button className="neo-btn" onClick={() => setCreating(false)}>{t("Отмена", "Bekor")}</button>
            <button className="neo-btn-primary" disabled={create.isPending}
              onClick={() => {
                if (!form.name.trim()) return notify.error(t("Укажите название", "Nomini kiriting"));
                create.mutate({
                  name: form.name.trim(),
                  type: form.type,
                  priority: Number(form.priority) || 0,
                  description: form.description || undefined,
                  markupPct: form.markupPct.trim() === "" || !Number.isFinite(Number(form.markupPct)) ? null : Number(form.markupPct),
                });
              }}>
              {t("Создать", "Yaratish")}
            </button>
          </div>
        </FieldGroup>
      )}

      {listQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить прайс-листы", "Narx ro'yxatlarini yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 bg-surface-light animate-pulse rounded-xl" />)}</div>
      ) : lists.length === 0 ? (
        <SectionNotice kind="empty" message={t(
          "Прайс-листов нет — все магазины покупают по обычной цене товара",
          "Narx ro'yxatlari yo'q — barcha do'konlar oddiy narxda oladi",
        )} />
      ) : (
        <div className="space-y-2">
          {lists.map(l => (
            <div key={l.id} className="rounded-2xl p-3.5" style={{ background: COLORS.surfaceLight }}>
              <div className="flex items-start justify-between gap-3">
                <button className="text-left" style={{ minWidth: 0 }} onClick={() => navigate(`/price-lists/${l.id}`)} data-testid={`price-list-open-${l.id}`}>
                  <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>
                    {l.name}
                    {!l.isActive && (
                      <span style={{ marginLeft: "8px", fontSize: "11px", color: COLORS.textTertiary }}>
                        · {t("выключен", "o'chirilgan")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {TYPE_LABEL[l.type as ListType] ?? l.type}
                    {l.markupPct != null && <>{" · "}<b>{Number(l.markupPct) > 0 ? "+" : ""}{Number(l.markupPct)}%</b> {t("к карточке", "kartaga")}</>}
                    {" · "}{t("приоритет", "ustuvorlik")} {l.priority}
                    {" · "}{Number(l.itemCount)} {t("товаров", "mahsulot")}
                    {" · "}{Number(l.shopCount)} {t("магазинов", "do'kon")}
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="neo-btn"
                    style={{ fontSize: "12px", padding: "6px 10px" }}
                    onClick={() => update.mutate({ id: l.id, isActive: !l.isActive })}
                  >
                    {l.isActive ? t("Выключить", "O'chirish") : t("Включить", "Yoqish")}
                  </button>
                  <button className="neo-btn text-danger" style={{ padding: "6px 8px" }}
                    aria-label={t("Удалить", "O'chirish")}
                    onClick={() => onDelete(l.id, l.name)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
