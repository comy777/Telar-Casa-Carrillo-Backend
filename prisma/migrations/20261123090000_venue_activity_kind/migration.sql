-- Tipo de actividad: los juegos se alquilan por horas y la comida se pide con su casilla.
CREATE TYPE "VenueActivityKind" AS ENUM ('GAME', 'FOOD', 'OTHER');

ALTER TABLE "VenueActivity" ADD COLUMN "kind" "VenueActivityKind" NOT NULL DEFAULT 'OTHER';

-- Clasifica las actividades que ya existen por su nombre; el panel puede cambiarlo después.
UPDATE "VenueActivity" SET "kind" = 'FOOD'
  WHERE lower("name") ~ '(comida|almuerzo|restaurante|cocina|asado)';
UPDATE "VenueActivity" SET "kind" = 'GAME'
  WHERE "kind" = 'OTHER'
    AND lower("name") ~ '(banquita|ping|pong|tenis de mesa|vole|f[uú]tbol|cancha|tejo|billar|minitejo)';
