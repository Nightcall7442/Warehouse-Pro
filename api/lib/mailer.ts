import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

function getTransporter() {
  if (!env.smtpHost || env.smtpHost.startsWith("dev-insecure")) {
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
  });
}

interface SendEmailOpts {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
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
        <p><b>${inviterName}</b> приглашает вас присоединиться к <b>${orgName}</b> в роли <b>${role}</b>.</p>
        <a href="${acceptUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Принять приглашение
        </a>
        <p style="color:#666;font-size:12px">Ссылка действительна 48 часов. Если вы не ожидали этого письма — просто проигнорируйте его.</p>
      </div>
    `,
  });
}

export async function sendTrialEndingEmail(
  to: string,
  orgName: string,
  daysLeft: number,
  billingUrl: string,
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
        <p>Организация <b>${orgName}</b> использует пробный период Warehouse Pro.</p>
        <p>Чтобы не потерять доступ к данным, подключите платную подписку.</p>
        <a href="${billingUrl}"
           style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
          Подключить подписку
        </a>
        <p style="color:#666;font-size:12px">Тарифы: Basic $99/мес · Pro $249/мес</p>
      </div>
    `,
  });
}
