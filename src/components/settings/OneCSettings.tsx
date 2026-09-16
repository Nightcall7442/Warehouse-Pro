import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { colorMix } from "@/lib/color-mix";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";
import { Loader2, CheckCircle2, XCircle, RefreshCw, Search, Plus, RotateCcw } from "lucide-react";

/**
 * 1С — рабочее место директора, а не список ручек.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран рассказывал про «Bridge-сервер» и переменные окружения ONEC_*, которых
 * никто не читал; мастер подключения был написан, но нигде не смонтирован;
 * магазины с контрагентами 1С не сопоставлял никто — обмен не мог заработать
 * ни у одного клиента.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Порядок сверху вниз повторяет порядок подключения:
 *   1. Подключение: адрес публикации OData, логин, пароль, конфигурация.
 *      «Проверить связь» сверяет имена пресета со структурой базы клиента.
 *   2. Что выбрать в 1С: организация, склад, тип цен — списки из самой 1С.
 *   3. Магазины ↔ контрагенты: автоматически, потом руками что осталось.
 *   4. Обмен: загрузить номенклатуру, выгрузить очередь, журнал с «Повторить».
 */

type Preset = "bp_uz" | "ut" | "custom";

export function OneCSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const presetsQ = trpc.onec.presets.useQuery();
  const configQ = trpc.onec.wizard.getConfig.useQuery();
  const statusQ = trpc.onec.status.useQuery();
  const saved = configQ.data ?? null;

  // ── 1. Подключение ────────────────────────────────────────────────────────
  const EMPTY = {
    url: "", username: "", password: "", preset: "bp_uz" as Preset, nameOverrides: "",
    organizationKey: "", warehouseKey: "", priceTypeKey: "",
    enabled: false, syncProducts: true, syncOrders: true, syncCounterparties: true, syncPayments: false, intervalMinutes: "60",
  };
  const [form, setForm] = useState(EMPTY);
  // Форма заполняется сохранённым один раз, когда оно пришло — тем же приёмом, что CompanySettings.
  const [hydratedFrom, setHydratedFrom] = useState<unknown>(null);
  if (saved && hydratedFrom !== saved) {
    setHydratedFrom(saved);
    setForm(f => ({
      ...f,
      url: saved.url, username: saved.username, preset: (saved.preset as Preset) ?? "bp_uz",
      nameOverrides: saved.nameOverrides ? JSON.stringify(saved.nameOverrides, null, 2) : "",
      organizationKey: saved.organizationKey ?? "", warehouseKey: saved.warehouseKey ?? "", priceTypeKey: saved.priceTypeKey ?? "",
      enabled: saved.enabled, syncProducts: saved.syncProducts ?? true, syncOrders: saved.syncOrders ?? true,
      syncCounterparties: saved.syncCounterparties, syncPayments: saved.syncPayments, intervalMinutes: String(saved.intervalMinutes ?? 60),
    }));
  }
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  const parseOverrides = (): Record<string, unknown> | null | "bad" => {
    if (!form.nameOverrides.trim()) return null;
    try { return JSON.parse(form.nameOverrides) as Record<string, unknown>; } catch { return "bad"; }
  };

  const test = trpc.onec.wizard.testConnection.useMutation({
    onError: (e) => notify.error(e.message),
  });
  const runTest = () => {
    const overrides = parseOverrides();
    if (overrides === "bad") { notify.error(t("Переопределения имён — не JSON", "Nom almashtirishlar JSON emas")); return; }
    test.mutate({ url: form.url, username: form.username, password: form.password || undefined, preset: form.preset, nameOverrides: overrides ?? undefined });
  };

  const save = trpc.onec.wizard.saveConfig.useMutation({
    onSuccess: () => {
      notify.success(t("Настройки 1С сохранены", "1C sozlamalari saqlandi"));
      setForm(f => ({ ...f, password: "" }));
      utils.onec.wizard.getConfig.invalidate(); utils.onec.status.invalidate(); utils.onec.wizard.lists.invalidate();
    },
    onError: (e) => notify.error(e.message),
  });
  const runSave = () => {
    const overrides = parseOverrides();
    if (overrides === "bad") { notify.error(t("Переопределения имён — не JSON", "Nom almashtirishlar JSON emas")); return; }
    save.mutate({
      url: form.url, username: form.username, password: form.password || undefined, preset: form.preset, nameOverrides: overrides,
      organizationKey: form.organizationKey || null, warehouseKey: form.warehouseKey || null, priceTypeKey: form.priceTypeKey || null,
      enabled: form.enabled, syncProducts: form.syncProducts, syncOrders: form.syncOrders, syncCounterparties: form.syncCounterparties, syncPayments: form.syncPayments,
      intervalMinutes: Math.min(1440, Math.max(5, Number(form.intervalMinutes) || 60)),
    });
  };

  // ── 2. Списки из 1С ───────────────────────────────────────────────────────
  const listsQ = trpc.onec.wizard.lists.useQuery(undefined, { enabled: Boolean(saved), retry: false });
  const structure = trpc.onec.wizard.checkStructure.useMutation({ onError: (e) => notify.error(e.message) });

  // ── 3. Магазины ↔ контрагенты ─────────────────────────────────────────────
  const unmappedQ = trpc.onec.counterparties.unmapped.useQuery(undefined, { enabled: Boolean(saved), retry: false });
  const syncCp = trpc.onec.counterparties.sync.useMutation({
    onSuccess: (r) => {
      notify.success(t(`Контрагентов в 1С: ${r.total}. Сопоставлено: ${r.matched}, осталось: ${r.unmatched}`, `1C da kontragentlar: ${r.total}. Moslandi: ${r.matched}, qoldi: ${r.unmatched}`));
      utils.onec.counterparties.unmapped.invalidate();
    },
    onError: (e) => notify.error(e.message),
  });
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const searchQ = trpc.onec.counterparties.search.useQuery({ q }, { enabled: pickFor !== null && q.trim().length > 0, retry: false });
  const mapShop = trpc.onec.counterparties.map.useMutation({
    onSuccess: () => { setPickFor(null); setQ(""); utils.onec.counterparties.unmapped.invalidate(); },
    onError: (e) => notify.error(e.message),
  });
  const createCp = trpc.onec.counterparties.create.useMutation({
    onSuccess: () => { notify.success(t("Контрагент создан в 1С", "Kontragent 1C da yaratildi")); utils.onec.counterparties.unmapped.invalidate(); },
    onError: (e) => notify.error(e.message),
  });

  // ── 4. Обмен и журнал ─────────────────────────────────────────────────────
  const [journalStatus, setJournalStatus] = useState<"" | "pending" | "failed" | "skipped" | "done">("");
  const journalQ = trpc.onec.journal.list.useQuery({ status: journalStatus || undefined, limit: 100 }, { enabled: Boolean(saved), retry: false });
  const refreshExchange = () => { utils.onec.journal.list.invalidate(); utils.onec.status.invalidate(); };
  const syncProducts = trpc.onec.syncProducts.useMutation({
    onSuccess: (r) => { notify.success(t(`Номенклатура: ${r.synced} позиций, ошибок ${r.errors}${r.blockedByPlan ? `, не поместилось в тариф ${r.blockedByPlan}` : ""}`, `Nomenklatura: ${r.synced} ta, xato ${r.errors}`)); refreshExchange(); },
    onError: (e) => notify.error(e.message),
  });
  const runQueue = trpc.onec.runQueue.useMutation({
    onSuccess: (r) => {
      notify.success(t(`Очередь: выгружено ${r.done}, отказов ${r.failed}, ждут решения ${r.skipped}`, `Navbat: yuklandi ${r.done}, xato ${r.failed}, qaror kutmoqda ${r.skipped}`));
      if ("error" in r.bank) notify.error(t(`Сверка безнала: ${r.bank.error}`, `Naqdsiz solishtirish: ${r.bank.error}`));
      else if (r.bank.matched > 0 || r.bank.pending > 0) notify.success(t(`Безнал: по выписке 1С подтверждено ${r.bank.matched}, ждут ${r.bank.pending}`, `Naqdsiz: 1C ko'chirmasi bo'yicha tasdiqlandi ${r.bank.matched}, kutmoqda ${r.bank.pending}`));
      refreshExchange();
    },
    onError: (e) => notify.error(e.message),
  });
  const retry = trpc.onec.journal.retry.useMutation({ onSuccess: refreshExchange, onError: (e) => notify.error(e.message) });
  const metricsQ = trpc.onec.metrics.useQuery(undefined, { enabled: Boolean(saved) });

  const [issued, setIssued] = useState<{ secret: string; header: string } | null>(null);
  const issueSecret = trpc.onec.wizard.issueWebhookSecret.useMutation({
    onSuccess: (r) => setIssued({ secret: r.secret, header: r.header }),
    onError: (e) => notify.error(e.message),
  });

  const status = statusQ.data;
  const presetOptions = Object.entries(presetsQ.data ?? {}).map(([value, l]) => ({ value, label: lang === "uz" ? l.uz : l.ru }));
  const toOptions = (rows?: Array<{ key: string; name: string }>) => (rows ?? []).map(r => ({ value: r.key, label: r.name }));
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("ru") : t("ещё не было", "hali bo'lmagan"));
  const STATUS_LABEL: Record<string, string> = {
    pending: t("в очереди", "navbatda"), done: t("выгружено", "yuklandi"), failed: t("отказ", "xato"), skipped: t("ждёт решения", "qaror kutmoqda"),
  };
  const ENTITY_LABEL: Record<string, string> = { order: t("заказ", "buyurtma"), payment: t("оплата", "to'lov"), product: t("товар", "mahsulot"), counterparty: t("контрагент", "kontragent") };
  const toggle = (k: "enabled" | "syncProducts" | "syncOrders" | "syncCounterparties" | "syncPayments", label: string) => (
    <label key={k} className="flex items-center gap-2 text-sm text-primary cursor-pointer">
      <input type="checkbox" checked={form[k]} onChange={e => set(k)(e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "var(--color-primary)" }} />
      {label}
    </label>
  );

  return (
    <div>
      {dialog}

      {/* Состояние — одной полосой: подключено ли, идёт ли обмен, что в очереди. */}
      {status?.configured && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-6">
          {[
            [t("Связь", "Aloqa"), status.lastTestOk === null ? t("не проверяли", "tekshirilmagan") : status.lastTestOk ? t("есть", "bor") : t("нет", "yo'q")],
            [t("Обмен по расписанию", "Jadval bo'yicha"), status.enabled ? t(`каждые ${status.schedule?.intervalMinutes} мин`, `har ${status.schedule?.intervalMinutes} daqiqa`) : t("выключен", "o'chiq")],
            [t("Последний обмен", "Oxirgi almashinuv"), fmt(status.lastSyncAt)],
            [t("Очередь", "Navbat"), `${status.queue.pending ?? 0} · ${t("отказов", "xato")} ${status.queue.failed ?? 0}`],
          ].map(([k, v]) => (
            <div key={k} className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)" }}>
              <p className="text-xs text-tertiary mb-1">{k}</p>
              <p className="text-sm font-medium text-primary tabular-nums">{v}</p>
            </div>
          ))}
          {status.lastError && (
            <div className="col-span-full p-3 rounded-xl" role="alert" style={{ background: colorMix("var(--color-danger)", 10) }}>
              <p className="text-xs text-tertiary mb-1">{t("Последний отказ", "Oxirgi xatolik")}</p>
              <p className="text-sm text-danger break-words">{status.lastError}</p>
            </div>
          )}
        </div>
      )}

      {/* 1. Подключение */}
      <FieldGroup first title={t("Подключение к 1С", "1C ga ulanish")}>
        <p className="text-xs text-tertiary mb-4 max-w-prose">
          {t(
            "Нужна публикация базы 1С на веб-сервере с включённым стандартным интерфейсом OData и пользователь 1С с правами на справочники и документы реализации. Как это сделать — в docs/onec.md; дописывать что-либо в 1С не требуется.",
            "1C bazasi veb-serverda standart OData interfeysi bilan nashr etilgan bo'lishi va ma'lumotnomalar hamda sotuv hujjatlariga huquqli 1C foydalanuvchisi kerak. Qanday qilish — docs/onec.md da; 1C ga hech narsa yozish shart emas.",
          )}
        </p>
        <FieldRow>
          <Field label={t("Адрес публикации", "Nashr manzili")} hint={t("Например, https://1c.company.uz/buh — /odata/standard.odata допишется само", "Masalan, https://1c.company.uz/buh — /odata/standard.odata o'zi qo'shiladi")}>
            <input className="neo-input font-data" value={form.url} onChange={e => set("url")(e.target.value)} placeholder="https://1c.company.uz/buh" />
          </Field>
          <Field label={t("Конфигурация", "Konfiguratsiya")}>
            <PremiumSelect value={form.preset} options={presetOptions.length ? presetOptions : [{ value: "bp_uz", label: "1С:Бухгалтерия 8 для Узбекистана" }]} onChange={v => set("preset")(v as Preset)} width="100%" />
          </Field>
          <Field label={t("Пользователь 1С", "1C foydalanuvchisi")}>
            <input className="neo-input" value={form.username} onChange={e => set("username")(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t("Пароль", "Parol")} hint={saved ? t("Пусто — оставить сохранённый", "Bo'sh — saqlanganini qoldirish") : undefined}>
            <input className="neo-input" type="password" value={form.password} onChange={e => set("password")(e.target.value)} autoComplete="new-password" placeholder={saved ? "••••••••" : ""} />
          </Field>
        </FieldRow>
        {form.preset === "custom" && (
          <div className="mt-4">
            <Field label={t("Переопределения имён (JSON)", "Nom almashtirishlar (JSON)")}
              hint={t("Поверх пресета Бухгалтерии: например {\"sale\":{\"set\":\"Document_РеализацияТоваровУслуг\"}}. Что именно назвать — подскажет проверка связи.", "Buxgalteriya preseti ustidan; nimani nomlashni aloqa tekshiruvi aytadi.")}>
              <textarea className="neo-input font-data" rows={5} value={form.nameOverrides} onChange={e => set("nameOverrides")(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button className="neo-btn flex items-center gap-2" onClick={runTest} disabled={test.isPending || !form.url || !form.username}>
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t("Проверить связь", "Aloqani tekshirish")}
          </button>
          {saved && (
            <button className="neo-btn flex items-center gap-2" onClick={() => structure.mutate()} disabled={structure.isPending}>
              {structure.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {t("Проверить структуру сохранённого", "Saqlangan tuzilmani tekshirish")}
            </button>
          )}
        </div>
        {test.data && (
          <div className="mt-4 p-4 rounded-xl" style={{ background: colorMix(test.data.ok ? "var(--color-success)" : "var(--color-danger)", 10) }}>
            <div className="flex items-center gap-2">
              {test.data.ok ? <CheckCircle2 size={18} className="text-success" /> : <XCircle size={18} className="text-danger" />}
              <p className="text-sm font-medium text-primary">
                {test.data.ok
                  ? t(`Связь есть: ${test.data.structure.sets} наборов, проверено имён ${test.data.structure.checked}, расхождений ${test.data.structure.problems.length}`, `Aloqa bor: ${test.data.structure.sets} to'plam, tekshirildi ${test.data.structure.checked}, farq ${test.data.structure.problems.length}`)
                  : test.data.error}
              </p>
            </div>
            <p className="text-xs text-tertiary mt-1 font-data">{test.data.url}</p>
            {test.data.ok && test.data.structure.problems.length > 0 && <Problems rows={test.data.structure.problems} t={t} />}
          </div>
        )}
        {structure.data && (
          <div className="mt-4 p-4 rounded-xl" style={{ background: colorMix(structure.data.problems.length ? "var(--color-warning)" : "var(--color-success)", 10) }}>
            <p className="text-sm font-medium text-primary">
              {t(`Проверено имён ${structure.data.checked}, расхождений ${structure.data.problems.length}`, `Tekshirildi ${structure.data.checked}, farq ${structure.data.problems.length}`)}
            </p>
            {structure.data.problems.length > 0 && <Problems rows={structure.data.problems} t={t} />}
          </div>
        )}
      </FieldGroup>

      {/* 2. Что выбрать в 1С */}
      <FieldGroup title={t("Что выбрать в 1С", "1C da nimani tanlash")}>
        {!saved ? (
          <p className="text-sm text-tertiary">{t("Сначала сохраните подключение — списки читаются из самой 1С.", "Avval ulanishni saqlang — ro'yxatlar 1C ning o'zidan o'qiladi.")}</p>
        ) : listsQ.isError ? (
          <p className="text-sm text-danger" role="alert">{listsQ.error.message}</p>
        ) : (
          <FieldRow>
            <Field label={t("Организация", "Tashkilot")} hint={t("От чьего имени проводится реализация", "Sotuv kimning nomidan o'tkaziladi")}>
              <PremiumSelect value={form.organizationKey} options={toOptions(listsQ.data?.organizations)} onChange={set("organizationKey")} width="100%" disabled={listsQ.isLoading} />
            </Field>
            <Field label={t("Склад", "Ombor")} hint={t("Откуда списывается товар в 1С", "1C da tovar qaysi ombordan chiqadi")}>
              <PremiumSelect value={form.warehouseKey} options={toOptions(listsQ.data?.warehouses)} onChange={set("warehouseKey")} width="100%" disabled={listsQ.isLoading} />
            </Field>
            <Field label={t("Тип цен", "Narx turi")} hint={t("Откуда брать цену номенклатуры при загрузке", "Yuklashda narx qayerdan olinadi")}>
              <PremiumSelect value={form.priceTypeKey} options={toOptions(listsQ.data?.priceTypes)} onChange={set("priceTypeKey")} width="100%" disabled={listsQ.isLoading} />
            </Field>
            <Field label={t("Интервал обмена, мин", "Almashinuv oralig'i, daq")} hint={t("От 5 минут до суток", "5 daqiqadan bir kungacha")}>
              <input className="neo-input font-data" inputMode="numeric" value={form.intervalMinutes} onChange={e => set("intervalMinutes")(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
          </FieldRow>
        )}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {toggle("enabled", t("Обмен по расписанию включён", "Jadval bo'yicha almashinuv yoqilgan"))}
          {toggle("syncProducts", t("Номенклатура из 1С", "1C dan nomenklatura"))}
          {toggle("syncCounterparties", t("Контрагенты из 1С", "1C dan kontragentlar"))}
          {toggle("syncOrders", t("Доставленные заказы → реализация", "Yetkazilgan buyurtmalar → sotuv"))}
          {toggle("syncPayments", t("Оплаты: наличные → ПКО, безнал ← поступления на счёт", "To'lovlar: naqd → KKO, naqdsiz ← hisobga tushumlar"))}
        </div>
        <SaveBar onSave={runSave} isPending={save.isPending} disabled={!form.url || !form.username || (!saved && !form.password)}
          label={t("Сохранить", "Saqlash")}
          hint={t("Пароль хранится зашифрованным; в журнал попадают адрес и логин.", "Parol shifrlangan saqlanadi; jurnalga manzil va login tushadi.")} />
      </FieldGroup>

      {/* 3. Магазины ↔ контрагенты */}
      {saved && (
        <FieldGroup title={t("Магазины ↔ контрагенты 1С", "Do'konlar ↔ 1C kontragentlari")}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <p className="text-sm text-secondary">
              {unmappedQ.data
                ? t(`Связано ${unmappedQ.data.mappedCount} из ${unmappedQ.data.total}; без контрагента — ${unmappedQ.data.unmapped.length}`, `Bog'langan ${unmappedQ.data.mappedCount} / ${unmappedQ.data.total}; kontragentsiz — ${unmappedQ.data.unmapped.length}`)
                : unmappedQ.isError ? unmappedQ.error.message : "…"}
            </p>
            <button className="neo-btn flex items-center gap-2" onClick={() => syncCp.mutate()} disabled={syncCp.isPending}>
              {syncCp.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("Сопоставить по названию и телефону", "Nom va telefon bo'yicha moslash")}
            </button>
          </div>
          {unmappedQ.data && unmappedQ.data.unmapped.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              {unmappedQ.data.unmapped.slice(0, 50).map(shop => (
                <div key={shop.id} className="p-3 border-t first:border-t-0 border-border-subtle">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-primary">{shop.name}</p>
                      <p className="text-xs text-tertiary">{[shop.phone, shop.address].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="neo-btn neo-btn-sm flex items-center gap-1" onClick={() => { setPickFor(pickFor === shop.id ? null : shop.id); setQ(shop.name); }}>
                        <Search size={13} /> {t("Найти в 1С", "1C dan topish")}
                      </button>
                      <button className="neo-btn neo-btn-sm flex items-center gap-1" disabled={createCp.isPending} onClick={() => createCp.mutate({ shopId: shop.id })}>
                        <Plus size={13} /> {t("Создать в 1С", "1C da yaratish")}
                      </button>
                    </div>
                  </div>
                  {pickFor === shop.id && (
                    <div className="mt-3">
                      <input className="neo-input" value={q} onChange={e => setQ(e.target.value)} placeholder={t("Название контрагента в 1С", "1C dagi kontragent nomi")} aria-label={t("Поиск контрагента", "Kontragent qidiruvi")} />
                      <div className="mt-2 space-y-1">
                        {searchQ.isLoading && <p className="text-xs text-tertiary">…</p>}
                        {searchQ.data?.length === 0 && <p className="text-xs text-tertiary">{t("В 1С ничего не найдено", "1C da topilmadi")}</p>}
                        {searchQ.data?.map(c => (
                          <button key={c.key} className="w-full text-left p-2 rounded-lg text-sm hover:bg-surface-light flex items-center justify-between gap-2"
                            onClick={() => mapShop.mutate({ shopId: shop.id, externalId: c.key })} disabled={mapShop.isPending}>
                            <span className="text-primary">{c.name}</span>
                            <span className="text-xs text-tertiary font-data">{[c.inn && `ИНН ${c.inn}`, c.phone].filter(Boolean).join(" · ")}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {unmappedQ.data.unmapped.length > 50 && (
                <p className="p-3 text-xs text-tertiary border-t border-border-subtle">{t(`…и ещё ${unmappedQ.data.unmapped.length - 50}. Сначала сопоставьте автоматически.`, `…yana ${unmappedQ.data.unmapped.length - 50}. Avval avtomatik moslang.`)}</p>
              )}
            </div>
          )}
        </FieldGroup>
      )}

      {/* 4. Обмен и журнал */}
      {saved && (
        <FieldGroup title={t("Обмен", "Almashinuv")}>
          <div className="flex flex-wrap gap-3 mb-4">
            <button className="neo-btn-primary flex items-center gap-2 text-sm" onClick={() => syncProducts.mutate()} disabled={syncProducts.isPending}>
              {syncProducts.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("Загрузить номенклатуру из 1С", "1C dan nomenklaturani yuklash")}
            </button>
            <button className="neo-btn flex items-center gap-2 text-sm" onClick={() => runQueue.mutate()} disabled={runQueue.isPending || !status?.ready}
              title={status?.ready ? undefined : t("Выберите организацию, склад и тип цен", "Tashkilot, ombor va narx turini tanlang")}>
              {runQueue.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("Выгрузить очередь сейчас", "Navbatni hozir yuklash")}
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-4">
            {[
              [t("Номенклатура получена", "Nomenklatura olindi"), fmt(status?.lastProductSync)],
              [t("Заказы выгружены", "Buyurtmalar yuborildi"), fmt(status?.lastOrderSync)],
              [t("Отказов обмена", "Almashinuv xatolari"), String(status?.errors ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)" }}>
                <p className="text-xs text-tertiary mb-1">{k}</p>
                <p className="text-sm font-medium text-primary">{v}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-sm font-semibold text-primary">{t("Журнал обмена", "Almashinuv jurnali")}</p>
            <PremiumSelect value={journalStatus} width="200px" onChange={v => setJournalStatus(v as typeof journalStatus)}
              options={[{ value: "", label: t("все записи", "barcha yozuvlar") }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
          </div>
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="text-xs text-tertiary text-left">
                  <th className="p-2 font-medium">{t("Что", "Nima")}</th>
                  <th className="p-2 font-medium">{t("Состояние", "Holat")}</th>
                  <th className="p-2 font-medium">{t("Попыток", "Urinish")}</th>
                  <th className="p-2 font-medium">{t("Почему", "Nega")}</th>
                  <th className="p-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(journalQ.data?.rows ?? []).map(r => (
                  <tr key={r.id} className="border-t border-border-subtle align-top">
                    <td className="p-2 whitespace-nowrap text-primary">{ENTITY_LABEL[r.entityType] ?? r.entityType} #{r.entityId}</td>
                    <td className="p-2 whitespace-nowrap">
                      <span className={r.status === "failed" ? "text-danger" : r.status === "done" ? "text-success" : "text-secondary"}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    </td>
                    <td className="p-2 tabular-nums text-secondary">{r.attempts}</td>
                    <td className="p-2 text-xs text-secondary break-words" style={{ minWidth: "220px" }}>{r.lastError ?? ""}</td>
                    <td className="p-2">
                      {(r.status === "failed" || r.status === "skipped") && (
                        <button className="neo-btn neo-btn-xs flex items-center gap-1" disabled={retry.isPending} onClick={() => retry.mutate({ id: r.id })}>
                          <RotateCcw size={12} /> {t("Повторить", "Qayta")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {journalQ.data && journalQ.data.rows.length === 0 && (
                  <tr><td className="p-3 text-xs text-tertiary" colSpan={5}>{t("Пусто. Заказы попадают сюда после доставки, при следующем обмене.", "Bo'sh. Buyurtmalar yetkazilgach, keyingi almashinuvda tushadi.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Счётчики обмена — для разбора, когда «встало». */}
          {metricsQ.data && Object.keys(metricsQ.data).length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-tertiary cursor-pointer">{t("Счётчики обмена", "Almashinuv hisoblagichlari")}</summary>
              <div className="mt-2 space-y-1">
                {Object.entries(metricsQ.data).map(([name, m]) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <span className="text-secondary truncate">{name}</span>
                    <span className="text-primary font-medium tabular-nums">{m.lastValue} <span className="text-tertiary">({m.count})</span></span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </FieldGroup>
      )}

      {/* Вебхуки из 1С в Warehouse Pro: остатки и оплаты, если их шлёт сама 1С. */}
      {saved && (
        <FieldGroup title={t("Секрет для вебхуков из 1С", "1C vebhuklari uchun maxfiy kalit")}>
          <p className="text-xs text-tertiary mb-3 max-w-prose">
            {t("Нужен только если 1С сама шлёт оплаты и остатки на /api/webhooks/1c/payment и /api/webhooks/1c/stock. Показывается один раз: на сервере хранится отпечаток.", "Faqat 1C o'zi to'lov va qoldiqlarni /api/webhooks/1c/… ga yuborsa kerak. Bir marta ko'rsatiladi: serverda izi saqlanadi.")}
          </p>
          {issued ? (
            <>
              <pre className="p-3 rounded-xl text-xs font-mono overflow-x-auto" style={{ background: "var(--color-surface-light)" }}>
{issued.header}: {issued.secret}
              </pre>
              <button className="neo-btn mt-3" onClick={() => setIssued(null)}>{t("Я скопировал", "Nusxaladim")}</button>
            </>
          ) : (
            <button className="neo-btn" disabled={issueSecret.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("Выпустить новый секрет?", "Yangi maxfiy kalit chiqarilsinmi?"),
                  message: t("Прежний перестанет работать сразу — вебхуки 1С будут отклоняться, пока новый не вписан на стороне 1С.", "Eskisi darhol ishlamay qoladi — yangisi 1C tomonda kiritilmaguncha vebhuklar rad etiladi."),
                  confirmText: t("Выпустить", "Chiqarish"), danger: true,
                });
                if (ok) issueSecret.mutate();
              }}>
              {saved.webhookSecretIssued ? t("Выпустить заново", "Qayta chiqarish") : t("Выпустить секрет", "Maxfiy kalit chiqarish")}
            </button>
          )}
        </FieldGroup>
      )}
    </div>
  );
}

/** Расхождения пресета с базой клиента: что и где называется иначе. */
function Problems({ rows, t }: { rows: Array<{ set: string; field: string; about: string; setExists: boolean }>; t: (ru: string, uz: string) => string }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {rows.map(p => (
        <li key={`${p.set}.${p.field}`} className="text-secondary">
          <span className="text-primary">{p.about}</span> — <span className="font-data">{p.set}.{p.field}</span>: {p.setExists ? t("поля нет", "maydon yo'q") : t("набора нет — OData для него не включён или имя иное", "to'plam yo'q — OData yoqilmagan yoki nomi boshqa")}
        </li>
      ))}
    </ul>
  );
}
