import { and, desc, eq, isNull } from "drizzle-orm";
import { deliveryEvents, orders } from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import { storageKeyOf } from "../lib/s3";
import { logger } from "../lib/logger";
import type { Db } from "./order-shared";
import {
  PROOF_MAX_PHOTOS, PROOF_WINDOW_DAYS, PROOF_PHOTO_MAX_CHARS,
  SIGNATURE_MAX_STROKES, SIGNATURE_MAX_POINTS, SIGNATURE_SCALE, signatureProblem, type Signature,
} from "@contracts/delivery-proof";

/*
  Подтверждение вручения: фото, подпись получателя, его имя.

  ── Зачем ───────────────────────────────────────────────────────────────────

  «Не привозили» от магазина через неделю — и у офиса только слово курьера.
  Теперь к отметке «Доставлено» курьер прикладывает снимок товара у прилавка
  и/или подпись принявшего — и офис открывает их в карточке заказа.

  ── Отдельной ручкой, после «Доставлено» ────────────────────────────────────

  «Доставлено» двигает склад и деньги, и не должно ждать загрузки фото в
  подвале со слабой связью. Поэтому подтверждение — отдельный запрос, после:
  отметка проведена, а снимок догоняет её из очереди телефона. Принимается
  только у курьера, который этот заказ довёз, только по доставленному и
  только в течение PROOF_WINDOW_DAYS дней — дописывать «доказательства» через
  месяц, когда спор уже идёт, незачем.

  ── Повтор безопасен, правка — нет ──────────────────────────────────────────

  Очередь телефона повторяет запрос, не дождавшись ответа. Подпись и имя
  ложатся только в пустые поля, фото — только новое (тот же снимок второй раз
  не добавляется): повтор ничего не меняет. А раз записанную подпись или имя
  поверх не переписать — подтверждение, которое можно переписать задним
  числом, ничего не подтверждает.
*/

// Пределы и разбор подписи — в контракте: по ним же экран курьера собирает
// подпись, а карточка заказа рисует её (contracts/delivery-proof.ts).
export {
  PROOF_MAX_PHOTOS, PROOF_WINDOW_DAYS, PROOF_PHOTO_MAX_CHARS,
  SIGNATURE_MAX_STROKES, SIGNATURE_MAX_POINTS, SIGNATURE_SCALE, signatureProblem, type Signature,
};

/**
 * Снимок подтверждения: картинка строкой данных (её проверил вход ручки) или
 * файл НАШЕГО хранилища в папке доставок ЭТОЙ организации — так его положит
 * мобилка, загрузив через upload.file заранее. Чужой адрес в поле
 * доказательства не нужен никому.
 */
export function isProofPhoto(value: string, tenantId: number): boolean {
  if (value.startsWith("data:image/")) return true;
  const key = storageKeyOf(value);
  return key !== null && key.startsWith(`deliveries/${tenantId}/`);
}

export interface SaveProofInput {
  orderId: number;
  photo?: string;
  signature?: Signature;
  recipientName?: string;
}

export async function saveProof(db: Db, tenantId: number, courierId: number, input: SaveProofInput, now: number = Date.now()) {
  const recipientName = input.recipientName ? sanitizeString(input.recipientName).trim().slice(0, 120) : "";
  if (!input.photo && !input.signature && !recipientName) {
    throw badRequest("Нечего сохранить: добавьте фото, подпись или имя получателя");
  }
  if (input.photo && !isProofPhoto(input.photo, tenantId)) {
    throw badRequest("Фото подтверждения — снимок с телефона или файл из хранилища этой организации");
  }
  if (input.signature && signatureProblem(input.signature)) {
    throw badRequest("Подпись не читается — распишитесь ещё раз");
  }

  return db.transaction(async (tx) => {
    // Замок на заказ: два снимка из очереди разом не потеряют друг друга.
    const [o] = await tx.select({ id: orders.id, courierId: orders.courierId, deliveryStatus: orders.deliveryStatus, deliveredAt: orders.deliveredAt })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      .for("update")
      .limit(1);
    if (!o || o.courierId !== courierId) throw new Error("Заказ не найден или не назначен на вас");
    if (o.deliveryStatus !== "delivered" || !o.deliveredAt) {
      throw badRequest("Подтверждение прикладывают к доставленному заказу");
    }
    if (now - new Date(o.deliveredAt).getTime() > PROOF_WINDOW_DAYS * 86_400_000) {
      throw badRequest(`Подтверждение принимается в течение ${PROOF_WINDOW_DAYS} дней после доставки`);
    }

    const [ev] = await tx.select({
      id: deliveryEvents.id, photos: deliveryEvents.photos, signature: deliveryEvents.signature, recipientName: deliveryEvents.recipientName,
    }).from(deliveryEvents)
      .where(and(
        eq(deliveryEvents.tenantId, tenantId), eq(deliveryEvents.orderId, o.id),
        eq(deliveryEvents.kind, "delivered"), eq(deliveryEvents.courierId, courierId),
      ))
      .orderBy(desc(deliveryEvents.id))
      .limit(1);

    if (!ev) {
      // Доставлен до появления журнала: строки вручения нет — она пишется
      // сейчас, со временем доставки с заказа.
      await tx.insert(deliveryEvents).values({
        tenantId, orderId: o.id, courierId, kind: "delivered", recordedAt: new Date(o.deliveredAt),
        photos: input.photo ? [input.photo] : null,
        signature: input.signature ?? null,
        recipientName: recipientName || null,
      });
      logger.info("delivery proof saved", { orderId: o.id, courierId, created: true });
      return { success: true, photoCount: input.photo ? 1 : 0, hasSignature: !!input.signature, recipientName: recipientName || null };
    }

    const photos = Array.isArray(ev.photos) ? [...ev.photos] : [];
    const patch: Partial<{ photos: string[]; signature: Signature; recipientName: string }> = {};
    if (input.photo && !photos.includes(input.photo)) {
      if (photos.length >= PROOF_MAX_PHOTOS) throw badRequest(`Фото подтверждения — не больше ${PROOF_MAX_PHOTOS}`);
      photos.push(input.photo);
      patch.photos = photos;
    }
    if (input.signature && !ev.signature) patch.signature = input.signature;
    if (recipientName && !ev.recipientName) patch.recipientName = recipientName;

    const result = {
      success: true,
      photoCount: photos.length,
      hasSignature: !!(ev.signature ?? patch.signature),
      recipientName: ev.recipientName ?? patch.recipientName ?? null,
    };
    // Повтор из очереди или попытка переписать записанное — ничего не меняем.
    if (Object.keys(patch).length === 0) return { ...result, duplicate: true };

    await tx.update(deliveryEvents).set(patch)
      .where(and(eq(deliveryEvents.id, ev.id), eq(deliveryEvents.tenantId, tenantId)));
    logger.info("delivery proof saved", { orderId: o.id, courierId, fields: Object.keys(patch) });
    return result;
  });
}
