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
