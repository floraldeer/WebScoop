module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  extends: ['eslint:recommended'],
  ignorePatterns: [
    'build/',
    'build-electron/',
    'build-web/',
    'packs/',
    'node_modules/',
    'public/',
    'electron/decrypt.js',
    'coverage/',
  ],
  rules: {
    'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['src/**/*.{js,jsx}'],
      extends: ['react-app'],
      env: { browser: true },
    },
    {
      files: ['electron/**/*.js', 'scripts/**/*.js', 'webpack.electron.js', 'config-overrides.js'],
      env: { node: true, browser: false },
    },
    {
      files: ['src/**/__tests__/**/*.{js,jsx}', '**/*.test.js'],
      env: { jest: true, node: true },
      rules: {
        // jest.mock() 必须提升到 import 之上，此处的 import 顺序是刻意为之。
        'import/first': 'off',
      },
    },
  ],
};
