import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns schema changes into SQL migrations in ./drizzle.
// The server applies them on startup; no database connection is needed here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle'
});
