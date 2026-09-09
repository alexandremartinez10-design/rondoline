import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Même alias que tsconfig.json : les tests importent le code applicatif
      // exactement comme le fait l'application.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les modules lisent process.env au moment de l'appel, et plusieurs tests
    // le modifient. Un seul processus par fichier évite les interférences.
    isolate: true,
  },
});
