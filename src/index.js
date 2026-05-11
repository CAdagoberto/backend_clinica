import './config/env.js';
import express from 'express';
import cors from 'cors';
import { pool } from './db/pool.js';
import { ensureDatabase, runMigrate } from './db/migrate.js';
import { ensureDirectories, SERVER_ROOT } from './bootstrap.js';
import { apiRouter } from './routes/api.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, dataReferencia: process.env.DATA_REFERENCIA || '2026-04-20' });
});

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 400;
  const message = err.message || 'Erro na requisição';
  res.status(status).json({ error: message });
});

async function startup() {
  ensureDirectories();
  await ensureDatabase();
  await runMigrate(pool);
  app.listen(PORT, () => {
    console.log(`API clínica em http://127.0.0.1:${PORT}`);
    console.log(`Pastas garantidas em: ${SERVER_ROOT} (uploads, logs)`);
  });
}

startup().catch((e) => {
  console.error('Falha ao subir o servidor:', e);
  process.exit(1);
});
