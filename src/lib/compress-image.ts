import {
  LOGO_MAX_CHARS, FAVICON_MAX_CHARS,
  LOGO_MAX_DIMENSION, FAVICON_MAX_DIMENSION,
} from "@contracts/image-limits";

/**
 * Client-side image compression using Canvas API.
 * Resizes and compresses images before upload to reduce storage size.
 */

const MAX_DIMENSION = 800; // max width or height in pixels
const JPEG_QUALITY = 0.8;  // 80% quality — good balance of size vs quality
const MAX_FILE_SIZE = 500 * 1024; // 500KB target max after compression

/**
 * Насколько ужать.
 *
 * Умолчания — для фотографий товара. Брендинг просит другое: логотип и
 * значок вкладки лежат в столбце типа TEXT (65 535 байт) и приезжают с
 * КАЖДОЙ загрузкой приложения, поэтому их сжимают заметно сильнее.
 */
export interface CompressOptions {
  /** Наибольшая сторона в точках. */
  maxDimension?: number;
  /** Предел длины строки data:… — именно она уходит в базу. */
  maxChars?: number;
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<string> {
  const maxDimension = opts.maxDimension ?? MAX_DIMENSION;
  const maxChars     = opts.maxChars ?? Math.round(MAX_FILE_SIZE * 1.37);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, width, height);

      // Try JPEG first (smaller), fall back to PNG for transparency
      let quality = JPEG_QUALITY;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);

      // If still too large, reduce quality progressively
      while (dataUrl.length > maxChars && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }

      /*
        Качества не всегда хватает. Логотипу отведено 60 000 знаков — это
        предел столбца, а не пожелание: строка длиннее просто не запишется, и
        сервер отклонит запрос целиком. Поэтому, если на самом низком качестве
        строка всё ещё длинна, уменьшаем сам холст — по половине за шаг, но не
        мельче 48 точек, иначе от знака ничего не останется.
      */
      while (dataUrl.length > maxChars && Math.max(width, height) > 48) {
        width  = Math.max(1, Math.round(width / 2));
        height = Math.max(1, Math.round(height / 2));
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }

      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}


/*
  Пределы для логотипа и значка вкладки.

  Сами числа лежат в contracts/image-limits.ts — их обязаны знать обе стороны:
  клиент, чтобы сжать под них, и сервер, чтобы отклонить длинную строку
  словами. Здесь они лишь одеты в форму, которую принимает compressImage.

  Пока предел знал только раздел «Брендинг», вкладка «Компания» звала это же
  сжатие общей меркой — до семисот тысяч знаков — и клала результат в такой же
  по устройству столбец TEXT. MySQL отклонял запрос целиком, и вместе с
  логотипом не сохранялись реквизиты организации.
*/
export const LOGO_LIMITS: CompressOptions = {
  maxDimension: LOGO_MAX_DIMENSION,
  maxChars:     LOGO_MAX_CHARS,
};

export const FAVICON_LIMITS: CompressOptions = {
  maxDimension: FAVICON_MAX_DIMENSION,
  maxChars:     FAVICON_MAX_CHARS,
};
