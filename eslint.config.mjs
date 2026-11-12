import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'target/**', 'aow/**', 'orbit-host/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
