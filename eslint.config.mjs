import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'target/**', 'orbit/**', 'orbit-host/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
