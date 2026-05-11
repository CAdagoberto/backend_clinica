import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do pacote `server/` (onde fica o `.env` da API). */
export const SERVER_ROOT = path.join(__dirname, '..', '..');
/** Raiz do repositório (projeto principal — `.env` com DB_HOST, etc.). */
export const REPO_ROOT = path.join(SERVER_ROOT, '..');

const envPrincipal = path.join(REPO_ROOT, '.env');
const envApi = path.join(SERVER_ROOT, '.env');

// 1) .env do projeto principal (valores base)
dotenv.config({ path: envPrincipal });
// 2) .env dentro de `server/` — **override: true** para ganhar sobre o principal (evita root vazio do .env da raiz na VPS)
dotenv.config({ path: envApi, override: true });

function defined(key) {
  return process.env[key] !== undefined;
}

function parseDatabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const protocol = u.protocol.replace(':', '');
    if (!['mysql', 'mysql2'].includes(protocol)) return null;
    const pathname = decodeURIComponent(u.pathname.replace(/^\//, '') || '').split('?')[0];
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 3306,
      user: u.username ? decodeURIComponent(u.username) : '',
      password: u.password !== '' ? decodeURIComponent(u.password) : '',
      database: pathname || undefined,
    };
  } catch {
    return null;
  }
}

const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);

/**
 * Senha: só variáveis de ambiente / URL — nada hardcoded em produção.
 */
function resolvePassword() {
  if (defined('MYSQL_PASSWORD')) return process.env.MYSQL_PASSWORD;
  if (defined('DB_PASSWORD')) return process.env.DB_PASSWORD;
  if (defined('DB_PASS')) return process.env.DB_PASS;
  if (defined('DATABASE_URL') && fromUrl) return fromUrl.password;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Em produção defina DB_PASSWORD ou MYSQL_PASSWORD no .env da API (ou use DATABASE_URL com senha).'
    );
  }
  return '123456';
}

function resolveUser() {
  const u =
    process.env.MYSQL_USER ||
    process.env.DB_USER ||
    process.env.DB_USERNAME ||
    (fromUrl?.user ? fromUrl.user : undefined);
  if (u !== undefined && String(u).trim() !== '') return String(u).trim();
  if (defined('DATABASE_URL') && fromUrl && fromUrl.user) return fromUrl.user;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Em produção defina DB_USER ou MYSQL_USER no ficheiro: ${envApi} (existe: ${fs.existsSync(envApi)}).`
    );
  }
  return 'root';
}

/**
 * Config MySQL para mysql2 — tudo vem do .env (API + opcional raiz). Nada de credenciais no código.
 */
export const MYSQL = {
  get host() {
    return (
      process.env.MYSQL_HOST ||
      process.env.DB_HOST ||
      fromUrl?.host ||
      '127.0.0.1'
    );
  },
  get port() {
    const p =
      process.env.MYSQL_PORT ||
      process.env.DB_PORT ||
      (fromUrl?.port != null ? String(fromUrl.port) : '');
    const n = Number(p);
    return Number.isFinite(n) && n > 0 ? n : 3306;
  },
  get user() {
    return resolveUser();
  },
  get password() {
    return resolvePassword();
  },
  get database() {
    return (
      process.env.MYSQL_DATABASE ||
      process.env.DB_DATABASE ||
      process.env.DB_NAME ||
      fromUrl?.database ||
      'clinica_psi'
    );
  },
};

/** Falha cedo com mensagem clara (PM2 / .env em falta). */
export function assertMysqlEnv() {
  void MYSQL.user;
  void MYSQL.password;
}

if (process.env.NODE_ENV === 'production') {
  assertMysqlEnv();
}
