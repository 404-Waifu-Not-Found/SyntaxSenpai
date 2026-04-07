module.exports = {
  root: true,
  env: { browser: true, node: true, es2024: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    project: ['./tsconfig.base.json'],
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint', 'react'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'prettier'
  ],
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['node_modules/', 'dist/', 'build/', 'public/'],
  rules: {}
};
