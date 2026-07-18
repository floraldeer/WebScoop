const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (/mac-universal--(?:x64|arm64)$/.test(context.appOutDir)) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const entitlementsPath = path.join(
    context.packager.projectDir,
    'public/plist/entitlements.mac.plist',
  );

  // electron-builder skips signing when no Apple identity is installed. Re-sign
  // the modified Electron bundle ad hoc so its sandboxed helpers remain valid.
  await execFileAsync('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--options',
    'runtime',
    '--entitlements',
    entitlementsPath,
    appPath,
  ]);
};
