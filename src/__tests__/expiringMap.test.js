import ExpiringMap from '../../electron/expiringMap';

describe('ExpiringMap', () => {
  test('expires old entries', () => {
    let time = 100;
    const map = new ExpiringMap({
      ttlMs: 50,
      maxSize: 10,
      now: () => time,
    });
    map.set('a', 1);
    time = 151;
    expect(map.get('a')).toBeUndefined();
  });

  test('evicts the oldest entry at capacity', () => {
    const map = new ExpiringMap({ ttlMs: 1000, maxSize: 2 });
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
  });
});
