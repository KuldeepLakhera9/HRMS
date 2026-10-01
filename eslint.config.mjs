import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  // Custom Architecture Boundary Rules per AGENTS.md & PHASE1_SPEC.md
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              importNames: ['Pool', 'Client'],
              message:
                'Direct pg Pool instantiation is only permitted in packages/db/src/client.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // Allow pg Pool in packages/db
    files: ['packages/db/src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
