import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectImageType } from '../../application/image-storage';
import { CloudinaryImageStorage, signCloudinaryParams } from './cloudinary-image-storage';
import { LocalImageStorage } from './local-image-storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

describe('detectImageType', () => {
  it.each([
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [WEBP, 'image/webp'],
  ])('reconoce el tipo por el contenido', (data, type) => {
    expect(detectImageType(data)).toBe(type);
  });

  it.each([
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('GIF89a'),
    Buffer.alloc(0),
  ])('rechaza otros formatos', (data) => {
    expect(detectImageType(data)).toBeNull();
  });
});

describe('signCloudinaryParams', () => {
  it('firma los parámetros ordenados seguidos del secreto (ejemplo de la documentación)', () => {
    // https://cloudinary.com/documentation/authentication_signatures
    const signature = signCloudinaryParams(
      {
        timestamp: '1315060510',
        public_id: 'sample_image',
        eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
      },
      'abcd',
    );
    expect(signature).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});

describe('CloudinaryImageStorage', () => {
  const config = {
    cloudName: 'telar',
    apiKey: 'key',
    apiSecret: 'secret',
    rootFolder: 'telar-casa-carrillo',
  };
  const fixedNow = () => new Date('2026-11-05T00:00:00Z');

  const respond = (body: unknown, status = 200) =>
    jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('sube con firma y devuelve secure_url y public_id', async () => {
    const http = respond({ secure_url: 'https://res.cloudinary.com/x.png', public_id: 'p/1' });
    const storage = new CloudinaryImageStorage(config, http, fixedNow);

    const stored = await storage.upload({
      data: PNG,
      contentType: 'image/png',
      folder: 'products',
    });

    expect(stored).toEqual({ url: 'https://res.cloudinary.com/x.png', key: 'p/1' });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.cloudinary.com/v1_1/telar/image/upload');
    const form = init?.body as FormData;
    expect(form.get('folder')).toBe('telar-casa-carrillo/products');
    expect(form.get('timestamp')).toBe('1793836800');
    expect(form.get('signature')).toBe(
      signCloudinaryParams(
        { folder: 'telar-casa-carrillo/products', timestamp: '1793836800' },
        'secret',
      ),
    );
  });

  it('informa los errores de Cloudinary', async () => {
    const storage = new CloudinaryImageStorage(
      config,
      respond({ error: { message: 'Invalid Signature' } }, 401),
      fixedNow,
    );
    await expect(
      storage.upload({ data: PNG, contentType: 'image/png', folder: 'products' }),
    ).rejects.toThrow(/401.*Invalid Signature/);
  });

  it('borrar una imagen que no existe no es un error', async () => {
    const storage = new CloudinaryImageStorage(config, respond({ result: 'not found' }), fixedNow);
    await expect(storage.delete('p/1')).resolves.toBeUndefined();
  });
});

describe('LocalImageStorage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'telar-media-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('guarda, publica la URL y borra el archivo', async () => {
    const storage = new LocalImageStorage(dir, 'http://localhost:3001');
    const stored = await storage.upload({
      data: PNG,
      contentType: 'image/png',
      folder: 'products',
    });

    expect(stored.url).toBe(`http://localhost:3001/media/${stored.key}`);
    expect(stored.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(await readFile(join(dir, stored.key))).toEqual(PNG);

    await storage.delete(stored.key);
    await expect(stat(join(dir, stored.key))).rejects.toThrow();
  });

  it('ignora claves que intentan salir de la carpeta', async () => {
    const storage = new LocalImageStorage(dir, 'http://localhost:3001');
    await expect(storage.delete('../../etc/passwd')).resolves.toBeUndefined();
  });
});
