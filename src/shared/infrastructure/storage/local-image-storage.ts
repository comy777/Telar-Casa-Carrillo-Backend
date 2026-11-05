import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  IMAGE_EXTENSIONS,
  type ImageStorage,
  type ImageUpload,
  type StoredImage,
} from '../../application/image-storage';

/** Prefijo HTTP con que configure-app.ts sirve la carpeta local. */
export const LOCAL_MEDIA_ROUTE = '/media';

const KEY_PATTERN = /^[a-z][a-z-]*\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const FOLDER_PATTERN = /^[a-z][a-z-]*$/;

/**
 * Guarda las imágenes en disco y las sirve la propia API. Solo para desarrollo:
 * en producción se usa Cloudinary (lo exige la validación del entorno).
 */
export class LocalImageStorage implements ImageStorage {
  private readonly root: string;

  constructor(
    directory: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(directory);
  }

  async upload(image: ImageUpload): Promise<StoredImage> {
    if (!FOLDER_PATTERN.test(image.folder)) throw new Error(`Carpeta inválida: ${image.folder}`);
    const key = `${image.folder}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[image.contentType]}`;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.data);
    return { url: `${this.publicBaseUrl}${LOCAL_MEDIA_ROUTE}/${key}`, key };
  }

  async delete(key: string): Promise<void> {
    // Las claves vienen de la base: igual se validan para no salir de la carpeta.
    if (!KEY_PATTERN.test(key)) return;
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    return join(this.root, ...key.split('/'));
  }
}
