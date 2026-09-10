import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Check, X } from "lucide-react";

export function OneCSettings() {
  /*
    Секрет вебхука и счётчики обмена — обе ручки лежали без вызова.

    Секрет держится в состоянии, а не перечитывается: сервер отдаёт его
    ровно один раз, хранит только отпечаток, и повторный запрос вернёт
    НОВЫЙ, сломав уже настроенную сторону 1С.
  */
  const { confirm, dialog } = useConfirm();
  const [issued, setIssued] = useState<{ secret: string; header: string } | null>(null);
  const metricsQ = trpc.onec.metrics.useQuery();
  const issueSecret = trpc.onec.issueWebhookSecret.useMutation({
    onSuccess: (r) => setIssued({ secret: r.secret, header: r.header }),
    onError: (e) => notify.error(e.message),
  });

  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: health, isLoading: healthLoading } = trpc.onec.health.useQuery();
  const { data: status } = trpc.onec.status.useQuery();

  const syncProducts = trpc.onec.syncProducts.useMutation({
    onSuccess: (r) => { notify.success(t(`Синхронизировано: ${r.synced} товаров`, `Sinxronizatsiya: ${r.synced} mahsulot`)); },
    onError: (e) => notify.error(e.message),
  });

  const testConn = trpc.onec.testSavedConnection.useMutation({
    onSuccess: (r) => {
      if (r.success) {
        notify.success(t("Соединение успешно!", "Ulanish muvaffaqiyatli!"));
      } else {
        notify.error(r.error ?? t("Соединение не установлено", "Ulanish o'rnatilmadi"));
      }
    },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Статус соединения */}
      <div>
        <p className="text-sm font-semibold text-primary mb-3">
          {t("Состояние соединения", "Ulanish holati")}
        </p>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: health?.healthy ? "rgba(74,222,128,.10)" : "var(--color-danger-subtle, rgba(232,80,80,.10))",
            border: `1px solid ${health?.healthy ? "rgba(74,222,128,.25)" : "color-mix(in srgb, #d45050 25%, transparent)"}`,
          }}>
          {healthLoading ? (
            <Loader2 size={18} className="text-secondary animate-spin" />
          ) : health?.healthy ? (
            <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          ) : (
            <XCircle size={18} className="text-danger flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">
              {health?.healthy
                ? t("1С Bridge подключён", "1C Bridge ulangan")
                : t("1С Bridge не подключён", "1C Bridge ulanmagan")}
            </p>
            <p className="text-xs text-secondary mt-0.5">
              {health?.healthy
                ? t("Соединение активно", "Ulanish faol")
                : health?.error ?? t("Проверьте настройки подключения", "Ulanish sozlamalarini tekshiring")}
            </p>
          </div>
        </div>
      </div>

      {/* Настройки подключения */}
      <div>
        <p className="text-sm font-semibold text-primary mb-3">
          {t("Настройки подключения", "Ulanish sozlamalari")}
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Для подключения 1С:Предприятие необходим Bridge-сервер.", "1C:Predpriyatiye bilan ulanish uchun Bridge server kerak.")}
            </p>
            <p className="text-xs text-secondary">
              {t("Установите переменные окружения на сервере:", "Serverda muhit o'zgaruvchilarini o'rnating:")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #efedea)", border: "1px solid var(--color-border, #d8d5cd)" }}>
{`ONEC_BRIDGE_URL=http://bridge-server:8080
ONEC_USERNAME=your_user
ONEC_PASSWORD=your_password
ONEC_WEBHOOK_SECRET=your_secret`}
            </pre>
          </div>

          {/*
            Секрет вебхука.

            Ручка выпуска была написана и не вызывалась ниоткуда, а в
            подсказке выше стояло «ONEC_WEBHOOK_SECRET=your_secret» — то есть
            человеку предлагалось придумать секрет самому и вписать руками в
            двух местах. Секрет — единственное, что отделяет чужую организацию
            от записи платежей в вашу, и придумывать его руками нельзя.

            Показывается ОДИН раз: на сервере хранится только его отпечаток, и
            подсмотреть выданный секрет потом неоткуда. Об этом сказано прямо,
            иначе человек закроет окно и придёт с вопросом.
          */}
          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Секрет для вебхуков 1С", "1C vebhuklari uchun maxfiy kalit")}
            </p>
            {issued ? (
              <>
                <pre className="p-3 rounded-lg text-xs font-mono overflow-x-auto"
                  style={{ background: "var(--color-surface, #efedea)" }}>
{issued.header}: {issued.secret}
                </pre>
                <p className="text-xs mt-2" style={{ color: "var(--color-danger-text)" }}>
                  {t(
                    "Скопируйте сейчас — второй раз он не покажется: на сервере хранится только отпечаток.",
                    "Hozir nusxalang — ikkinchi marta ko'rsatilmaydi: serverda faqat izi saqlanadi.",
                  )}
                </p>
              </>
            ) : (
              <button className="neo-btn" disabled={issueSecret.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("Выпустить новый секрет?", "Yangi maxfiy kalit chiqarilsinmi?"),
                    message: t(
                      "Прежний перестанет работать сразу — вебхуки 1С будут отклоняться, пока новый не вписан на стороне 1С.",
                      "Eskisi darhol ishlamay qoladi — yangisi 1C tomonda kiritilmaguncha vebhuklar rad etiladi.",
                    ),
                    confirmText: t("Выпустить", "Chiqarish"),
                    danger: true,
                  });
                  if (ok) issueSecret.mutate();
                }}>
                {t("Выпустить секрет", "Maxfiy kalit chiqarish")}
              </button>
            )}
          </div>

          {/*
            Что происходит с обменом. Ручка метрик тоже лежала без вызова, а
            это единственное место, где видно, идёт обмен или встал.
          */}
          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs text-secondary">
                {t("Обмен с 1С — счётчики", "1C bilan almashinuv — hisoblagichlar")}
              </p>
              <button className="neo-btn" style={{ fontSize: "12px", padding: "4px 10px" }}
                onClick={() => metricsQ.refetch()}>
                {t("Обновить", "Yangilash")}
              </button>
            </div>
            {metricsQ.isLoading ? (
              <div className="h-10 bg-surface animate-pulse rounded" />
            ) : Object.keys(metricsQ.data ?? {}).length === 0 ? (
              <p className="text-xs text-tertiary">
                {t("Обмена ещё не было", "Almashinuv hali bo'lmagan")}
              </p>
            ) : (
              <div className="space-y-1">
                {Object.entries(metricsQ.data ?? {}).map(([name, m]) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <span className="text-secondary truncate">{name}</span>
                    <span className="text-primary font-medium tabular-nums">
                      {m.lastValue} <span className="text-tertiary">({m.count})</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Webhook URL для 1С (настройте в 1С:Предприятие):", "1C uchun webhook URL (1C:Predpriyatoyedagi sozlamalarda):")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #efedea)", border: "1px solid var(--color-border, #d8d5cd)" }}>
{`${t("Оплата", "To'lov")}: https://www.warehouse-pro.uz/api/webhooks/1c/payment
${t("Остатки", "Qoldiqlar")}: https://www.warehouse-pro.uz/api/webhooks/1c/stock`}
            </pre>
          </div>
        </div>
      </div>

      {/* Синхронизация */}
      <div>
        <p className="text-sm font-semibold text-primary mb-3">
          {t("Синхронизация", "Sinxronizatsiya")}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <div>
              <p className="text-sm font-medium text-primary">{t("Товары из 1С", "1C dan mahsulotlar")}</p>
              <p className="text-xs text-secondary mt-0.5">
                {t("Загрузить товары, цены и остатки из 1С", "1C dan mahsulotlar, narxlar va qoldiqlarni yuklash")}
              </p>
            </div>
            <button
              onClick={() => syncProducts.mutate()}
              disabled={syncProducts.isPending || !health?.healthy}
              className="neo-btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              {syncProducts.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("Синхронизировать", "Sinxronlashtirish")}
            </button>
          </div>

          {/*
            Три плитки вместо двух, и каждая говорит о своём.

            Раньше «Последняя синхронизация» показывала время последней ПРОВЕРКИ
            СВЯЗИ: нажал «Проверить соединение» — и экран сообщал, что данные
            только что обменялись. А «Ошибки» считались по исходу той же
            проверки, а не по отказам обмена, поэтому светились зелёным нулём,
            пока обмен падал.

            Теперь обмен товарами, обмен заказами и проверка связи разведены —
            это три разных события, и путать их нельзя.
          */}
          {status && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
                  <p className="text-xs text-tertiary mb-1">
                    {t("Товары получены", "Mahsulotlar olindi")}
                  </p>
                  <p className="text-sm font-medium text-primary">
                    {status.lastProductSync
                      ? new Date(status.lastProductSync).toLocaleString("ru")
                      : t("Не выполнялась", "Bajarilmagan")}
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
                  <p className="text-xs text-tertiary mb-1">
                    {t("Заказы выгружены", "Buyurtmalar yuborildi")}
                  </p>
                  <p className="text-sm font-medium text-primary">
                    {status.lastOrderSync
                      ? new Date(status.lastOrderSync).toLocaleString("ru")
                      : t("Не выполнялась", "Bajarilmagan")}
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
                  <p className="text-xs text-tertiary mb-1">
                    {t("Отказов обмена", "Almashinuv xatolari")}
                  </p>
                  <p className={`text-sm font-medium ${status.errors > 0 ? "text-danger" : "text-success"}`}>
                    {status.errors ?? 0}
                  </p>
                </div>
              </div>

              {/* Текст последнего отказа: число само по себе не говорит, что чинить. */}
              {status.lastError && (
                <div className="p-3 rounded-lg mt-3" style={{ background: "var(--color-danger-dim, rgba(212,80,80,0.10))" }}>
                  <p className="text-xs text-tertiary mb-1">{t("Последний отказ", "Oxirgi xatolik")}</p>
                  <p className="text-sm text-danger break-words">{status.lastError}</p>
                </div>
              )}

              {status.lastTestedAt && (
                <p className="text-xs text-tertiary mt-3">
                  {t("Связь проверяли", "Aloqa tekshirilgan")}: {new Date(status.lastTestedAt).toLocaleString("ru")}
                  {status.lastTestOk === false && ` — ${t("неудачно", "muvaffaqiyatsiz")}`}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Диагностика */}
      <div>
        <p className="text-sm font-semibold text-primary mb-3">
          {t("Диагностика", "Diagnostika")}
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg flex items-center gap-3"
              style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
              {healthLoading ? (
                <Loader2 size={16} className="text-secondary animate-spin" />
              ) : health?.healthy ? (
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#4ade80", boxShadow: "0 0 6px rgba(74,222,128,.5)" }} />
              ) : (
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#e85050", boxShadow: "0 0 6px rgba(232,80,80,.5)" }} />
              )}
              <div>
                <p className="text-xs text-tertiary mb-0.5">
                  {t("Соединение", "Ulanish")}
                </p>
                <p className={`text-sm font-medium ${health?.healthy ? "text-success" : "text-danger"}`}>
                  {health?.healthy ? t("Активно", "Faol") : t("Неактивно", "Faol emas")}
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
              <p className="text-xs text-tertiary mb-1">
                {t("Последняя синхронизация", "Oxirgi sinxronizatsiya")}
              </p>
              <p className="text-sm font-medium text-primary">
                {status?.lastProductSync
                  ? new Date(status.lastProductSync).toLocaleString("ru")
                  : t("Не выполнялась", "Bajarilmagan")}
              </p>
            </div>
          </div>

          <button
            onClick={() => testConn.mutate()}
            disabled={testConn.isPending}
            className="neo-btn flex items-center gap-2 text-sm disabled:opacity-40"
          >
            {testConn.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t("Тестировать соединение", "Ulanishni sinash")}
          </button>

          {testConn.data && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{
                background: testConn.data.success ? "rgba(74,222,128,.10)" : "rgba(232,80,80,.10)",
                border: `1px solid ${testConn.data.success ? "rgba(74,222,128,.25)" : "rgba(232,80,80,.25)"}`,
              }}>
              {testConn.data.success ? (
                <CheckCircle2 size={18} className="text-success flex-shrink-0" />
              ) : (
                <XCircle size={18} className="text-danger flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium text-primary">
                  {testConn.data.success
                    ? t("Тест пройден", "Sinovdan o'tdi")
                    : t("Тест не пройден", "Sinovdan o'tmadi")}
                </p>
                {testConn.data.details && (
                  <p className="text-xs text-secondary mt-0.5">
                    <span className="inline-flex items-center gap-1 mr-2">
                      {testConn.data.details.productsAccessible
                        ? <Check size={13} strokeWidth={3} className="text-success" />
                        : <X size={13} strokeWidth={3} className="text-danger" />}
                      {t("Товары", "Mahsulotlar")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {testConn.data.details.companiesAccessible
                        ? <Check size={13} strokeWidth={3} className="text-success" />
                        : <X size={13} strokeWidth={3} className="text-danger" />}
                      {t("Контрагенты", "Kontragentlar")}
                    </span>
                  </p>
                )}
                {"error" in testConn.data && testConn.data.error && (
                  <p className="text-xs text-danger mt-0.5">{testConn.data.error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Документация */}
      <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-primary mb-1">
              {t("Важно", "Muhim")}
            </p>
            <p className="text-xs text-secondary leading-relaxed">
              {t(
                "Для работы интеграции необходим Bridge-сервер, который связывает 1С:Предприятие с Warehouse Pro. Обратитесь к поставщику 1С для настройки Bridge.",
                "Integratsiya uchun 1C:Predpriyatiye ni Warehouse Pro bilan bog'laydigan Bridge server kerak. Bridge ni sozlash uchun 1C yetkazib beruvchisiga murojaat qiling."
              )}
            </p>
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
