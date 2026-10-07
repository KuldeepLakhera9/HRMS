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
      '**/.next_prod/**',
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
            {
              name: '@hrms/db/schema',
              message:
                'Direct Drizzle table schema imports are restricted to repository implementations and packages/db per AGENTS.md.',
            },
          ],
        },
      ],
    },
  },
  {
    // Allow pg Pool and @hrms/db/schema in db, module schemas, repositories, and test suites
    files: [
      'packages/db/src/**/*.ts',
      'packages/core/**/schema.ts',
      'packages/core/**/repository.ts',
      'packages/core/**/*repository*.ts',
      'tests/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
