import { useRef } from "react";
import { Camera, Loader2, Package } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { useAuth } from "@/hooks/useAuth";
import { canOperate } from "@/lib/permissions";
import { useTranslate } from "@/i18n";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { ShopAvatar } from "@/components/shops/ShopAvatar";
import { productInitials } from "@/lib/shop-avatar";

export interface ProductPhotoProps {
  productId: number;
  productName?: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}

/**
 * Фото товара. Меняет его тот, кто ведёт каталог.
 *
 * product.uploadPhoto — operatorQuery, а карточка стоит в общем списке
 * товаров, куда ходят и агент с мерчендайзером: они выбирали файл, ждали
 * сжатие и получали отказ.
 *
 * Плашка та же, что у магазина (ShopPhoto): 96 точек в списке, скругление
 * в четверть стороны, подъём тенью, а не обводкой — обводка в один пиксель
 * на тёмной теме читалась светлой полосой, и весь каталог выглядел чужим
 * рядом с магазинами.
 */
export function ProductPhoto({ productId, productName = "", photoUrl, size = "md" }: ProductPhotoProps) {
  const t = useTranslate();
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const upload = trpc.product.uploadPhoto.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); utils.product.getById.invalidate({ id: productId }); notify.success(t("Фото обновлено", "Rasm yangilandi")); },
    onError: (e) => notify.error(e.message),
  });
  const px = size === "sm" ? 52 : size === "lg" ? 96 : 72;
  const radius = `${Math.round(px * 0.28)}px`;
  const iconSize = Math.round(px * 0.34);
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { notify.error(t("Макс. 10 МБ", "Maks. 10 MB")); return; }
    try {
      const compressed = await compressImage(file);
      upload.mutate({ productId, dataUrl: compressed });
    } catch { notify.error(t("Ошибка обработки изображения", "Rasmni qayta ishlashda xatolik")); }
    e.target.value = "";
  };
  return (
    <div className="relative group" onClick={e => e.stopPropagation()}>
      <div
        className={`overflow-hidden flex items-center justify-center flex-shrink-0 ${canEdit ? "cursor-pointer" : ""}`}
        style={{ width: `${px}px`, height: `${px}px`, borderRadius: radius, boxShadow: "var(--shadow-sm)", background: "var(--color-surface-light)" }}
        onClick={canEdit ? () => fileRef.current?.click() : undefined}
      >
        {upload.isPending
          ? <Loader2 size={iconSize} className="animate-spin" style={{ color: "var(--color-primary-text)" }} />
          : <PhotoOrIcon
              src={photoUrl}
              className="w-full h-full object-cover"
              fallback={<ShopAvatar id={productId} name={productName} size={px} icon={Package} initials={productInitials(productName)} />}
            />}
        {canEdit && (
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            style={{ borderRadius: radius, background: "rgba(0,0,0,0.34)" }}
          >
            <Camera size={iconSize} color="#fff" />
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
    </div>
  );
}
