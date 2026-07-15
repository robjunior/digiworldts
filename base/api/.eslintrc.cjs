/** API-specific ESLint config: extends the shared root, Node environment. */
module.exports = {
  root: false,
  extends: ['../../.eslintrc.cjs'],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.config.ts', '.eslintrc.cjs'],
};
