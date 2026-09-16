/**
 * Client-Side Image Downscaling & Compression Utility
 *
 * Ensures all camera captures and dropped files are bounded to a maximum dimension
 * (e.g. 1600px) and JPEG compressed (0.85 quality) before network transmission.
 *
 * Keeps evidence uploads within field-network limits while preserving OCR detail.
 */

export interface CompressionResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  compressionRatio: number;
}

/**
 * Downscale and compress an image File or Blob in the browser.
 */
export async function compressAndDownscaleImage(
  fileOrBlob: Blob | File,
  fileName = "evidence.jpg",
  maxDimension = 1600,
  quality = 0.85,
): Promise<File> {
  const originalBytes = fileOrBlob.size;

  // In non-browser / test environments where Image or Canvas is not available
  if (typeof window === "undefined" || typeof document === "undefined") {
    const targetName = fileName.replace(/\.[^/.]+$/, "") + ".jpg";
    if (fileOrBlob instanceof File) {
      return new File([fileOrBlob], targetName, { type: "image/jpeg", lastModified: fileOrBlob.lastModified });
    }
    return new File([fileOrBlob], targetName, { type: "image/jpeg" });
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const originalWidth = img.naturalWidth || img.width;
      const originalHeight = img.naturalHeight || img.height;

      // Calculate scaled dimensions preserving aspect ratio
      let targetWidth = originalWidth;
      let targetHeight = originalHeight;

      if (originalWidth > maxDimension || originalHeight > maxDimension) {
        if (originalWidth >= originalHeight) {
          targetWidth = maxDimension;
          targetHeight = Math.round((originalHeight / originalWidth) * maxDimension);
        } else {
          targetHeight = maxDimension;
          targetWidth = Math.round((originalWidth / originalHeight) * maxDimension);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        // Fallback to original file
        if (fileOrBlob instanceof File) resolve(fileOrBlob);
        else resolve(new File([fileOrBlob], fileName, { type: "image/jpeg" }));
        return;
      }

      // Smooth downsampling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            if (fileOrBlob instanceof File) resolve(fileOrBlob);
            else resolve(new File([fileOrBlob], fileName, { type: "image/jpeg" }));
            return;
          }

          const compressedFile = new File([blob], fileName.replace(/\.[^/.]+$/, "") + ".jpg", {
            type: "image/jpeg",
            lastModified: Date.now(),
          });

          const ratio = Math.round((1 - compressedFile.size / Math.max(1, originalBytes)) * 100);
          console.log(
            `[ImageCompression] ${fileName}: ${(originalBytes / 1024).toFixed(1)} KB (${originalWidth}x${originalHeight}) -> ${(compressedFile.size / 1024).toFixed(1)} KB (${targetWidth}x${targetHeight}) [-${ratio}%]`,
          );

          resolve(compressedFile);
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (fileOrBlob instanceof File) resolve(fileOrBlob);
      else resolve(new File([fileOrBlob], fileName, { type: "image/jpeg" }));
    };

    img.src = objectUrl;
  });
}
