import { assertShipmentTransition } from '../../fulfillment/domain/shipment';
import { toCsv, toRange } from './reports.service';

describe('toCsv', () => {
  it('escapa comillas, separadores y saltos de línea, con BOM para Excel', () => {
    const csv = toCsv(
      [{ nombre: 'Mochila "grande", roja', total: 185000.5, nota: null }],
      ['nombre', 'total', 'nota'],
      ',',
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('nombre,total,nota\r\n"Mochila ""grande"", roja",185000.5,\r\n');
  });

  it('neutraliza celdas que parecen fórmulas (inyección CSV)', () => {
    const csv = toCsv([{ a: '=HYPERLINK("http://x")', b: '+57 300', c: -5 }], ['a', 'b', 'c'], ';');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")";'+57 300;-5`);
  });
});

describe('toRange', () => {
  const now = new Date('2026-11-05T03:00:00Z'); // 4 nov, 22:00 en Colombia

  it('interpreta los días en hora de Colombia, ambos incluidos', () => {
    expect(toRange('2026-11-01', '2026-11-30', now)).toEqual({
      from: new Date('2026-11-01T05:00:00Z'),
      to: new Date('2026-12-01T05:00:00Z'),
    });
  });

  it('por defecto toma los últimos 30 días hasta hoy en Colombia', () => {
    const range = toRange(undefined, undefined, now);
    expect(range.to).toEqual(new Date('2026-11-05T05:00:00Z'));
    expect(range.to.getTime() - range.from.getTime()).toBe(30 * 86_400_000);
  });

  it('rechaza rangos invertidos o de más de un año', () => {
    expect(() => toRange('2026-11-30', '2026-11-01', now)).toThrow(/inválido/);
    expect(() => toRange('2024-01-01', '2026-01-01', now)).toThrow(/366/);
  });
});

describe('envíos', () => {
  it('valida las transiciones del envío', () => {
    expect(() => assertShipmentTransition('IN_TRANSIT', 'DELIVERED')).not.toThrow();
    expect(() => assertShipmentTransition('FAILED', 'IN_TRANSIT')).not.toThrow();
    expect(() => assertShipmentTransition('RETURNED', 'IN_TRANSIT')).toThrow(/no puede/);
    expect(() => assertShipmentTransition('DELIVERED', 'IN_TRANSIT')).toThrow(/no puede/);
  });
});
