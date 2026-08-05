import { defineConfig } from 'vitest/config';

// Sin esta config, `vitest run tests/rules` también descubre y ejecuta las
// copias de los tests que viven dentro de .worktrees/<rama>/tests/rules/ (los
// worktrees de git están dentro del repo). Eso corría la misma suite una vez
// por worktree, contra el estado de OTRAS ramas, ensuciando el resultado con
// fallas que no son de la rama actual. `.gitignore` no basta: vitest no lo
// usa para descubrir tests.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
});
