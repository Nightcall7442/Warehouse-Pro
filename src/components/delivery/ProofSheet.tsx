import { useId, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { compressImage } from "@/lib/compress-image";
import { freshPlace } from "@/lib/last-fix";
import { PROOF_MAX_PHOTOS, PROOF_PHOTO_MAX_CHARS, type Signature } from "@contracts/delivery-proof";
import { DeliverySheet } from "./DeliverySheet";
import { SignaturePad } from "./SignaturePad";

/*
  Подтверждение вручения — сразу после «Доставлено».

  «Доставлено» уже проведено (склад, деньги), и это окно его не держит:
  можно закрыть и уехать. Но если магазин через неделю скажет «не
  привозили», у офиса будет снимок товара у прилавка, подпись и имя того,
  кто принял.

  Каждый снимок — отдельным запросом (courier.saveProof): тело запроса
  остаётся небольшим и на слабой связи уходит целиком. Первый запрос несёт
  подпись и имя, следующие — по одному снимку. Повтор безопасен: сервер не
  добавит тот же снимок дважды и не перепишет записанную подпись.
*/

/** Снимок сжимается с запасом под предел ручки — base64 длиннее байтов на треть. */
const PHOTO_LIMITS = { maxDimension: 1280, maxChars: Math.floor(PROOF_PHOTO_MAX_CHARS * 0.6) };

export interface ProofTarget { orderId: number; orderNumber?: string | null; shopName?: string | null }

export function ProofSheet({ target, onClose }: { target: ProofTarget; onClose: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const saveProof = trpc.courier.saveProof.useMutation();

  const hasSomething = photos.length > 0 || signature !== null || recipient.trim().length > 0;

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    try {
      const data = await compressImage(file, PHOTO_LIMITS);
      setPhotos(prev => (prev.length >= PROOF_MAX_PHOTOS || prev.includes(data) ? prev : [...prev, data]));
    } catch {
      notify.error(t("Фото не открылось — снимите ещё раз", "Rasm ochilmadi — qayta suratga oling"));
    } finally {
      setCompressing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!hasSomething || busy) return;
    setBusy(true);
    try {
      const name = recipient.trim();
      const [first, ...rest] = photos;
      await saveProof.mutateAsync({
        orderId: target.orderId,
        ...(first ? { photo: first } : {}),
        ...(signature ? { signature } : {}),
        ...(name ? { recipientName: name } : {}),
        // Точка — ляжет, только если у отметки «Доставлено» своей нет.
        ...freshPlace(),
      });
      for (const photo of rest) await saveProof.mutateAsync({ orderId: target.orderId, photo });
      notify.success(t("Подтверждение сохранено", "Tasdiq saqlandi"));
      onClose();
    } catch (e) {
      notify.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DeliverySheet
      title={t("Подтверждение вручения", "Topshirilganini tasdiqlash")}
      subtitle={[target.orderNumber, target.shopName].filter(Boolean).join(" · ")}
      dirty={hasSomething}
      onClose={onClose}
      testId="proof-sheet"
      footer={<>
        <button type="button" onClick={onClose} className="neo-btn tap flex items-center justify-center"
          style={{ minHeight: 48, padding: "0 16px" }} data-testid="proof-skip">
          {t("Пропустить", "O'tkazib yuborish")}
        </button>
        <button type="button" onClick={save} disabled={!hasSomething || busy || compressing} aria-disabled={!hasSomething || busy}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ minHeight: 48, minWidth: 160 }} data-testid="proof-save">
          <Check size={16} />{busy ? t("Отправка...", "Yuborilmoqda...") : t("Сохранить", "Saqlash")}
        </button>
      </>}
    >
      <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "0 0 12px" }}>
        {t("Доставка отмечена. Снимок товара у магазина и подпись принявшего защитят, если магазин скажет «не привозили».",
           "Yetkazish belgilandi. Do'kondagi tovar surati va qabul qilganning imzosi, do'kon «olib kelinmadi» desa, himoya qiladi.")}
      </p>

      <span className="font-label text-[10px] text-secondary mb-1.5 block">{t(`Фото (до ${PROOF_MAX_PHOTOS})`, `Rasm (${PROOF_MAX_PHOTOS} tagacha)`)}</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <span key={i} className="relative">
            <img src={p} alt={t(`Фото ${i + 1}`, `Rasm ${i + 1}`)} className="rounded-xl object-cover" style={{ width: 72, height: 72 }} />
            <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
              aria-label={t("Убрать фото", "Rasmni olib tashlash")}
              className="neo-btn-icon absolute" style={{ top: -6, right: -6, width: 26, height: 26, borderRadius: 13 }}>
              <X size={12} />
            </button>
          </span>
        ))}
        {photos.length < PROOF_MAX_PHOTOS && (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={compressing}
            className="neo-btn tap flex flex-col items-center justify-center gap-1" style={{ width: 72, height: 72, borderRadius: 12, fontSize: 11 }}
            data-testid="proof-add-photo">
            <Camera size={18} />{compressing ? "…" : t("Снять", "Suratga")}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => void addPhoto(e.target.files?.[0])} data-testid="proof-photo-input" />
      </div>

      <span className="font-label text-[10px] text-secondary mt-4 mb-1.5 block">{t("Подпись получателя", "Qabul qiluvchining imzosi")}</span>
      <SignaturePad onChange={setSignature} />

      <label htmlFor={`${id}-recipient`} className="font-label text-[10px] text-secondary mt-4 mb-1.5 block">{t("Кто принял", "Kim qabul qildi")}</label>
      <input id={`${id}-recipient`} value={recipient} onChange={e => setRecipient(e.target.value)} maxLength={120}
        placeholder={t("Имя продавца или хозяина", "Sotuvchi yoki egasining ismi")} className="neo-input w-full" data-testid="proof-recipient" />
    </DeliverySheet>
  );
}
