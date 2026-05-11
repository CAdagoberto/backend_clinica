import fs from 'fs';
import path from 'path';
import { SERVER_ROOT as ROOT } from './config/env.js';

/** Pasta raiz do servidor (`server/`), igual a `SERVER_ROOT` em `config/env.js`. */
export const SERVER_ROOT = ROOT;

/** Garante pastas úteis em produção (uploads futuros, logs). */
export function ensureDirectories() {
  for (const name of ['uploads', 'logs']) {
    fs.mkdirSync(path.join(SERVER_ROOT, name), { recursive: true });
  }
}
