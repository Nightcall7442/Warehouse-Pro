import { useRef } from "react";
import { Package, Camera, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { useAuth } from "@/hooks/useAuth";
import { canOperate } from "@/lib/permissions";
import { useTranslate } from "@/i18n";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";

export interface ProductPhotoProps {
  productId: number;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}

/**
 * Фото товара. Меняет его тот, кто ведёт каталог.
 *
 * product.uploadPhoto — operatorQuery, а карточка стоит в общем списке
 * товаров, куда ходят и агент с мерчендайзером: они выбирали файл, ждали
 * сжатие и получали отказ.
 */
export function ProductPhoto({ productId, photoUrl, size = "md" }: ProductPhotoProps) {
  const t = useTranslate();
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const upload = trpc.product.uploadPhoto.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); utils.product.getById.invalidate({ id: productId }); notify.success(t("Фото обновлено", "Rasm yangilandi")); },
    onError: (e) => notify.error(e.message),
  });
  const dim = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
  const iconSize = size === "sm" ? 18 : size === "lg" ? 32 : 22;
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
      <div className={`${dim} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 border border-border-subtle ${canEdit ? "cursor-pointer" : ""}`}
        style={{ background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}
        onClick={canEdit ? () => fileRef.current?.click() : undefined}>
        {upload.isPending ? <Loader2 size={iconSize} className="text-primary animate-spin" />
          : <PhotoOrIcon src={photoUrl} className="w-full h-full object-cover"
              fallback={<Package size={iconSize} className="text-primary" />} />}
        {canEdit && (
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
          <Camera size={iconSize - 4} color="#fff" />
        </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
    </div>
  );
}
