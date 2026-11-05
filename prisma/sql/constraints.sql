-- Restricciones que Prisma no expresa en schema.prisma.
--
-- Uso: crear la primera migración con
--   npx prisma migrate dev --create-only --name init
-- pegar este archivo al final del migration.sql generado y luego aplicar con
--   npx prisma migrate dev
--
-- Ojo: Prisma no conoce los índices parciales ni el índice de búsqueda de abajo.
-- En cada migración nueva revisa que el SQL generado no incluya DROP INDEX para
-- ellos; si aparece, bórralo del archivo antes de aplicarlo.

-- Inventario
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_on_hand_nonneg" CHECK ("quantityOnHand" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_reserved_nonneg" CHECK ("quantityReserved" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_reserved_le_on_hand" CHECK ("quantityReserved" <= "quantityOnHand");
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_low_stock_nonneg" CHECK ("lowStockThreshold" >= 0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "inventory_movement_qty_pos" CHECK ("quantity" > 0);

-- Reservas: cantidad positiva y, mientras estén activas, ligadas a un carrito o pedido.
ALTER TABLE "StockReservation" ADD CONSTRAINT "reservation_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "StockReservation" ADD CONSTRAINT "reservation_has_owner"
  CHECK ("releasedAt" IS NOT NULL OR "cartId" IS NOT NULL OR "orderId" IS NOT NULL);

-- Carrito
ALTER TABLE "Cart" ADD CONSTRAINT "cart_has_owner" CHECK ("userId" IS NOT NULL OR "guestKey" IS NOT NULL);
ALTER TABLE "CartItem" ADD CONSTRAINT "cart_item_qty_pos" CHECK ("quantity" > 0);

-- Catálogo
ALTER TABLE "ProductVariant" ADD CONSTRAINT "variant_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "variant_compare_at_gt_price"
  CHECK ("compareAtPrice" IS NULL OR "compareAtPrice" > "price");
ALTER TABLE "Product" ADD CONSTRAINT "product_tax_rate_range" CHECK ("taxRate" >= 0 AND "taxRate" <= 1);

-- Cupones
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_value_pos" CHECK ("value" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_percentage_le_100"
  CHECK ("discountType" <> 'PERCENTAGE' OR "value" <= 100);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_usage_count_nonneg" CHECK ("usageCount" >= 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_usage_limit_pos" CHECK ("usageLimit" IS NULL OR "usageLimit" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_per_customer_limit_pos"
  CHECK ("perCustomerLimit" IS NULL OR "perCustomerLimit" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "coupon_dates_order"
  CHECK ("startsAt" IS NULL OR "expiresAt" IS NULL OR "startsAt" < "expiresAt");

-- Pedidos
ALTER TABLE "Order" ADD CONSTRAINT "order_totals_nonneg" CHECK (
  "subtotal" >= 0 AND "discountTotal" >= 0 AND "shippingTotal" >= 0
  AND "taxTotal" >= 0 AND "grandTotal" >= 0
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_amounts_nonneg"
  CHECK ("unitPrice" >= 0 AND "discountTotal" >= 0 AND "lineTotal" >= 0);

-- Pagos
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "refund_amount_pos" CHECK ("amount" > 0);

-- Envíos
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "shipping_method_price_nonneg" CHECK ("basePrice" >= 0);

-- Contenido
ALTER TABLE "Testimonial" ADD CONSTRAINT "testimonial_rating_range"
  CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

-- Únicos parciales
CREATE UNIQUE INDEX "address_one_default_per_user" ON "Address" ("userId") WHERE "isDefault";
CREATE UNIQUE INDEX "product_image_one_primary" ON "ProductImage" ("productId") WHERE "isPrimary";

-- Búsqueda de texto en español sobre el catálogo
CREATE INDEX "product_search_idx" ON "Product" USING GIN (
  to_tsvector('spanish', coalesce("name", '') || ' ' || coalesce("description", ''))
);
