// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No se usa consistent-type-imports: la inyección de dependencias de NestJS
      // necesita las clases como valores (emitDecoratorMetadata).
      '@typescript-eslint/no-floating-promises': 'error',
      // ignoreRestSiblings: permite omitir campos con `const { secreto, ...resto } = x`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Regla 1 de Clean Architecture: el dominio no conoce frameworks ni infraestructura.
    files: ['src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'El dominio no puede depender de NestJS.' },
            { group: ['@prisma/*', '.prisma/*'], message: 'El dominio no puede depender de Prisma.' },
            { group: ['express', 'cloudinary', 'nodemailer'], message: 'El dominio no puede depender de infraestructura.' },
            { group: ['**/application/**', '**/infrastructure/**', '**/presentation/**'], message: 'Las dependencias apuntan hacia el dominio, nunca al revés.' },
          ],
        },
      ],
    },
  },
  {
    // Regla 2: la capa de aplicación solo conoce el dominio y sus propios puertos.
    files: ['src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/*', '.prisma/*'], message: 'Los casos de uso dependen de puertos, no de Prisma.' },
            { group: ['**/infrastructure/**', '**/presentation/**'], message: 'La aplicación no depende de infraestructura ni de presentación.' },
          ],
        },
      ],
    },
  },
);
