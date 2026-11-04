import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/bootstrap-admin.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: ['@ssms/shared'],
});
