import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2, CheckCircle2, XCircle, RefreshCw, AlertTriangle } from "lucide-react";

export function OneCSettings() {
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
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("СТАТУС СОЕДИНЕНИЯ", "ULANISH HOLATI")}
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
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("НАСТРОЙКИ ПОДКЛЮЧЕНИЯ", "ULANISH SOZLAMALARI")}
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Для подключения 1С:Предприятие необходим Bridge-сервер.", "1C:Predpriyatiye bilan ulanish uchun Bridge server kerak.")}
            </p>
            <p className="text-xs text-secondary">
              {t("Установите переменные окружения на сервере:", "Serverda muhit o'zgaruvchilarini o'rnating:")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #f0f3f8)" }}>
{`ONEC_BRIDGE_URL=http://bridge-server:8080
ONEC_USERNAME=your_user
ONEC_PASSWORD=your_password
ONEC_WEBHOOK_SECRET=your_secret`}
            </pre>
          </div>

          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Webhook URL для 1С (настройте в 1С:Предприятие):", "1C uchun webhook URL (1C:Predpriyatoyedagi sozlamalarda):")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #f0f3f8)" }}>
{`Оплата: https://www.warehouse-pro.uz/api/webhooks/1c/payment
Остатки: https://www.warehouse-pro.uz/api/webhooks/1c/stock`}
            </pre>
          </div>
        </div>
      </div>

      {/* Синхронизация */}
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("СИНХРОНИЗАЦИЯ", "SINXRONIZATSIYA")}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
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

          {status && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
                <p className="text-[10px] text-secondary tracking-wider mb-1">
                  {t("ПОСЛЕДНЯЯ СИНХРОНИЗАЦИЯ", "OXIRGI SINXRONIZATSIYA")}
                </p>
                <p className="text-sm font-medium text-primary">
                  {status.lastProductSync
                    ? new Date(status.lastProductSync).toLocaleString("ru")
                    : t("Не выполнялась", "Bajarilmagan")}
                </p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
                <p className="text-[10px] text-secondary tracking-wider mb-1">
                  {t("ОШИБКИ", "XATOLIKLAR")}
                </p>
                <p className={`text-sm font-medium ${status.errors > 0 ? "text-danger" : "text-success"}`}>
                  {status.errors ?? 0}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Диагностика */}
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("ДИАГНОСТИКА", "DIAGNOSTIKA")}
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg flex items-center gap-3"
              style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
              {healthLoading ? (
                <Loader2 size={16} className="text-secondary animate-spin" />
              ) : health?.healthy ? (
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#4ade80", boxShadow: "0 0 6px rgba(74,222,128,.5)" }} />
              ) : (
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#e85050", boxShadow: "0 0 6px rgba(232,80,80,.5)" }} />
              )}
              <div>
                <p className="text-[10px] text-secondary tracking-wider mb-0.5">
                  {t("СОЕДИНЕНИЕ", "ULANISH")}
                </p>
                <p className={`text-sm font-medium ${health?.healthy ? "text-success" : "text-danger"}`}>
                  {health?.healthy ? t("Активно", "Faol") : t("Неактивно", "Faol emas")}
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
              <p className="text-[10px] text-secondary tracking-wider mb-1">
                {t("ПОСЛЕДНЯЯ СИНХРОНИЗАЦИЯ", "OXIRGI SINXRONIZATSIYA")}
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
                    {t("Товары", "Mahsulotlar")}: {testConn.data.details.productsAccessible ? "✓" : "✗"} ·{" "}
                    {t("Контрагенты", "Kontragentlar")}: {testConn.data.details.companiesAccessible ? "✓" : "✗"}
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
      <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
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
    </div>
  );
}
