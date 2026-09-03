// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config({ files: ['src/**/*.ts'], extends: [tseslint.configs.base],
  languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  rules: { curly: ['error', 'all'], '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/array-type': ['error', { default: 'array-simple' }] }, ignores: ['dist'] });
