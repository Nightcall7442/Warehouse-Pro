import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";
import { PLANS, type PlanKey } from "../../contracts/constants";
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatDay, formatSum, priceForTenant } from "../../contracts/pricing";

/** Имя организации и приглашающего задаёт арендатор — в письме это текст, не разметка (аудит 20.09.2026). */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

function getTransporter() {
  const isProd = process.env.NODE_ENV === "production";
  if (!env.smtpHost || env.smtpHost.startsWith("dev-insecure")) {
    if (isProd) {
      logger.error("SMTP_HOST is not configured in production — emails will not be delivered. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.");
      throw new Error("SMTP not configured: set SMTP_HOST in production");
    }
    // Dev: use Ethereal preview URLs (console.log the URL)
    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: { user: "test@ethereal.email", pass: "test" },
    });
  }
  return nodemailer.createTransport({
    host:   env.smtpHost,
    port:   env.smtpPort,
    secure: env.smtpPort === 465,
    auth:   { user: env.smtpUser, pass: env.smtpPass },
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     30_000,
  });
}

interface SendEmailOpts {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from:    env.smtpFrom,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text ?? opts.html.replace(/<[^>]+>/g, ""),
    });
    if (!env.smtpHost || env.smtpHost.startsWith("dev-insecure")) {
      logger.debug("Mail preview (dev)", { url: nodemailer.getTestMessageUrl(info) });
    }
  } catch (err) {
    logger.error("Failed to send email", { to: opts.to, subject: opts.subject, error: err instanceof Error ? err.message : String(err) });
    if (isProd) throw err; // Re-throw in production so callers know it failed
  }
}

export async function sendInviteEmail(
  to: string,
  inviterName: string,
  orgName: string,
  role: string,
  acceptUrl: string,
): Promise<void> {
  await sendEmail({
    to,
    subject: `Вас приглашают в ${orgName} — Warehouse Pro`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111">Приглашение в Warehouse Pro</h2>
        <p><b>${escapeHtml(inviterName)}</b> приглашает вас присоединиться к <b>${escapeHtml(orgName)}</b> в роли <b>${escapeHtml(role)}</b>.</p>
        <a href="${acceptUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Принять приглашение
        </a>
        <p style="color:#666;font-size:12px">Ссылка действительна 48 часов. Если вы не ожидали этого письма — просто проигнорируйте его.</p>
      </div>
    `,
  });
}

/** Подтверждение адреса после регистрации с сайта. Имя и организация — с публичной формы, поэтому экранируются. */
export async function sendVerifyEmail(
  to: string,
  name: string,
  orgName: string,
  verifyUrl: string,
): Promise<void> {
  await sendEmail({
    to,
    subject: "Подтвердите адрес — Warehouse Pro",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111">Подтвердите адрес почты</h2>
        <p>Здравствуйте, ${escapeHtml(name)}.</p>
        <p>Организация <b>${escapeHtml(orgName)}</b> зарегистрирована в Warehouse Pro на этот адрес. Чтобы войти, подтвердите его:</p>
        <a href="${verifyUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Подтвердить адрес
        </a>
        <p style="color:#666;font-size:12px">Ссылка действительна 3 дня. Если вы не регистрировались — просто проигнорируйте это письмо: без подтверждения вход в организацию закрыт.</p>
      </div>
    `,
  });
}

export async function sendTrialEndingEmail(
  to: string,
  orgName: string,
  daysLeft: number,
  billingUrl: string,
  /** Активные агенты, курьеры, мерчендайзеры — по ним считается цена. */
  fieldUsers: number,
): Promise<void> {
  const urgent = daysLeft <= 1;
  await sendEmail({
    to,
    subject: urgent
      ? `⚠️ Пробный период заканчивается завтра — ${orgName}`
      : `Пробный период заканчивается через ${daysLeft} дн. — ${orgName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${urgent ? "#dc2626" : "#d97706"}">
          ${urgent ? "Последний день пробного периода" : `До конца пробного периода ${daysLeft} дн.`}
        </h2>
        <p>Организация <b>${escapeHtml(orgName)}</b> использует пробный период Warehouse Pro.</p>
        <p>Чтобы не потерять доступ к данным, выберите тариф и оставьте заявку — оператор свяжется с вами.</p>
        <a href="${billingUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Выбрать тариф
        </a>
        <p style="color:#666;font-size:12px">${priceLine(fieldUsers)}</p>
      </div>
    `,
  });
}

/*
  Цена — из того же источника, что экран и заявка (contracts/pricing.ts):
  за полевого сотрудника и сразу с суммой для этой организации. Строка
  «Basic 299 000 · Pro 599 000» заставляла директора выбирать тариф, а
  теперь выбирать нечего — надо знать, сколько выйдет у него.
*/
const priceLine = (fieldUsers: number) => {
  const p = priceForTenant("standard", fieldUsers, new Date());
  return `${formatSum(FIELD_PRICE_UZS)} сум/мес за агента, курьера или мерчендайзера (не меньше ${MIN_FIELD_USERS}); ` +
    `офис бесплатно, все функции, без ограничений. У вас ${p.fieldUsers} полевых — ${formatSum(p.monthly)} сум/мес.`;
};

/** Оплаченный срок кончается — за 7, 3 и 1 день (cron/trial-reminders.ts). */
export async function sendRenewalReminderEmail(
  to: string,
  orgName: string,
  plan: string,
  daysLeft: number,
  endsAt: Date,
  billingUrl: string,
  /** Активные агенты, курьеры, мерчендайзеры — по ним считается цена. */
  fieldUsers: number,
): Promise<void> {
  const urgent = daysLeft <= 1;
  const known  = plan in PLANS ? (plan as PlanKey) : null;
  const name   = known ? PLANS[known].name : plan;
  const price  = priceForTenant(plan, fieldUsers, new Date());
  /*
    Сумма продления — та, что выставят: прежний тариф по прежней цене до
    GRANDFATHER_UNTIL (и сразу — во что он превратится), «Стандарт» — за
    полевых этой организации.
  */
  const priceText = price.model === "legacy" && price.grandfatheredUntil
    ? `${escapeHtml(name)}: ${formatSum(price.monthly)} сум/мес — по прежней цене до ${formatDay(price.grandfatheredUntil)}; затем ${formatSum(FIELD_PRICE_UZS)} сум за полевого сотрудника: у вас ${price.fieldUsers} → ${formatSum(price.nextMonthly)} сум/мес.`
    : price.monthly > 0
      ? `${escapeHtml(PLANS[price.plan]?.name ?? name)}: ${price.fieldUsers} полевых — ${formatSum(price.monthly)} сум/мес, за год предоплатой ${formatSum(price.annual)} сум.`
      : "";
  const date   = endsAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" });
  await sendEmail({
    to,
    subject: urgent
      ? `⚠️ Подписка заканчивается завтра — ${orgName}`
      : `Подписка заканчивается через ${daysLeft} дн. — ${orgName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:${urgent ? "#dc2626" : "#d97706"}">
          ${urgent ? "Последний день оплаченного срока" : `До конца оплаченного срока ${daysLeft} дн.`}
        </h2>
        <p>Тариф <b>${escapeHtml(name)}</b> организации <b>${escapeHtml(orgName)}</b> оплачен до ${date}.
           После этого вход закроется для всех сотрудников, включая агентов в поле.</p>
        <p>Нажмите «Продлить» на странице подписки — оператор свяжется с вами. Оплаченные дни не сгорают: продление считается от конца срока.</p>
        <a href="${billingUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Продлить подписку
        </a>
        ${priceText ? `<p style="color:#666;font-size:12px">${priceText}</p>` : ""}
      </div>
    `,
  });
}
