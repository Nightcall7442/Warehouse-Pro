import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { Session } from "@contracts/constants";
import { PHONE_ERROR } from "@contracts/signup";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, countOf, type ServiceDb } from "./harness";

/**
 * Телефон при регистрации и звонок в первый час — настоящим путём.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Форма регистрации брала название, имя, почту и пароль. Вход закрыт до
 * ссылки из письма (#115): письмо ушло в спам — клиент потерян, позвонить
 * некому, телефона нет нигде. В Telegram владельцу приходили название и
 * почта. Заявка на тариф от такой организации шла с «📞 не указан» или с
 * почтой вместо номера. Откуда пришла организация, не знал никто.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Через HTTP-ручку /api/trpc/tenant.register — тот же путь, что у формы, с
 * разбором входа и переводом отказа в текст для человека:
 *   · номер в любом написании ложится в tenants.owner_phone как
 *     +998XXXXXXXXX, почта — в owner_email, ответ и метки — в signup_source;
 *   · без телефона и с неверным номером — отказ с понятным текстом, и
 *     организации в базе нет;
 *   · метка длиннее потолка — не отказ всей форме: метка отброшена, ответ
 *     «откуда узнали» и организация на месте;
 *   · сообщение владельцу уходит сразу, с телефоном ссылкой tel:, почтой и
 *     источником; Telegram отверг ссылку — уходит второе, номером текстом;
 *     Telegram лежит — регистрация всё равно принята;
 *   · вошедший директор новой организации просит тариф — в заявке его
 *     телефон, а не «не указан».
 *
 * Telegram — настоящий транспорт (lib/telegram → fetch); подменён только
 * сам api.telegram.org.
 *
 * Нарочная поломка (проверено 29.09.2026): не писать ownerPhone в register —
 * падают «номер ложится», «Telegram лежит» и «заявка на тариф»; пропускать
 * телефон без проверки и приведения — падают все десять; убрать строку
 * телефона из шаблона — «сообщение владельцу» и «Telegram отверг»; убрать
 * повтор без ссылки в announceRegistration — «Telegram отверг» и «Telegram
 * лежит»; пустить ноль после кода (/^\d{9}$/) — «ноль после кода»; снять
 * `.catch(undefined)` у ref — «метка длиннее потолка» (отказ «ref слишком
 * длинное» вместо регистрации).
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
const mail = vi.hoisted(() => ({ verify: [] as Array<{ to: string; url: string }> }));
vi.mock("../../lib/mailer", () => ({
  sendVerifyEmail: vi.fn(async (to: string, _n: string, _o: string, url: string) => { mail.verify.push({ to, url }); }),
  sendEmail: vi.fn(async () => {}),
}));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  const over: Record<string, unknown> = {
    appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789",
    telegramBotToken: "test-token", telegramAdminChatId: "777",
  };
  return { env: new Proxy(real.env, { get: (o, k) => (k in over ? over[k as string] : o[k as string]) }) };
});

/** Что ушло в api.telegram.org и что он ответил. */
const tg = vi.hoisted(() => ({
  sent: [] as Array<{ chat_id: string; text: string; parse_mode?: string }>,
  answer: (_text: string): "ok" | "reject" | "down" => "ok",
}));
const realFetch = globalThis.fetch;

describe.skipIf(!hasRealDb)("телефон при регистрации на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    mail.verify.length = 0;
    tg.sent.length = 0;
    tg.answer = () => "ok";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url instanceof Request ? url.url : url);
      if (!href.startsWith("https://api.telegram.org/")) return realFetch(url, init);
      const body = JSON.parse(String(init?.body ?? "{}"));
      tg.sent.push(body);
      const verdict = tg.answer(body.text);
      if (verdict === "down") throw new TypeError("fetch failed");
      return verdict === "ok"
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }), { status: 400 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const app = async () => (await import("../../boot")).default;

  /** Как форма: POST на /api/trpc/…, вход завёрнут для superjson. */
  const trpcPost = async (path: string, input: unknown, cookie = "") => {
    const res = await (await app()).request(`/api/trpc/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ json: input }),
    });
    const body = await res.json() as any;
    return { status: res.status, body, message: body?.error?.json?.message as string | undefined };
  };

  const form = (over: Record<string, unknown> = {}) => ({
    orgName: "Ферганский сок", name: "Дилноза", email: "dilnoza@sok.uz", password: "пароль-восемь",
    phone: "+998 (90) 123-45-67",
    source: { answer: "telegram", utmSource: "ig_sept<script>", ref: "bekzod" },
    ...over,
  });
  const tenantRow = async (name: string) =>
    (await d().select().from(schema.tenants).where(eq(schema.tenants.name, name)))[0] as schema.Tenant | undefined;

  it("номер в любом написании ложится как +998XXXXXXXXX, почта — владельцу, источник — строкой", async () => {
    const r = await trpcPost("tenant.register", form());
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const t = await tenantRow("Ферганский сок");
    expect(t?.ownerPhone).toBe("+998901234567");
    expect(t?.ownerEmail).toBe("dilnoza@sok.uz");
    // Мусор из адреса страницы вычищен: в базу — только похожее на метку.
    expect(t?.signupSource).toBe("answer=telegram; utm_source=ig_septscript; ref=bekzod");

    // Местная запись и без источника — тот же вид номера, источник пуст.
    const r2 = await trpcPost("tenant.register", form({
      orgName: "Сок-2", email: "b@sok.uz", phone: "90 765 43 21", source: undefined,
    }));
    expect(r2.status).toBe(200);
    const t2 = await tenantRow("Сок-2");
    expect(t2?.ownerPhone).toBe("+998907654321");
    expect(t2?.signupSource).toBeNull();
  });

  it("метка длиннее потолка — регистрация проходит, метка отброшена, ответ записан", async () => {
    // «Откуда узнали» необязателен: кривая метка из рекламной ссылки не должна
    // стоить регистрации. Раньше потолок в 200 знаков отвергал всю форму.
    const r = await trpcPost("tenant.register", form({
      source: { answer: "search", utmSource: "ya_direct", ref: "r".repeat(300) },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const t = await tenantRow("Ферганский сок");
    expect(t?.ownerPhone).toBe("+998901234567");
    expect(t?.signupSource).toBe("answer=search; utm_source=ya_direct");
  });

  it.each([
    ["без телефона", undefined],
    ["пустой", ""],
    ["короткий", "12345"],
    ["чужая страна", "+7 912 345 67 89"],
    ["ноль после кода", "+998 01 234 56 78"],
  ])("%s — отказ с понятным текстом, организации нет", async (_name, phone) => {
    const r = await trpcPost("tenant.register", form({ phone }));

    expect(r.status).toBe(400);
    expect(r.message).toBe(PHONE_ERROR.ru);
    expect(await countOf("tenants")).toBe(0);
    expect(await countOf("users")).toBe(0);
    expect(tg.sent, "об отвергнутой регистрации владельцу не пишут").toHaveLength(0);
  });

  it("сообщение владельцу — сразу, с телефоном ссылкой tel:, почтой и источником", async () => {
    await trpcPost("tenant.register", form());

    await vi.waitFor(() => expect(tg.sent).toHaveLength(1));
    const [m] = tg.sent;
    expect(m.chat_id).toBe("777");
    expect(m.parse_mode).toBe("HTML");
    expect(m.text).toContain("Новая регистрация");
    expect(m.text).toContain("Ферганский сок");
    expect(m.text).toContain(`<a href="tel:+998901234567">+998 90 123 45 67</a>`);
    expect(m.text).toContain("dilnoza@sok.uz");
    expect(m.text).toContain("Откуда: Telegram · utm_source: ig_septscript · ref: bekzod");
    // До подтверждения почты: письмо ушло, но по ссылке ещё никто не ходил.
    const [u] = await d().select().from(schema.users).where(eq(schema.users.email, "dilnoza@sok.uz"));
    expect(u.emailVerifiedAt).toBeNull();
  });

  it("Telegram отверг сообщение со ссылкой — уходит второе, номером текстом", async () => {
    tg.answer = (text) => (text.includes("tel:") ? "reject" : "ok");
    await trpcPost("tenant.register", form());

    await vi.waitFor(() => expect(tg.sent).toHaveLength(2));
    expect(tg.sent[0].text).toContain("tel:");
    expect(tg.sent[1].text).not.toContain("href");
    expect(tg.sent[1].text).toContain("+998901234567");
    expect(tg.sent[1].text).toContain("dilnoza@sok.uz");
  });

  it("Telegram лежит — регистрация принята, организация с телефоном на месте", async () => {
    tg.answer = () => "down";
    const r = await trpcPost("tenant.register", form());

    expect(r.status).toBe(200);
    expect(r.body.result.data.json.message).toContain("Письмо отправлено");
    expect((await tenantRow("Ферганский сок"))?.ownerPhone).toBe("+998901234567");
    expect(mail.verify).toHaveLength(1);
    // Обе попытки были, и ни одна не уронила ответ.
    await vi.waitFor(() => expect(tg.sent).toHaveLength(2));
  });

  it("директор новой организации просит тариф — в заявке его телефон, а не «не указан»", async () => {
    await trpcPost("tenant.register", form());
    const token = new URL(mail.verify[0].url).searchParams.get("token")!;
    const { authRouter } = await import("../../auth-router");
    await authRouter.createCaller({ req: new Request("http://localhost/"), resHeaders: new Headers(), db } as any).verifyEmail({ token });

    const login = await (await app()).request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dilnoza@sok.uz", password: "пароль-восемь" }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/)
      .map(c => c.split(";")[0].trim()).filter(c => c.startsWith(`${Session.cookieName}=`)).join("; ");
    expect(cookie).toContain(Session.cookieName);

    const r = await trpcPost("billing.requestUpgrade", { plan: "basic" }, cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const [lead] = await d().select().from(schema.leads);
    expect(lead.phone).toBe("+998901234567");
    expect(lead.company).toBe("Ферганский сок");
  });
});
