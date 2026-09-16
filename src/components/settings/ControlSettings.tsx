import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { FieldGroup } from "./ui";
import { ShieldCheck, QrCode, Gauge } from "lucide-react";

/*
  Контроль — один тумблер.

  Что включается: слово магазина под чеком (по QR — «получил» / «не сходится»)
  и рабочее место «Контроль» с индексом риска по сотруднику. Тариф Pro и
  Exclusive; пробный — всё. Basic видит тумблер и подсказку.
*/
export function ControlSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const status = trpc.control.status.useQuery();
  const setEnabled = trpc.control.setEnabled.useMutation({ onSuccess: (_, v) => { utils.control.status.invalidate(); notify.success(v.enabled ? t("Контроль включён", "Nazorat yoqildi") : t("Контроль выключен", "Nazorat o'chirildi")); }, onError: e => notify.error(e.message) });
  const enabled = status.data?.enabled ?? false;
  const planAllows = status.data?.planAllows ?? true;
  const rows = [
    { Icon: QrCode, title: t("Слово магазина", "Do'kon so'zi"), text: t("Под чеком по QR магазин сам говорит «получил» или «не сходится» — и пишет, что именно. Кнопки есть только на странице по ссылке, не в приложении сотрудника. Спор уходит директору в Telegram сразу.", "Chekdagi QR orqali do'kon o'zi «oldim» yoki «to'g'ri kelmaydi» deydi — va nimaligini yozadi. Tugmalar faqat havola sahifasida, xodim ilovasida emas. Nizo darhol direktorga Telegramga ketadi.") },
    { Icon: Gauge, title: t("Индекс риска", "Xavf indeksi"), text: t("По каждому полевому сотруднику — баллы за то, что уже лежит в учёте: недостачи и долг, наличные дольше суток и сверх лимита, безнал без выписки, спорные и неподтверждённые доставки, возвраты, заказы, переигранные после доставки, скидки, подозрительные визиты. Каждый балл объясним одной строкой.", "Har bir dala xodimi bo'yicha — hisobda allaqachon yotgan narsalar uchun ballar: kamomad va qarz, bir sutkadan ko'p va limitdan ortiq naqd, ko'chirmasiz naqdsiz, nizoli va tasdiqlanmagan yetkazishlar, qaytarishlar, yetkazishdan keyin o'zgartirilgan buyurtmalar, chegirmalar, shubhali tashriflar. Har bir ball bir qator bilan tushuntiriladi.") },
  ];
  return (
    <div>
      <FieldGroup first title={t("Контроль", "Nazorat")}>
        <p className="text-sm text-secondary max-w-prose -mt-2 mb-4">
          {t("Всё, что знает система о доставке, записал сотрудник. Контроль добавляет вторую сторону — магазин — и складывает сигналы в один индекс: куда смотреть сначала.",
             "Yetkazish haqida tizim bilgan hamma narsani xodim yozgan. Nazorat ikkinchi tomonni — do'konni — qo'shadi va signallarni bitta indeksga yig'adi: avval qayerga qarash.")}
        </p>
        <label className="flex items-center gap-3 text-sm text-primary" style={{ cursor: planAllows ? "pointer" : "not-allowed", opacity: planAllows ? 1 : 0.7 }}>
          <input type="checkbox" checked={enabled} disabled={!planAllows || setEnabled.isPending} data-testid="control-enabled"
            onChange={e => setEnabled.mutate({ enabled: e.target.checked })} style={{ width: "18px", height: "18px", accentColor: "var(--color-primary)" }} />
          <span>{t("Включить контроль", "Nazoratni yoqish")}</span>
          {!planAllows && <span className="text-xs" style={{ color: "var(--color-warning-text)" }}>{t("Доступно на тарифах Pro и Exclusive", "Pro va Exclusive tariflarida")}</span>}
        </label>
      </FieldGroup>
      <FieldGroup title={t("Что включается", "Nima yoqiladi")}>
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.title} className="flex gap-3 p-3 rounded-xl text-sm" style={{ background: "var(--color-surface-light)" }}>
              <r.Icon size={18} style={{ color: "var(--color-primary-text)", flexShrink: 0, marginTop: 2 }} />
              <div><div className="font-semibold text-primary">{r.title}</div><div className="text-secondary mt-1">{r.text}</div></div>
            </div>
          ))}
          <p className="text-xs text-tertiary flex items-center gap-1.5"><ShieldCheck size={12} /> {t("Индекс — не приговор, а порядок, в котором смотреть документы.", "Indeks — hukm emas, hujjatlarni ko'rish tartibi.")}</p>
        </div>
      </FieldGroup>
    </div>
  );
}
