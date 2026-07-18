const path = require('path');

const shared = {
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, './build-electron'),
  },
  module: {
    rules: [],
  },
  mode: 'production',
  devtool: false,
  node: false,
  stats: {
    errorDetails: true,
  },
};

// index 跑在主进程（electron-main），preload 跑在带 contextIsolation 的隔离世界
// （electron-preload），两者的 webpack target 不同，因此拆成两份配置。
module.exports = [
  {
    ...shared,
    name: 'main',
    entry: { index: path.resolve(__dirname, './electron/index.js') },
    target: 'electron-main',
  },
  {
    ...shared,
    name: 'preload',
    entry: { preload: path.resolve(__dirname, './electron/preload.js') },
    target: 'electron-preload',
  },
];
