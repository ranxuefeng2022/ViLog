const globals = require('globals');

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        electronAPI: 'readonly',
        JSZip: 'readonly',
        Papa: 'readonly',
        CanvasLogRenderer: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-console': 'off',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-extra-semi': 'error',
      'no-redeclare': 'error',
      'no-duplicate-case': 'error'
    }
  },
  {
    ignores: [
      'node_modules/**',
      'mem/**',
      '*.exe',
      '*.dll',
      'renderer/js/legacy/**'
    ]
  }
];
