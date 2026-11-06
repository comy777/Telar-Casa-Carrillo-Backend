/**
 * Datos de DEMOSTRACIÓN para desarrollar y probar el storefront y el admin.
 *   npm run db:seed:demo
 *
 * - Se niega a correr con NODE_ENV=production.
 * - Todo lo que crea lleva "[DEMO]" o el slug "demo-": se identifica y se borra fácil
 *   (npm run db:seed:demo -- --reset).
 * - No inventa personas reales: el artesano es "Artesano de ejemplo".
 * - Las imágenes son láminas de color plano (el color de la lana), no fotos.
 */
import './load-env';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed-demo no se ejecuta en producción');
}

const prisma = new PrismaClient();
const MEDIA_DIR = resolve(process.env.MEDIA_LOCAL_DIR ?? 'uploads');
const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

/* ---------- PNG de color plano (sin dependencias) ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Lámina con el doblez de la prenda arriba (franja más oscura), como en el diseño. */
function woolPng(hex: string, width = 600, height = 750, stripe?: string): Buffer {
  const rgb = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const base = rgb(hex);
  const alt = stripe ? rgb(stripe) : base;
  const fold = base.map((v) => Math.round(v * 0.86)) as [number, number, number];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const color = y < 18 ? fold : stripe && Math.floor(y / 28) % 2 === 1 ? alt : base;
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = color[0];
      raw[p + 1] = color[1];
      raw[p + 2] = color[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function saveImage(
  folder: string,
  hex: string,
  stripe?: string,
): Promise<{ url: string; key: string }> {
  const key = `${folder}/${crypto.randomUUID()}.png`;
  await mkdir(join(MEDIA_DIR, folder), { recursive: true });
  await writeFile(join(MEDIA_DIR, key), woolPng(hex, 600, 750, stripe));
  return { url: `${API_URL}/media/${key}`, key };
}

/* ---------- Datos ---------- */

const CATEGORIES = [
  {
    slug: 'demo-ruanas',
    name: 'Ruanas',
    description: '[DEMO] Ruanas tejidas en telar.',
    color: '#a39e95',
  },
  {
    slug: 'demo-prendas',
    name: 'Prendas',
    description: '[DEMO] Chales, ponchos y bufandas.',
    color: '#8a7560',
  },
  {
    slug: 'demo-hamacas',
    name: 'Hamacas',
    description: '[DEMO] Hamacas sencillas y dobles.',
    color: '#5b4232',
  },
];

interface DemoProduct {
  slug: string;
  name: string;
  category: string;
  price: number;
  compareAt?: number;
  stock: number;
  color: string;
  stripe?: string;
  featured?: boolean;
  materials: string[];
  techniques: string[];
  variants?: Array<{ name: string; color: string; stock: number }>;
}

const PRODUCTS: DemoProduct[] = [
  {
    slug: 'demo-ruana-gris-oveja',
    name: 'Ruana de lana gris oveja',
    category: 'demo-ruanas',
    price: 289000,
    stock: 3,
    color: '#a39e95',
    featured: true,
    materials: ['Lana virgen'],
    techniques: ['Telar de pedal', 'Flecos anudados a mano'],
    variants: [
      { name: 'Gris oveja', color: '#a39e95', stock: 3 },
      { name: 'Nogal', color: '#5b4232', stock: 5 },
      { name: 'Negro natural', color: '#262220', stock: 0 },
    ],
  },
  {
    slug: 'demo-ruana-nogal',
    name: 'Ruana teñida con nogal',
    category: 'demo-ruanas',
    price: 319000,
    compareAt: 349000,
    stock: 8,
    color: '#5b4232',
    featured: true,
    materials: ['Lana virgen', 'Tinte de nogal'],
    techniques: ['Telar de pedal', 'Teñido natural'],
  },
  {
    slug: 'demo-ruana-negro-natural',
    name: 'Ruana de lana negra natural',
    category: 'demo-ruanas',
    price: 299000,
    stock: 12,
    color: '#262220',
    materials: ['Lana virgen'],
    techniques: ['Telar de pedal'],
  },
  {
    slug: 'demo-ruana-crudo',
    name: 'Ruana color crudo con flecos largos',
    category: 'demo-ruanas',
    price: 305000,
    stock: 4,
    color: '#d9d2c3',
    materials: ['Lana virgen'],
    techniques: ['Telar de pedal', 'Flecos anudados a mano'],
  },
  {
    slug: 'demo-chal-pardo',
    name: 'Chal de lana parda',
    category: 'demo-prendas',
    price: 168000,
    stock: 5,
    color: '#8a7560',
    materials: ['Lana virgen'],
    techniques: ['Telar de pedal'],
  },
  {
    slug: 'demo-poncho-gris-claro',
    name: 'Poncho corto gris claro',
    category: 'demo-prendas',
    price: 214000,
    compareAt: 239000,
    stock: 6,
    color: '#c4c0b8',
    materials: ['Lana virgen'],
    techniques: ['Telar de pedal'],
  },
  {
    slug: 'demo-hamaca-doble-crudo',
    name: 'Hamaca doble en algodón crudo',
    category: 'demo-hamacas',
    price: 420000,
    stock: 2,
    color: '#d9d2c3',
    stripe: '#1e5a3c',
    featured: true,
    materials: ['Algodón'],
    techniques: ['Telar vertical'],
  },
  {
    slug: 'demo-hamaca-sencilla-nogal',
    name: 'Hamaca sencilla nogal y crudo',
    category: 'demo-hamacas',
    price: 310000,
    stock: 0,
    color: '#5b4232',
    stripe: '#d9d2c3',
    materials: ['Algodón'],
    techniques: ['Telar vertical'],
  },
];

async function reset(): Promise<void> {
  const demo = await prisma.product.findMany({
    where: { slug: { startsWith: 'demo-' } },
    select: { id: true },
  });
  const ids = demo.map((p) => p.id);
  await prisma.inventory.deleteMany({ where: { variant: { productId: { in: ids } } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'demo-' } } });
  await prisma.artisan.deleteMany({ where: { slug: { startsWith: 'demo-' } } });
  await prisma.shippingMethod.deleteMany({ where: { name: { startsWith: '[DEMO]' } } });
  console.log(`Borrados ${ids.length} productos de demostración.`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) {
    await reset();
    return;
  }
  if (await prisma.product.count({ where: { slug: { startsWith: 'demo-' } } })) {
    console.log('Ya hay datos de demostración. Usa --reset para borrarlos primero.');
    return;
  }

  const categoryIds = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const img = await saveImage('categories', c.color);
    const row = await prisma.category.create({
      data: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: i,
        imageUrl: img.url,
        imageKey: img.key,
      },
    });
    categoryIds.set(c.slug, row.id);
  }

  const photo = await saveImage('artisans', '#143f2a');
  const artisan = await prisma.artisan.create({
    data: {
      slug: 'demo-artesano',
      name: 'Artesano de ejemplo',
      biography: '[DEMO] Aquí va la biografía real de quien teje, cargada desde el panel.',
      story: '[DEMO] Aquí va su historia: cómo aprendió, desde cuándo teje y qué piezas hace.',
      photoUrl: photo.url,
      photoKey: photo.key,
      isFeatured: true,
    },
  });

  for (const [i, p] of PRODUCTS.entries()) {
    const variants = p.variants ?? [{ name: 'Única', color: p.color, stock: p.stock }];
    const product = await prisma.product.create({
      data: {
        slug: p.slug,
        sku: `DEMO-${String(i + 1).padStart(3, '0')}`,
        name: p.name,
        shortDescription: '[DEMO] Pieza de ejemplo para probar la tienda.',
        description:
          '[DEMO] Descripción de ejemplo. En la tienda real aquí va la descripción de la pieza: medidas, peso, cuidados y lo que la hace única.',
        status: 'ACTIVE',
        isFeatured: p.featured ?? false,
        createdAt: new Date(Date.now() - i * 86_400_000),
        artisan: { connect: { id: artisan.id } },
        categories: { create: [{ categoryId: categoryIds.get(p.category)! }] },
        materials: {
          create: await Promise.all(
            p.materials.map(async (name) => ({
              materialId: (
                await prisma.material.upsert({ where: { name }, create: { name }, update: {} })
              ).id,
            })),
          ),
        },
        techniques: {
          create: await Promise.all(
            p.techniques.map(async (name) => ({
              techniqueId: (
                await prisma.technique.upsert({ where: { name }, create: { name }, update: {} })
              ).id,
            })),
          ),
        },
      },
    });
    for (const [j, v] of variants.entries()) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: v.name,
          sku: `DEMO-${String(i + 1).padStart(3, '0')}-${j + 1}`,
          attributes: variants.length > 1 ? { color: v.name } : {},
          price: new Prisma.Decimal(p.price),
          compareAtPrice: p.compareAt ? new Prisma.Decimal(p.compareAt) : null,
          inventory: { create: { quantityOnHand: v.stock, lowStockThreshold: 3 } },
        },
      });
      const img = await saveImage('products', v.color, p.stripe);
      await prisma.productImage.create({
        data: {
          productId: product.id,
          variantId: variants.length > 1 ? variant.id : null,
          url: img.url,
          publicId: img.key,
          altText: `[DEMO] ${p.name}${variants.length > 1 ? `, ${v.name.toLowerCase()}` : ''}`,
          sortOrder: j,
          isPrimary: j === 0,
        },
      });
    }
  }

  if ((await prisma.shippingMethod.count()) === 0) {
    await prisma.shippingMethod.create({
      data: {
        name: '[DEMO] Envío nacional',
        description: 'Transportadora a todo el país',
        basePrice: new Prisma.Decimal(18000),
        freeShippingThreshold: new Prisma.Decimal(500000),
        estimatedDelivery: '3 a 6 días hábiles',
        sortOrder: 0,
      },
    });
  }

  console.log(
    `Creados ${CATEGORIES.length} categorías, 1 artesano y ${PRODUCTS.length} productos de demostración.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
