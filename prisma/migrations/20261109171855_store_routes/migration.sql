-- CreateEnum
CREATE TYPE "FooterGroup" AS ENUM ('SHOP', 'HELP', 'INFO');

-- CreateTable
CREATE TABLE "StoreRoute" (
    "key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "showInHeader" BOOLEAN NOT NULL DEFAULT false,
    "footerGroup" "FooterGroup",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreRoute_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreRoute_path_key" ON "StoreRoute"("path");

-- Rutas actuales del storefront. ON CONFLICT: no pisa lo que el panel ya haya cambiado.
INSERT INTO "StoreRoute" ("key", "path", "label", "description", "isEnabled", "isLocked", "showInHeader", "footerGroup", "sortOrder", "updatedAt") VALUES
  ('inicio',               '/',                     'Inicio',               'Portada de la tienda',                                         true, true,  false, NULL,   0,   CURRENT_TIMESTAMP),
  ('catalogo',             '/productos',            'Catálogo',             'Listado y ficha de productos (/productos/...)',                true, false, false, NULL,   10,  CURRENT_TIMESTAMP),
  ('categorias',           '/categorias',           'Categorías',           'En el menú y el pie se muestra como la lista de categorías',   true, false, true,  'SHOP', 20,  CURRENT_TIMESTAMP),
  ('artesanos',            '/artesanos',            'La familia',           'Artesanos y su historia',                                      true, false, true,  'SHOP', 30,  CURRENT_TIMESTAMP),
  ('carrito',              '/carrito',              'Carrito',              'Página y botón del carrito',                                   true, false, false, NULL,   40,  CURRENT_TIMESTAMP),
  ('checkout',             '/checkout',             'Finalizar compra',     'Pago del carrito',                                             true, false, false, NULL,   50,  CURRENT_TIMESTAMP),
  ('pedido',               '/pedido',               'Pedido de invitado',   'Seguimiento y pago de pedidos sin cuenta',                     true, false, false, NULL,   60,  CURRENT_TIMESTAMP),
  ('cuenta',               '/cuenta',               'Mi cuenta',            'Ingreso, registro y área del cliente (incluye sus subrutas)',  true, false, false, NULL,   70,  CURRENT_TIMESTAMP),
  ('cuenta-pedidos',       '/cuenta/pedidos',       'Seguir mi pedido',     'Pedidos del cliente',                                          true, false, false, 'HELP', 80,  CURRENT_TIMESTAMP),
  ('preguntas-frecuentes', '/preguntas-frecuentes', 'Preguntas frecuentes', NULL,                                                           true, false, false, 'HELP', 90,  CURRENT_TIMESTAMP),
  ('contacto',             '/contacto',             'Contacto',             'Formulario de contacto',                                       true, false, false, 'HELP', 100, CURRENT_TIMESTAMP),
  ('boletin',              '/boletin',              'Boletín',              'Confirmar o cancelar la suscripción al boletín',               true, false, false, NULL,   110, CURRENT_TIMESTAMP),
  ('paginas',              '/:pagina',              'Información',          'Páginas del panel (políticas legales); en el pie se muestra como su lista', true, true, false, 'INFO', 120, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
