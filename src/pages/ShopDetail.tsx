import { useParams, useNavigate, useLocation } from "react-router";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { useCurrency } from "@/hooks/useCurrency";
import { useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n";
import { STATUS } from "@/components/orders/theme-tokens";
import { labelled, ORDER_STATUS_LABEL } from "@/lib/entity-labels";
import { format } from "date-fns";
import {
  ArrowLeft, Store, Phone, MapPin, Edit2, Plus,
  AlertCircle, Loader2, CheckCircle2, X, Trash2, ChevronRight, Camera, Archive, RotateCcw,
} from "lucide-react";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { ShopStatement } from "@/components/shops/ShopStatement";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useAuth } from "@/hooks/useAuth";
import { canOperate } from "@/lib/permissions";


// ── Форма платежа ─────────────────────────────────────────────────────────────
function PaymentModal({ shopId, onClose }: { shopId: number; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [type,   setType]   = useState<"payment" | "debt">("payment");
  const [notes,  setNotes]  = useState("");
  // Метка этой попытки оплаты: одна на открытую форму. Второй клик по кнопке
  // или повтор после сорванной связи уходят с той же меткой, и сервер не
  // списывает долг дважды. Новая оплата — новое открытие формы, новая метка.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const addPayment = trpc.shop.addPayment.useMutation({
    onSuccess: () => {
      utils.shop.getById.invalidate({ id: shopId });
      notify.success(t("Платёж записан", "To'lov kiritildi"));
      onClose();
    },
    onError: (e) => notify.error(e.message),
  });

  const options = [
    { val: "payment", labelRu: "💰 Оплата (уменьшает долг)",    labelUz: "💰 To'lov (qarzni kamaytiradi)"  },
    { val: "debt",    labelRu: "📋 Новый долг (увеличивает)",    labelUz: "📋 Yangi qarz (oshiradi)"        },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      {/* Фон панели — из темы, а не литералом.
          Здесь стоял bg-[#ffffff]. Весь текст внутри берёт цвет из токенов, и
          в тёмной теме это давало почти белый текст на белом: заголовок
          #ede9e3 на #ffffff — контраст 1.21 при норме 4.5, подпись поля —
          2.69. Форма читалась только на ощупь.
          Соседняя модалка (warehouse/AdjustModal) с самого начала красится
          через var(--color-surface) — здесь теперь так же. */}
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
        style={{ background: "var(--color-surface, #efedea)" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-primary">{t("Добавить платёж", "To'lov qo'shish")}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {options.map(o => (
            <button key={o.val} onClick={() => setType(o.val as "payment" | "debt")}
              className={`py-3 px-3 rounded-lg border text-xs font-medium text-left transition-all ${
                type === o.val
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-subtle text-secondary hover:border-border-strong"
              }`}>
              {lang === "uz" ? o.labelUz : o.labelRu}
            </button>
          ))}
        </div>

        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("СУММА", "SUMMA")}
          </label>
          <input data-testid="payment-amount" type="text" inputMode="decimal"
            className="neo-input w-full font-data text-lg"
            placeholder="0.00" value={amount}
            onChange={e => setAmount(normalizeDecimalInput(e.target.value))} autoFocus />
        </div>

        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ПРИМЕЧАНИЯ", "IZOHLAR")}
          </label>
          <input className="neo-input w-full" placeholder={t("Комментарий…", "Izoh…")}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button
            data-testid="payment-submit"
            onClick={() => amount && addPayment.mutate({ shopId, amount, type, notes: notes || undefined, idempotencyKey })}
            disabled={addPayment.isPending || !amount}
            className="neo-btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
            {addPayment.isPending && <Loader2 size={14} className="animate-spin" />}
            {t("Записать", "Kiritish")}
          </button>
          <button onClick={onClose} className="neo-btn px-5">{t("Отмена", "Bekor")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Главная страница магазина ─────────────────────────────────────────────────
export default function ShopDetail() {
  const { id }   = useParams<{ id: string }>();
  const { fmt }  = useCurrency();
  const { lang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * «Назад» — настоящий шаг назад по истории.
   *
   * Здесь собирался адрес списка руками: /shops?fromPage=…&search=…&city=…
   * &district=…. Четыре значения из девяти, которые список умеет
   * фильтровать, — и «только с долгом» в них не входило. Отсюда жалоба:
   * человек выбрал магазины с долгом, зашёл в магазин, нажал назад и попал в
   * общий список.
   *
   * Теперь состояние списка лежит в его собственном адресе (см.
   * hooks/useUrlState), поэтому переносить нечего: достаточно вернуться на
   * шаг назад, и список откроется ровно таким, каким был.
   *
   * Оговорка про прямой заход: если карточку открыли по ссылке из мессенджера
   * или обновили страницу, шага назад в нашем приложении нет — уводить
   * человека из приложения кнопкой «назад» нельзя. React Router помечает
   * такую первую запись ключом "default"; в этом случае идём в список.
   */
  const goBack = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/shops");
  }, [location.key, navigate]);
  const { confirm, dialog } = useConfirm();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const [editing, setEditing]       = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editData, setEditData]     = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: shop, isLoading, isLoadingError, refetch } = trpc.shop.getById.useQuery({ id: Number(id) }, { enabled: !!id });
  // Правка, платежи и фото — operatorQuery. Супервайзер карточку смотрит:
    // долг, историю платежей, заказы точки.
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);

  // Список агентов нужен только форме правки, и полный user.list открыт
  // одному руководителю — поэтому спрашиваем его лишь у тех, кто правит.
  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 }, { enabled: canEdit });
  const agents = useMemo(() => (usersData?.data ?? []).filter((u: { role: string }) => u.role === "agent"), [usersData?.data]);

  const uploadPhoto = trpc.shop.uploadPhoto.useMutation({
    onSuccess: () => { utils.shop.getById.invalidate({ id: Number(id) }); notify.success(t("Фото обновлено", "Rasm yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 10*1024*1024) { notify.error(t("Макс. 10 МБ", "Maks. 10 MB")); return; }
    try {
      const compressed = await compressImage(file);
      uploadPhoto.mutate({ shopId: Number(id), dataUrl: compressed });
    } catch { notify.error(t("Ошибка обработки изображения", "Rasmni qayta ishlashda xatolik")); }
    e.target.value = "";
  };

  const updateShop = trpc.shop.update.useMutation({
    onSuccess: () => { utils.shop.getById.invalidate({ id: Number(id) }); setEditing(false); notify.success(t("Магазин обновлён", "Do'kon yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  /*
    Что за точкой числится — спрашиваем до того, как предложить действие.

    Это и решает, показывать ли «удалить насовсем». Прежде такая кнопка стояла
    всегда и делала одно из двух наугад: у точки с заказами внешний ключ не
    давал стереть строку, и она молча становилась неактивной; у точки без
    заказов удалялось всё — адрес, координаты, фотография, история визитов.
    Обещало окно при этом в обоих случаях «безвозвратно».

    Теперь стереть можно ровно то, за чем ничего не числится: дубль, который
    завёлся от повторного тапа по «Создать». Всё остальное уходит в архив.
  */
  const { data: trace } = trpc.shop.trace.useQuery({ id: Number(id) }, { enabled: Number.isFinite(Number(id)) });
  const isArchived = shop?.status === "inactive";
  const canDeleteForever = !!trace && trace.total === 0;

  const archiveShop = trpc.shop.archive.useMutation({
    onSuccess: () => { goBack(); notify.success(t("Магазин убран в архив", "Do'kon arxivga olindi")); },
    onError:   (e: { message: string }) => notify.error(e.message),
  });
  const restoreShopMutation = trpc.shop.restore.useMutation({
    onSuccess: () => { utils.shop.getById.invalidate({ id: Number(id) }); notify.success(t("Магазин вернулся в работу", "Do'kon ishga qaytdi")); },
    onError:   (e: { message: string }) => notify.error(e.message),
  });
  const deleteForever = trpc.shop.deleteForever.useMutation({
    onSuccess: () => { goBack(); notify.success(t("Магазин удалён", "Do'kon o'chirildi")); },
    onError:   (e: { message: string }) => notify.error(e.message),
  });

  const handleArchive = async () => {
    const debt = Number(shop?.debt ?? 0);
    const ok = await confirm({
      title: t("Убрать магазин в архив?", "Do'kon arxivga olinsinmi?"),
      message: [
        t("Точка пропадёт из списков, планов визитов и карты. Заказы, оплаты и история остаются, вернуть можно в любой момент.",
          "Do'kon ro'yxatlardan, tashrif rejalaridan va xaritadan yo'qoladi. Buyurtmalar, to'lovlar va tarix saqlanadi, istalgan vaqtda qaytarish mumkin."),
        debt > 0
          ? t(`За точкой числится долг ${fmt(debt)} — он остаётся и из дебиторки не уходит.`,
              `Do'kon zimmasida ${fmt(debt)} qarz bor — u saqlanadi va qarzdorlardan chiqmaydi.`)
          : "",
      ].filter(Boolean).join(" "),
      confirmText: t("В архив", "Arxivga"),
    });
    if (ok) archiveShop.mutate({ ids: [Number(id)] });
  };

  const handleDeleteForever = async () => {
    const ok = await confirm({
      title: t("Удалить магазин насовсем?", "Do'kon butunlay o'chirilsinmi?"),
      message: t("За точкой ничего не числится — ни заказов, ни оплат, ни визитов. Строка будет стёрта, вернуть её нельзя.",
                 "Do'kon zimmasida hech narsa yo'q — na buyurtma, na to'lov, na tashrif. Yozuv o'chiriladi va qaytarilmaydi."),
      confirmText: t("Удалить насовсем", "Butunlay o'chirish"), danger: true,
    });
    if (ok) deleteForever.mutate({ id: Number(id) });
  };

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
      <div className="h-40 bg-surface-light animate-pulse rounded-xl" />
      <div className="h-64 bg-surface-light animate-pulse rounded-xl" />
    </div>
  );
  if (!shop) return <div className="text-center py-20 text-secondary">{t("Магазин не найден", "Do'kon topilmadi")}</div>;

  const hasDebt = Number(shop.debt ?? 0) > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      <div key="confirm-dialog">{dialog}</div>
      <div key="payment-modal">
        {showPayment && <PaymentModal shopId={shop.id} onClose={() => setShowPayment(false)} />}
      </div>

      {/* Навигация */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => goBack()} className="neo-btn flex items-center gap-2 py-1.5 px-3 text-sm">
          <ArrowLeft size={18} /><span className="text-sm">{t("Магазины", "Do'konlar")}</span>
        </button>
        {canEdit && (
        <div className="flex gap-2">
          <button onClick={() => setEditing(v => !v)} className="neo-btn flex items-center gap-1.5 text-sm py-2">
            <Edit2 size={13} />{t("Изменить", "O'zgartirish")}
          </button>
          {isArchived ? (
            <button onClick={() => restoreShopMutation.mutate({ id: Number(id) })}
              className="neo-btn flex items-center gap-1.5 text-sm py-2">
              <RotateCcw size={13} />{t("Вернуть в работу", "Ishga qaytarish")}
            </button>
          ) : (
            <button onClick={handleArchive} className="neo-btn flex items-center gap-1.5 text-sm py-2"
              title={t("Убрать из работы, сохранив историю", "Tarixni saqlab, ishdan olib qo'yish")}>
              <Archive size={13} />{t("В архив", "Arxivga")}
            </button>
          )}
          {/* Стереть предлагаем, только когда стирать нечего. */}
          {canDeleteForever && (
            <button onClick={handleDeleteForever} className="btn-ghost flex items-center gap-1.5 text-sm text-danger"
              title={t("За точкой ничего не числится — можно удалить", "Do'kon zimmasida hech narsa yo'q — o'chirish mumkin")}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
        )}
      </div>

      {/* Карточка магазина */}
      <div className="neo-card p-5">
        {editing ? (
          <div className="space-y-3">
            <p className="font-label text-[10px] text-primary tracking-wider">{t("РЕДАКТИРОВАНИЕ", "TAHRIRLASH")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "name",      ru: "Название",  uz: "Nomi"      },
                { key: "ownerName", ru: "Владелец",  uz: "Egasi"     },
                { key: "phone",     ru: "Телефон",   uz: "Telefon"   },
                { key: "address",   ru: "Адрес",     uz: "Manzil"    },
                { key: "city",      ru: "Город",     uz: "Shahar"    },
                { key: "district",  ru: "Район",     uz: "Tuman"     },
              ].map(f => (
                <input key={f.key} className="neo-input"
                  placeholder={lang === "uz" ? f.uz : f.ru}
                  defaultValue={(shop as Record<string, unknown>)[f.key] as string ?? ""}
                  onChange={e => setEditData((d: Record<string, unknown>) => ({ ...d, [f.key]: e.target.value }))} />
              ))}
            </div>
            {agents.length > 0 && (
              <div>
                <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
                  {t("АГЕНТ", "AGENT")}
                </label>
                <PremiumSelect
                  value={String((shop as Record<string, unknown>).agentId ?? "")}
                  onChange={v => setEditData((d: Record<string, unknown>) => ({ ...d, agentId: v ? Number(v) : null }))}
                  options={[
                    { value: "", label: t("Без агента", "Agentsiz") },
                    ...agents.map((a: { id: number; name: string }) => ({ value: String(a.id), label: a.name })),
                  ]}
                  width="100%"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => updateShop.mutate({ id: shop.id, ...editData })}
                disabled={updateShop.isPending}
                className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
                {updateShop.isPending && <Loader2 size={14} className="animate-spin" />}
                {t("Сохранить", "Saqlash")}
              </button>
              <button onClick={() => setEditing(false)} className="neo-btn">{t("Отмена", "Bekor")}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            {/* Photo with upload */}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload}/>
            <div className={`relative group flex-shrink-0 ${canEdit ? "cursor-pointer" : ""}`}
                 onClick={canEdit ? () => fileRef.current?.click() : undefined}>
              <div className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center border border-border-subtle"
                style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)" }}>
                {uploadPhoto.isPending ? <Loader2 size={28} className="text-primary animate-spin"/>
                  : <PhotoOrIcon src={shop.photoUrl} alt={shop.name} className="w-full h-full object-cover"
                      fallback={<Store size={28} className="text-primary"/>} />}
              </div>
              {canEdit && (
              <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-xl">
                <Camera size={18} color="#fff"/><span className="text-white text-[9px]">{t("Фото","Rasm")}</span>
              </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-xl font-bold text-primary tracking-tight">{shop.name}</h1>
              <p className="text-secondary text-sm mt-0.5">{shop.ownerName ?? t("Владелец не указан", "Egasi ko'rsatilmagan")}</p>
              <div className="flex flex-wrap gap-4 mt-3">
                {shop.phone && (
                  <a href={`tel:${shop.phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                    <Phone size={13} />{shop.phone}
                  </a>
                )}
                {(shop.city || shop.address) && (
                  <span className="flex items-center gap-1.5 text-sm text-secondary">
                    <MapPin size={13} />{[shop.address, shop.city, shop.district].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Блок долга */}
      <div className="neo-card p-5"
        style={hasDebt ? { borderColor: "color-mix(in srgb, #d45050 35%, transparent)" } : undefined}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-label text-[10px] tracking-wider mb-1"
              style={{ color: hasDebt ? "var(--color-danger-text)" : "var(--color-text-tertiary, #6b6760)" }}>
              {t("ТЕКУЩИЙ ДОЛГ", "JORIY QARZ")}
            </p>
            <div className="flex items-center gap-2">
              {hasDebt
                ? <AlertCircle size={18} className="text-danger" />
                : <CheckCircle2 size={18} className="text-success" />}
              <span className={`font-data text-3xl font-bold ${hasDebt ? "text-danger" : "text-success"}`}>
                {fmt(shop.debt ?? "0.00")}
              </span>
            </div>
            {!hasDebt && (
              <p className="text-xs mt-1 text-success">{t("Задолженности нет", "Qarz yo'q")}</p>
            )}
          </div>
          {/* shop.addPayment — operatorQuery. Долг супервайзер видит, но
              деньги в кассу принимает не он. */}
          {canEdit && (
          <button data-testid="payment-open" onClick={() => setShowPayment(true)} className="neo-btn-primary flex items-center gap-2">
            <Plus size={15} />{t("Добавить платёж", "To'lov qo'shish")}
          </button>
          )}
        </div>

      </div>

      {/*
        Акт сверки вместо прежней «Истории платежей».

        Там показывались пять записей таблицы платежей — .slice(0, 5) от
        запроса, который и сам брал только двадцать последних, так что дальше
        пятой строки истории попросту не существовало. Отгрузок и возвратов в
        ней не было вовсе, а без них ряд платежей ничего не объясняет: долг
        растёт не от них. Здесь те же платежи, но с отгрузками, возвратами и
        остатком после каждой строки — и с бумагой, которую подписывают обе
        стороны.
      */}
      <ShopStatement shopId={Number(id)} />

      {/* История заказов */}
      {shop.recentOrders && shop.recentOrders.length > 0 && (
        <div className="neo-card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
            <p className="font-label text-[10px] text-primary tracking-wider">
              {t("ЗАКАЗЫ МАГАЗИНА", "DO'KON BUYURTMALARI")}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--color-border, #d8d5cd)" }}>
            {shop.recentOrders.slice(0, 10).map((o: { id: number; orderNumber: string; status: string; total: string; createdAt: string | Date }) => (
              <div key={o.id}
                className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-light/40 transition-colors"
                onClick={() => navigate(`/orders/${o.id}`)}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: STATUS[o.status ?? ""]?.dot ?? "var(--color-border, #d8d5cd)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-data font-semibold text-primary">{o.orderNumber}</p>
                  <p className="text-xs text-secondary mt-0.5">
                    {labelled(ORDER_STATUS_LABEL, o.status, lang)} ·{" "}
                    {o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-data text-sm font-bold text-primary">{fmt(o.total)}</span>
                  <ChevronRight size={14} className="text-secondary" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
