import { useId, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   Заявка: «перезвоните мне».

   ── Зачем она вообще ───────────────────────────────────────────────────────

   До этого на лендинге не было ни одной формы и ни одного поля ввода, а в
   настройках контактов лежали telegram: null и phone: null. То есть директор
   дистрибьютора, который не станет регистрироваться сам, а хочет поговорить с
   человеком, не мог связаться никак. Единственным действием была регистрация.

   ── Почему полей мало ──────────────────────────────────────────────────────

   Обязательны имя и телефон — этого хватает, чтобы перезвонить. Каждое лишнее
   обязательное поле отсекает часть тех, кто уже был готов оставить контакт.
   Компания и комментарий есть только в полном виде и необязательны.

   ── Два вида ───────────────────────────────────────────────────────────────

   Короткий стоит в первом экране под кнопками: человек ещё ничего не читал,
   и просить у него должность и отрасль рано. Полный — внизу, где он уже
   дочитал страницу и готов рассказать о себе.
   ═══════════════════════════════════════════════════════════════════════════ */

type Props = {
  /** Короткий вид: только имя и телефон, в одну строку. */
  compact?: boolean;
  /** Поля в столбик даже в compact — для узкого первого экрана на телефоне. */
  stack?: boolean;
  /** Тёмный фон (нижний блок) — иначе бумажный. */
  onInk?: boolean;
  /** Откуда пришла заявка: попадает в запись, чтобы видеть, что работает. */
  source: string;
};

export default function LeadForm({ compact = false, onInk = false, stack = false, source }: Props) {
  const tr = useTranslate();
  const uid = useId();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.lead.create.useMutation({
    onError: (e) => setError(e.message),
  });

  const text = onInk ? LX.paperOnInk : LX.ink;
  const soft = onInk ? LX.softOnInk : LX.inkFaint;
  const line = onInk ? LX.ruleOnInk : LX.ruleStrong;
  const field = onInk ? "rgba(240,238,232,0.06)" : LX.paperRaised;

  /* Отправлено — форма уступает место ответу. Оставлять поля заполненными и
     показывать сообщение сверху значит приглашать отправить второй раз. */
  if (create.isSuccess) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg px-5 py-4"
        style={{ border: `1px solid ${line}`, background: field }}
      >
        <Check size={18} style={{ color: LX.brass, flexShrink: 0, marginTop: 2 }} />
        <div>
          <p className="text-[15px] font-semibold" style={{ color: text }}>
            {tr("Заявка принята", "Ariza qabul qilindi")}
          </p>
          <p className="text-[13px] mt-1" style={{ color: soft }}>
            {tr("Перезвоним в рабочее время. Обычно в течение дня.",
                "Ish vaqtida qo'ng'iroq qilamiz. Odatda kun davomida.")}
          </p>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: field,
    border: `1px solid ${line}`,
    color: text,
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 15,
    width: "100%",
    outline: "none",
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      name: name.trim(),
      phone: phone.trim(),
      company: company.trim() || undefined,
      comment: comment.trim() || undefined,
      source,
    });
  };

  // Кнопка недоступна, пока не заполнено необходимое, — но проверка идёт по
  // тому же правилу, что и на сервере, чтобы «недоступная кнопка» никогда не
  // означала «форма молча не работает».
  const ready = name.trim().length >= 2 && /^[+()\d][\d\s()+-]{6,24}$/.test(phone.trim());

  return (
    <form onSubmit={submit} className="w-full">
      <div className={compact && !stack ? "flex flex-col sm:flex-row gap-2.5" : "flex flex-col gap-2.5"}>
        <div className={compact && !stack ? "sm:w-[34%]" : ""}>
          <label htmlFor={`${uid}-name`} className="sr-only">{tr("Имя", "Ism")}</label>
          <input
            id={`${uid}-name`}
            data-testid="lead-name"
            style={inputStyle}
            placeholder={tr("Имя", "Ism")}
            autoComplete="name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        {!compact && (
          <div>
            <label htmlFor={`${uid}-company`} className="sr-only">{tr("Компания", "Kompaniya")}</label>
            <input
              id={`${uid}-company`}
              data-testid="lead-company"
              style={inputStyle}
              placeholder={tr("Компания (необязательно)", "Kompaniya (ixtiyoriy)")}
              autoComplete="organization"
              value={company}
              onChange={e => setCompany(e.target.value)}
            />
          </div>
        )}

        <div className={compact ? "sm:w-[34%]" : ""}>
          <label htmlFor={`${uid}-phone`} className="sr-only">{tr("Телефон", "Telefon")}</label>
          <input
            id={`${uid}-phone`}
            data-testid="lead-phone"
            style={inputStyle}
            placeholder="+998 90 123 45 67"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>

        {!compact && (
          <div>
            <label htmlFor={`${uid}-comment`} className="sr-only">{tr("Комментарий", "Izoh")}</label>
            <textarea
              id={`${uid}-comment`}
              data-testid="lead-comment"
              style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
              placeholder={tr("Сколько агентов, есть ли 1С — если хотите рассказать сразу",
                              "Nechta agent, 1C bormi — agar darrov aytmoqchi bo'lsangiz")}
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        )}

        <button
          type="submit"
          data-testid="lead-submit"
          disabled={!ready || create.isPending}
          className="inline-flex items-center justify-center gap-2 font-semibold"
          // Пока поля пусты, кнопка — контурная, а не притушенная серым: серая
          // читалась как сломанная, и это был первый экран страницы.
          style={{
            background: !ready && !create.isPending ? "transparent" : onInk ? LX.paperOnInk : LX.ink,
            color: !ready && !create.isPending ? text : onInk ? LX.ink : LX.paperOnInk,
            borderRadius: 8,
            padding: "12px 22px",
            fontSize: 15,
            border: !ready && !create.isPending ? `1px solid ${line}` : "1px solid transparent",
            cursor: !ready || create.isPending ? "not-allowed" : "pointer",
            opacity: create.isPending ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {create.isPending
            ? <><Loader2 size={15} className="animate-spin" />{tr("Отправляем…", "Yuborilmoqda…")}</>
            : <>{tr("Перезвоните мне", "Menga qo'ng'iroq qiling")}<ArrowRight size={15} /></>}
        </button>
      </div>

      {error && (
        <p role="alert" data-testid="lead-error" className="mt-2.5 text-[13px]" style={{ color: onInk ? "#e9a58f" : LX.bad }}>
          {error}
        </p>
      )}

      <p className="mt-3 text-[11.5px]" style={{ ...MONO, color: soft, letterSpacing: "0.04em" }}>
        {tr("Звонок бесплатный. Номер не передаём третьим лицам.",
            "Qo'ng'iroq bepul. Raqamni uchinchi shaxslarga bermaymiz.")}
      </p>
    </form>
  );
}
