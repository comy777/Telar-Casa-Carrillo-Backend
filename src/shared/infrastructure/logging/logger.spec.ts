import { redactUrl } from './logger.module';

describe('redactUrl', () => {
  it('oculta los tokens de la URL y conserva lo demás', () => {
    expect(redactUrl('/api/v1/orders/TCC-000001?token=abc123&x=1')).toBe(
      '/api/v1/orders/TCC-000001?token=[REDACTED]&x=1',
    );
    expect(redactUrl('/api/v1/orders/TCC-000001/tracking?x=1&TOKEN=abc')).toBe(
      '/api/v1/orders/TCC-000001/tracking?x=1&TOKEN=[REDACTED]',
    );
    expect(redactUrl('/api/v1/catalog/products?q=token')).toBe('/api/v1/catalog/products?q=token');
    expect(redactUrl(undefined)).toBeUndefined();
  });
});
