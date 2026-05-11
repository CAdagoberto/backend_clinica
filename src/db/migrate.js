import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { MYSQL } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_REF = process.env.DATA_REFERENCIA || '2026-04-20';

export async function ensureDatabase() {
  const { host, port, user, password, database } = MYSQL;
  const skipCreate = process.env.MYSQL_SKIP_CREATE_DATABASE === 'true';

  let conn;
  try {
    conn = await mysql.createConnection({ host, port, user, password });
    if (skipCreate) {
      return database;
    }
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (e) {
    const noPrivilege =
      e.errno === 1044 ||
      e.code === 'ER_DBACCESS_DENIED_ERROR' ||
      /Access denied for user .* to database/i.test(String(e.sqlMessage || e.message || ''));
    if (!noPrivilege) {
      throw e;
    }
    console.warn(
      `[clinica-api] CREATE DATABASE ignorado (${e.code || e.errno}): o utilizador MySQL não tem permissão para criar bases. ` +
        `Crie manualmente a base \`${database}\` (ex.: como root) e garanta GRANT em \`${database}\`.* para este utilizador.`
    );
  } finally {
    if (conn) {
      await conn.end().catch(() => {});
    }
  }
  return database;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha_hash VARCHAR(255) NOT NULL,
    tipo ENUM('admin','estagiario','paciente') NOT NULL,
    matricula VARCHAR(50) NULL,
    nivel_estagio TINYINT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    responsavel_estagiario_id INT UNSIGNED NULL,
    telefone VARCHAR(80) NOT NULL DEFAULT '',
    regiao VARCHAR(120) NOT NULL DEFAULT '',
    prontuario VARCHAR(80) NOT NULL DEFAULT '',
    menor_de_idade TINYINT(1) NOT NULL DEFAULT 0,
    responsavel_legal_nome VARCHAR(255) NOT NULL DEFAULT '',
    responsavel_legal_telefone VARCHAR(80) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tipo (tipo),
    INDEX idx_responsavel (responsavel_estagiario_id),
    CONSTRAINT fk_usuario_estagiario FOREIGN KEY (responsavel_estagiario_id) REFERENCES usuarios(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS salas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    status ENUM('disponivel','ocupada','em reforma') NOT NULL DEFAULT 'disponivel',
    tipo ENUM('atendimento','recepcao','descanso') NOT NULL DEFAULT 'atendimento',
    restricao_consultorio TINYINT(1) NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS consultas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    paciente_id INT UNSIGNED NOT NULL,
    estagiario_id INT UNSIGNED NOT NULL,
    sala_id INT UNSIGNED NOT NULL,
    data_agenda DATE NOT NULL,
    horario VARCHAR(8) NOT NULL,
    status ENUM('pendente','confirmado','cancelado') NOT NULL DEFAULT 'pendente',
    pacote_id INT UNSIGNED NULL,
    sessao_numero SMALLINT UNSIGNED NULL,
    duracao_minutos SMALLINT UNSIGNED NOT NULL DEFAULT 50,
    CONSTRAINT fk_consulta_paciente FOREIGN KEY (paciente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_consulta_estagiario FOREIGN KEY (estagiario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_consulta_sala FOREIGN KEY (sala_id) REFERENCES salas(id) ON DELETE RESTRICT,
    INDEX idx_consultas_data_status (data_agenda, status),
    INDEX idx_consultas_estagiario (estagiario_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS status_paciente (
    paciente_id INT UNSIGNED PRIMARY KEY,
    status VARCHAR(80) NOT NULL DEFAULT 'aguardando atendimento',
    CONSTRAINT fk_status_paciente FOREIGN KEY (paciente_id) REFERENCES usuarios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS relatorio_consulta (
    consulta_id INT UNSIGNED PRIMARY KEY,
    texto TEXT NOT NULL,
    autor_id INT UNSIGNED NULL,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_relatorio_consulta FOREIGN KEY (consulta_id) REFERENCES consultas(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS notificacoes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT UNSIGNED NOT NULL,
    titulo VARCHAR(255) NOT NULL,
    corpo TEXT NOT NULL,
    criada_em DATE NOT NULL,
    lida TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_notif_usuario (usuario_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS encaminhamentos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    paciente_id INT UNSIGNED NOT NULL,
    tipo ENUM('interno','externo') NOT NULL,
    destino VARCHAR(255) NOT NULL,
    observacao TEXT NOT NULL,
    criado_por_id INT UNSIGNED NOT NULL,
    criado_em DATE NOT NULL,
    CONSTRAINT fk_enc_pac FOREIGN KEY (paciente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_enc_criador FOREIGN KEY (criado_por_id) REFERENCES usuarios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS avaliacoes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tipo VARCHAR(80) NOT NULL,
    nota TINYINT UNSIGNED NOT NULL,
    comentario TEXT NOT NULL,
    autor_id INT UNSIGNED NOT NULL,
    estagiario_id INT UNSIGNED NULL,
    criada_em DATE NOT NULL,
    CONSTRAINT fk_aval_autor FOREIGN KEY (autor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    CONSTRAINT fk_aval_est FOREIGN KEY (estagiario_id) REFERENCES usuarios(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS presencas_estagiario (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    estagiario_id INT UNSIGNED NOT NULL,
    data_presenca DATE NOT NULL,
    horario_chegada VARCHAR(12) NOT NULL,
    CONSTRAINT fk_pres_est FOREIGN KEY (estagiario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_pres_est_data (estagiario_id, data_presenca)
  ) ENGINE=InnoDB`,
];

const SALAS_SEED = [
  ['Consultório 1', 'disponivel', 'atendimento', 1],
  ['Consultório 2', 'disponivel', 'atendimento', 1],
  ['Consultório 3', 'disponivel', 'atendimento', 0],
  ['Consultório 4', 'disponivel', 'atendimento', 0],
  ['Consultório 5', 'ocupada', 'atendimento', 0],
  ['Consultório 6', 'disponivel', 'atendimento', 0],
  ['Recepção', 'disponivel', 'recepcao', 0],
  ['Sala de descanso', 'disponivel', 'descanso', 0],
];

export async function runMigrate(pool) {
  for (const sql of DDL) {
    await pool.query(sql);
  }

  const [[{ c: salaCount }]] = await pool.query('SELECT COUNT(*) AS c FROM salas');
  if (Number(salaCount) === 0) {
    for (const [nome, status, tipo, restr] of SALAS_SEED) {
      await pool.query(
        'INSERT INTO salas (nome, status, tipo, restricao_consultorio) VALUES (?,?,?,?)',
        [nome, status, tipo, restr]
      );
    }
  }

  const [[{ c: userCount }]] = await pool.query('SELECT COUNT(*) AS c FROM usuarios');
  if (Number(userCount) === 0) {
    const hash = await bcrypt.hash('123456', 10);
    await pool.query(`INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES (?,?,?, 'admin')`, [
      'Ana Admin',
      'admin@clinica.com',
      hash,
    ]);

    const [estRes] = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, matricula, nivel_estagio, ativo)
       VALUES (?,?,?, 'estagiario', ?, ?, 1)`,
      ['Bruno Estagiário', 'estagiario@clinica.com', hash, '2024001', 2]
    );
    const estId = estRes.insertId;

    const pacientes = [
      [
        'Carla Paciente',
        'paciente@clinica.com',
        estId,
        '(11) 98888-0001',
        'Zona Sul',
        'PRT-2026-0003',
        0,
        '',
        '',
      ],
      [
        'Diego Paciente',
        'diego@clinica.com',
        estId,
        '(11) 97777-0002',
        'Zona Leste',
        'PRT-2026-0004',
        0,
        '',
        '',
      ],
      [
        'Elisa Paciente',
        'elisa@clinica.com',
        estId,
        '(11) 96666-0003',
        'Centro',
        'PRT-2026-0005',
        1,
        'Fernanda Souza',
        '(11) 95555-0000',
      ],
    ];

    const pids = [];
    for (const [nome, email, resp, tel, reg, pront, menor, rlNome, rlTel] of pacientes) {
      const [r] = await pool.query(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo, responsavel_estagiario_id, telefone, regiao, prontuario,
          menor_de_idade, responsavel_legal_nome, responsavel_legal_telefone)
         VALUES (?,?,?, 'paciente',?,?,?,?,?,?,?)`,
        [nome, email, hash, resp, tel, reg, pront, menor, rlNome, rlTel]
      );
      pids.push(r.insertId);
    }

    const [[s3]] = await pool.query('SELECT id FROM salas WHERE nome = ? LIMIT 1', ['Consultório 3']);
    const [[s4]] = await pool.query('SELECT id FROM salas WHERE nome = ? LIMIT 1', ['Consultório 4']);
    const [[s5]] = await pool.query('SELECT id FROM salas WHERE nome = ? LIMIT 1', ['Consultório 5']);
    const sala3 = s3.id;
    const sala4 = s4.id;
    const sala5 = s5.id;

    await pool.query(
      `INSERT INTO consultas (paciente_id, estagiario_id, sala_id, data_agenda, horario, status, pacote_id, sessao_numero, duracao_minutos)
       VALUES (?,?,?,?,?,?,?,?,50)`,
      [pids[0], estId, sala3, DATA_REF, '09:00', 'pendente', 501, 1]
    );
    await pool.query(
      `INSERT INTO consultas (paciente_id, estagiario_id, sala_id, data_agenda, horario, status, pacote_id, sessao_numero, duracao_minutos)
       VALUES (?,?,?,?,?,?,?,?,50)`,
      [pids[1], estId, sala4, DATA_REF, '11:00', 'confirmado', 502, 3]
    );
    await pool.query(
      `INSERT INTO consultas (paciente_id, estagiario_id, sala_id, data_agenda, horario, status, pacote_id, sessao_numero, duracao_minutos)
       VALUES (?,?,?,?,?,?,?,?,50)`,
      [pids[2], estId, sala5, DATA_REF, '14:00', 'cancelado', null, null]
    );

    await pool.query(
      `INSERT INTO status_paciente (paciente_id, status) VALUES
       (?,'aguardando atendimento'),
       (?,'sessão confirmada'),
       (?,'cancelado')`,
      [pids[0], pids[1], pids[2]]
    );

    await pool.query(
      `INSERT INTO notificacoes (usuario_id, titulo, corpo, criada_em, lida) VALUES (?,?,?,?,0)`,
      [
        pids[0],
        'Lembrete de consulta',
        `Sua próxima sessão está agendada para ${DATA_REF} às 09:00.`,
        DATA_REF,
      ]
    );
  }
}

async function main() {
  const database = await ensureDatabase();
  const { pool } = await import('./pool.js');
  await runMigrate(pool);
  console.log(`Migração concluída no banco "${database}".`);
  await pool.end();
  process.exit(0);
}

const isCli = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
