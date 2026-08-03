export function parseMacProxyState(output = '') {
  return {
    enabled: /^Enabled:\s*Yes\s*$/im.test(output),
    server: output.match(/^Server:\s*(.*)$/im)?.[1]?.trim() || '',
    port: Number(output.match(/^Port:\s*(\d+)$/im)?.[1] || 0),
  };
}

export function parseMacNetworkServices(output = '') {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('An asterisk') && !line.startsWith('*'));
}

export function isOwnedMacProxy(state, applied) {
  return (
    !!state?.enabled &&
    state.server === applied?.host &&
    Number(state.port) === Number(applied?.port)
  );
}

export function matchesMacProxyState(current, expected) {
  if (!!current?.enabled !== !!expected?.enabled) return false;
  if (!expected?.enabled) return true;
  return current.server === expected.server && Number(current.port) === Number(expected.port);
}
