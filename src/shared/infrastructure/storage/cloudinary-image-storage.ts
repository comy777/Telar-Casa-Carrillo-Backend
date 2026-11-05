import { createHash } from 'node:crypto';
import type { ImageStorage, ImageUpload, StoredImage } from '../../application/image-storage';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Carpeta raíz en la cuenta, p. ej. "telar-casa-carrillo". */
  rootFolder: string;
}

type Fetch = typeof fetch;

/**
 * Firma de Cloudinary: parámetros ordenados alfabéticamente como "k=v&k=v",
 * seguidos del secreto, en SHA-1. No se firman file, api_key ni resource_type.
 * https://cloudinary.com/documentation/authentication_signatures
 */
export function signCloudinaryParams(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

/** Subida firmada por la API REST de Cloudinary (sin SDK). */
export class CloudinaryImageStorage implements ImageStorage {
  private readonly baseUrl: string;

  constructor(
    private readonly config: CloudinaryConfig,
    private readonly http: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.baseUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image`;
  }

  async upload(image: ImageUpload): Promise<StoredImage> {
    const params = {
      folder: `${this.config.rootFolder}/${image.folder}`,
      timestamp: this.timestamp(),
    };
    const form = this.signedForm(params);
    form.append('file', new Blob([image.data], { type: image.contentType }));

    const body = await this.post('upload', form);
    const url = body['secure_url'];
    const key = body['public_id'];
    if (typeof url !== 'string' || typeof key !== 'string') {
      throw new Error('Cloudinary no devolvió secure_url y public_id');
    }
    return { url, key };
  }

  async delete(key: string): Promise<void> {
    const form = this.signedForm({
      invalidate: 'true',
      public_id: key,
      timestamp: this.timestamp(),
    });
    const body = await this.post('destroy', form);
    // "not found" también vale: el objetivo (que no exista) se cumple.
    if (body['result'] !== 'ok' && body['result'] !== 'not found') {
      throw new Error(`Cloudinary no borró la imagen ${key}: ${JSON.stringify(body['result'])}`);
    }
  }

  private timestamp(): string {
    return String(Math.floor(this.now().getTime() / 1000));
  }

  private signedForm(params: Record<string, string>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    form.append('api_key', this.config.apiKey);
    form.append('signature', signCloudinaryParams(params, this.config.apiSecret));
    return form;
  }

  private async post(
    action: 'upload' | 'destroy',
    form: FormData,
  ): Promise<Record<string, unknown>> {
    const response = await this.http(`${this.baseUrl}/${action}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = body['error'] as { message?: unknown } | undefined;
      throw new Error(
        `Cloudinary respondió ${response.status} en ${action}: ${typeof error?.message === 'string' ? error.message : ''}`,
      );
    }
    return body;
  }
}
