import {
  isOwnedMacProxy,
  matchesMacProxyState,
  parseMacNetworkServices,
  parseMacProxyState,
} from '../../electron/proxyState';

describe('system proxy state parsing', () => {
  test('parses enabled macOS proxy state', () => {
    expect(
      parseMacProxyState(`
Enabled: Yes
Server: 127.0.0.1
Port: 61522
Authenticated Proxy Enabled: 0
`),
    ).toEqual({
      enabled: true,
      server: '127.0.0.1',
      port: 61522,
    });
  });

  test('filters disabled and metadata network services', () => {
    expect(
      parseMacNetworkServices(`
An asterisk (*) denotes that a network service is disabled.
Wi-Fi
USB 10/100/1000 LAN
*Bluetooth PAN
`),
    ).toEqual(['Wi-Fi', 'USB 10/100/1000 LAN']);
  });

  test('recognizes only the enabled proxy applied by WebScoop', () => {
    const applied = { host: '127.0.0.1', port: 61522 };

    expect(isOwnedMacProxy({ enabled: true, server: '127.0.0.1', port: 61522 }, applied)).toBe(
      true,
    );
    expect(isOwnedMacProxy({ enabled: true, server: '127.0.0.1', port: 7890 }, applied)).toBe(
      false,
    );
    expect(isOwnedMacProxy({ enabled: true, server: 'feilian.proxy', port: 8080 }, applied)).toBe(
      false,
    );
    expect(isOwnedMacProxy({ enabled: false, server: '127.0.0.1', port: 61522 }, applied)).toBe(
      false,
    );
  });

  test('matches enabled proxy state by endpoint', () => {
    expect(
      matchesMacProxyState(
        { enabled: true, server: 'feilian.proxy', port: 8080 },
        { enabled: true, server: 'feilian.proxy', port: 8080 },
      ),
    ).toBe(true);
    expect(
      matchesMacProxyState(
        { enabled: true, server: 'feilian.proxy', port: 8081 },
        { enabled: true, server: 'feilian.proxy', port: 8080 },
      ),
    ).toBe(false);
  });

  test('disabled proxy state ignores retained endpoint values', () => {
    expect(
      matchesMacProxyState(
        { enabled: false, server: '127.0.0.1', port: 61522 },
        { enabled: false, server: '', port: 0 },
      ),
    ).toBe(true);
  });
});
