export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageUpload {
  data: Buffer;
  contentType: ImageContentType;
  /** Carpeta lógica, p. ej. "products", "artisans", "categories". */
  folder: string;
}

export interface StoredImage {
  /** URL pública (HTTPS en producción). */
  url: string;
  /** Identificador para borrar el archivo después. */
  key: string;
}

/** Almacenamiento externo de imágenes (Cloudinary en producción, disco en desarrollo). */
export interface ImageStorage {
  upload(image: ImageUpload): Promise<StoredImage>;
  /** Idempotente: borrar una clave que no existe no falla. */
  delete(key: string): Promise<void>;
}

export const IMAGE_STORAGE = Symbol('ImageStorage');

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Tipo real del archivo según sus primeros bytes. No se confía en el
 * Content-Type ni en la extensión que manda el navegador.
 */
export function detectImageType(data: Buffer): ImageContentType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((byte, i) => data[i] === byte)) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const IMAGE_EXTENSIONS: Record<ImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
