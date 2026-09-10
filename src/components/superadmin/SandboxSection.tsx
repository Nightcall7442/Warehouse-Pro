import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { FlaskConical, Copy, Loader2, Check } from "lucide-react";
import { F, COLORS } from "./types";
import { Section, Input, BtnPrimary } from "./ui";

/**
 * Песочница для интеграторов.
 *
 * ── Зачем это здесь ─────────────────────────────────────────────────────────
 *
 * Чужая сторона, которая подключается к выгрузке заказов, обязана где-то
 * проверить листание, снимок и отказы. Без песочницы она проверяет это на
 * боевых данных настоящего арендатора — с его суммами и телефонами его
 * магазинов на чужом экране. ТЗ BEKDRINKS это прямо запрещает.
 *
 * ── Почему ключ показывается один раз ───────────────────────────────────────
 *
 * Потому что хранится только его отпечаток. Показать повторно нечего, и
 * поэтому здесь он выделен, а не спрятан в уведомление: уведомление исчезнет
 * через секунды, а этот ключ придётся передавать человеку.
 */
export function SandboxSection() {
  const utils = trpc.useUtils();
  const [partner, setPartner] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [issued, setIssued] = useState<{ key: string; name: string; orders: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.tenant.createSandbox.useMutation({
    onSuccess: (r) => {
      setIssued({ key: r.key, name: r.name, orders: r.contents.orders });
      setPartner(""); setEmail(""); setPassword("");
      utils.tenant.list.invalidate();
      notify.success("Песочница готова");
    },
    onError: (e) => notify.error(e.message),
  });

  const submit = () => {
    if (partner.trim().length < 2) { notify.error("Назовите интегратора"); return; }
    if (!email.includes("@")) { notify.error("Нужен адрес почты"); return; }
    if (password.length < 8) { notify.error("Пароль минимум 8 символов"); return; }
    create.mutate({ partnerName: partner.trim(), ownerEmail: email.trim(), ownerPassword: password });
  };

  return (
    <Section title="Песочница для интеграторов" icon={FlaskConical}>
      <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, marginBottom: "16px", maxWidth: "62ch" }}>
        Отдельная организация с выдуманными данными: {" "}
        <strong style={{ color: COLORS.textPrimary }}>320 заказов</strong> за три месяца, магазины,
        товары, агенты и курьеры. Партнёр проверяет на ней выгрузку и отказы, не касаясь боевых
        данных. Ключ выдаётся с приметой <code>wp_test_</code>, и каждый ответ помечен средой.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <Input label="Интегратор" value={partner} onChange={e => setPartner(e.target.value)} placeholder="BEKDRINKS / ASTRA" />
        <Input label="Почта для входа" value={email} onChange={e => setEmail(e.target.value)} placeholder="integrator@example.com" />
        <Input label="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="минимум 8 символов" />
      </div>

      <BtnPrimary onClick={submit} disabled={create.isPending} style={{ marginTop: "16px" }}>
        {create.isPending
          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Заполняем данными…</>
          : <><FlaskConical size={14} /> Создать песочницу</>}
      </BtnPrimary>

      {issued && (
        <div className="neo-card-sm" style={{ marginTop: "20px", padding: "16px" }}>
          <p style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, marginBottom: "8px" }}>
            {issued.name} · {issued.orders} заказов
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <code style={{ fontFamily: "var(--font-data, monospace)", fontSize: "12px", color: COLORS.textPrimary, wordBreak: "break-all", flex: "1 1 320px" }}>
              {issued.key}
            </code>
            <BtnPrimary
              onClick={() => {
                navigator.clipboard.writeText(issued.key)
                  .then(() => { setCopied(true); notify.success("Ключ скопирован"); })
                  .catch(() => notify.error("Скопируйте вручную"));
              }}
              style={{ padding: "8px 14px", fontSize: "12px" }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Скопирован" : "Скопировать"}
            </BtnPrimary>
          </div>
          <p style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary, marginTop: "10px" }}>
            Ключ показывается один раз — храним только его отпечаток. Передайте его партнёру
            защищённым каналом, не письмом и не в переписке.
          </p>
        </div>
      )}
    </Section>
  );
}
