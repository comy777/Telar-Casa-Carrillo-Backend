import { Logger } from '@nestjs/common';
import {
  detectImageType,
  type ImageStorage,
  MAX_IMAGE_BYTES,
  type StoredImage,
} from '../../../shared/application/image-storage';
import { BusinessRuleViolation } from '../../../shared/domain/errors';

const logger = new Logger('CatalogMedia');

/** Valida el archivo por su contenido y lo sube. */
export async function uploadImage(
  storage: ImageStorage,
  data: Buffer,
  folder: string,
): Promise<StoredImage> {
  if (data.length === 0) {
    throw new BusinessRuleViolation('El archivo está vacío', 'IMAGE_EMPTY');
  }
  if (data.length > MAX_IMAGE_BYTES) {
    throw new BusinessRuleViolation('La imagen supera el tamaño máximo', 'IMAGE_TOO_LARGE', {
      maxBytes: MAX_IMAGE_BYTES,
    });
  }
  const contentType = detectImageType(data);
  if (!contentType) {
    throw new BusinessRuleViolation(
      'Formato no admitido: usa JPEG, PNG o WebP',
      'UNSUPPORTED_IMAGE_TYPE',
    );
  }
  return storage.upload({ data, contentType, folder });
}

/**
 * Borra un archivo que ya no se usa. Si falla, solo queda un archivo huérfano:
 * se registra y no se interrumpe la operación del usuario.
 */
export async function deleteImageQuietly(
  storage: ImageStorage,
  key: string | null | undefined,
): Promise<void> {
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (error) {
    logger.warn(`No se pudo borrar la imagen ${key}: ${String(error)}`);
  }
}

/**
 * Sube la imagen, ejecuta `persist` y, si este falla, borra lo subido para no
 * dejar archivos huérfanos. Devuelve lo que devuelva `persist`.
 */
export async function withUploadedImage<T>(
  storage: ImageStorage,
  data: Buffer,
  folder: string,
  persist: (image: StoredImage) => Promise<T>,
): Promise<T> {
  const image = await uploadImage(storage, data, folder);
  try {
    return await persist(image);
  } catch (error) {
    await deleteImageQuietly(storage, image.key);
    throw error;
  }
}
