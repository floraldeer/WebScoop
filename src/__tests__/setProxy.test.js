import { parseMacNetworkServices, parseMacProxyState } from '../../electron/proxyState';

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
});
