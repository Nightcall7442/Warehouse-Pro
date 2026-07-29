/**
 * Client-side image compression using Canvas API.
 * Resizes and compresses images before upload to reduce storage size.
 */

const MAX_DIMENSION = 800; // max width or height in pixels
const JPEG_QUALITY = 0.8;  // 80% quality — good balance of size vs quality
const MAX_FILE_SIZE = 500 * 1024; // 500KB target max after compression

export async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions maintaining aspect ratio
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
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
      while (dataUrl.length > MAX_FILE_SIZE * 1.37 && quality > 0.3) {
        quality -= 0.1;
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
