import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import {
  DURACAO_SESSAO_MINUTOS,
  addSemanasYmd,
  maxPacientesPorNivel,
  statusPacientePorConsultaStatus,
  validarHorarioConsultorioRestrito,
} from '../lib/clinicaRules.js';
import {
  usuarioFromRow,
  salaFromRow,
  consultaBaseFromRow,
  encaminhamentoFromRow,
  avaliacaoFromRow,
  notificacaoFromRow,
  presencaFromRow,
} from '../lib/mappers.js';

export function getDataReferencia() {
  return process.env.DATA_REFERENCIA || '2026-04-20';
}

async function enriquecerConsultaRow(c) {
  const base = consultaBaseFromRow(c);
  const [rowsP] = await pool.query(`SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo,
    responsavel_estagiario_id, telefone, regiao, prontuario, menor_de_idade, responsavel_legal_nome,
    responsavel_legal_telefone FROM usuarios WHERE id = ?`, [base.pacienteId]);
  const [rowsE] = await pool.query(
    `SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo FROM usuarios WHERE id = ?`,
    [base.estagiarioId]
  );
  const [rowsS] = await pool.query('SELECT * FROM salas WHERE id = ?', [base.salaId]);
  const paciente = usuarioFromRow(rowsP[0]);
  const estagiario = usuarioFromRow(rowsE[0]);
  const sala = salaFromRow(rowsS[0]);
  return {
    ...base,
    pacienteNome: paciente?.nome || 'Paciente não encontrado',
    estagiarioNome: estagiario?.nome || 'Estagiário não encontrado',
    salaNome: sala?.nome || 'Sala não encontrada',
    salaStatus: sala?.status || 'indefinido',
  };
}

async function notificarPaciente(pacienteId, titulo, corpo, dataStr = null) {
  const d = dataStr || getDataReferencia();
  await pool.query(`INSERT INTO notificacoes (usuario_id, titulo, corpo, criada_em, lida) VALUES (?,?,?,?,0)`, [
    pacienteId,
    titulo,
    corpo,
    d,
  ]);
}

async function upsertStatusPaciente(pacienteId, statusConsulta) {
  const status = statusPacientePorConsultaStatus(statusConsulta);
  await pool.query(`INSERT INTO status_paciente (paciente_id, status) VALUES (?,?)
    ON DUPLICATE KEY UPDATE status = VALUES(status)`, [pacienteId, status]);
}

async function proximoPacoteVirtual() {
  const [[{ m }]] = await pool.query('SELECT COALESCE(MAX(id), 0) + 10000 AS m FROM consultas');
  return Number(m);
}

export async function login(email, senha) {
  const [rows] = await pool.query(`SELECT id, nome, email, senha_hash, tipo, matricula, nivel_estagio, ativo,
    responsavel_estagiario_id, telefone, regiao, prontuario, menor_de_idade, responsavel_legal_nome,
    responsavel_legal_telefone FROM usuarios WHERE LOWER(email) = LOWER(?)`, [email.trim()]);
  const r = rows[0];
  if (!r) throw new Error('Email ou senha inválidos.');
  const ok = await bcrypt.compare(senha, r.senha_hash);
  if (!ok) throw new Error('Email ou senha inválidos.');
  return usuarioFromRow(r);
}

export async function cadastrarUsuario(novoUsuario, contexto = {}) {
  const atorTipo = contexto.atorTipo;
  const atorId = Number(contexto.atorId);
  const tipoNovoUsuario = novoUsuario.tipo;

  if (!atorTipo) throw new Error('Cadastro público não é permitido.');
  if (tipoNovoUsuario === 'admin') throw new Error('Não é permitido cadastrar administrador por esta tela.');
  if (atorTipo === 'estagiario' && tipoNovoUsuario !== 'paciente') {
    throw new Error('Estagiário só pode cadastrar pacientes.');
  }
  if (atorTipo !== 'admin' && atorTipo !== 'estagiario') throw new Error('Sem permissão para cadastro.');

  const [ex] = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)', [novoUsuario.email.trim()]);
  if (ex.length) throw new Error('Esse email já está cadastrado.');

  const [estRows] = await pool.query(`SELECT id FROM usuarios WHERE tipo = 'estagiario' ORDER BY id LIMIT 1`);
  const estagiarioPadraoId = estRows[0]?.id;

  let responsavelPacienteId;
  if (tipoNovoUsuario === 'paciente') {
    responsavelPacienteId =
      atorTipo === 'estagiario'
        ? atorId
        : Number(novoUsuario.responsavelEstagiarioId) || estagiarioPadraoId || null;
    if (!responsavelPacienteId) throw new Error('Paciente precisa de um estagiário responsável.');

    const [est] = await pool.query(`SELECT id, nivel_estagio FROM usuarios WHERE id = ? AND tipo = 'estagiario'`, [
      responsavelPacienteId,
    ]);
    if (est[0]) {
      const limite = maxPacientesPorNivel(est[0].nivel_estagio || 1);
      const [[{ c }]] = await pool.query(
        `SELECT COUNT(*) AS c FROM usuarios WHERE tipo = 'paciente' AND responsavel_estagiario_id = ?`,
        [responsavelPacienteId]
      );
      if (Number(c) >= limite) {
        throw new Error(
          `Este estagiário já atingiu o limite de pacientes para o estágio ${est[0].nivel_estagio || 1} (máx. ${limite}).`
        );
      }
    }
  }

  if (tipoNovoUsuario === 'paciente') {
    if (!novoUsuario.telefone?.trim()) throw new Error('Telefone do paciente é obrigatório.');
    if (!novoUsuario.regiao?.trim()) throw new Error('Região / localização do paciente é obrigatória.');
    if (!novoUsuario.prontuario?.trim()) throw new Error('Número de prontuário é obrigatório.');
    const menor = Boolean(novoUsuario.menorDeIdade);
    if (menor) {
      if (!novoUsuario.responsavelLegalNome?.trim() || !novoUsuario.responsavelLegalTelefone?.trim()) {
        throw new Error('Paciente menor de idade: cadastre nome e telefone do responsável legal.');
      }
    }
  }

  if (tipoNovoUsuario === 'estagiario') {
    if (!novoUsuario.matricula?.trim()) throw new Error('Matrícula do estagiário é obrigatória.');
    if (![1, 2, 3].includes(Number(novoUsuario.nivelEstagio))) {
      throw new Error('Informe o estágio atual (1, 2 ou 3).');
    }
  }

  const hash = await bcrypt.hash(novoUsuario.senha, 10);
  const [ins] = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, tipo, matricula, nivel_estagio, ativo, responsavel_estagiario_id,
      telefone, regiao, prontuario, menor_de_idade, responsavel_legal_nome, responsavel_legal_telefone)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      novoUsuario.nome.trim(),
      novoUsuario.email.toLowerCase().trim(),
      hash,
      tipoNovoUsuario,
      tipoNovoUsuario === 'estagiario' ? novoUsuario.matricula.trim() : null,
      tipoNovoUsuario === 'estagiario' ? Number(novoUsuario.nivelEstagio) : null,
      tipoNovoUsuario === 'estagiario' ? (novoUsuario.ativo !== false ? 1 : 0) : 1,
      tipoNovoUsuario === 'paciente' ? responsavelPacienteId : null,
      tipoNovoUsuario === 'paciente' ? novoUsuario.telefone.trim() : '',
      tipoNovoUsuario === 'paciente' ? novoUsuario.regiao.trim() : '',
      tipoNovoUsuario === 'paciente' ? novoUsuario.prontuario.trim() : '',
      tipoNovoUsuario === 'paciente' ? (novoUsuario.menorDeIdade ? 1 : 0) : 0,
      novoUsuario.responsavelLegalNome?.trim() || '',
      novoUsuario.responsavelLegalTelefone?.trim() || '',
    ]
  );
  const [[created]] = await pool.query(`SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo,
    responsavel_estagiario_id, telefone, regiao, prontuario, menor_de_idade, responsavel_legal_nome,
    responsavel_legal_telefone FROM usuarios WHERE id = ?`, [ins.insertId]);
  return usuarioFromRow(created);
}

export async function getEstagiarios(filtroNome = '') {
  const filtro = `%${filtroNome.trim().toLowerCase()}%`;
  const [rows] = await pool.query(
    `SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo FROM usuarios
     WHERE tipo = 'estagiario' AND LOWER(nome) LIKE ? ORDER BY nome`,
    [filtro]
  );
  return rows.map((r) => usuarioFromRow({ ...r, responsavel_estagiario_id: null }));
}

export async function getPacientes(estagiarioId = null) {
  let sql = `SELECT id, nome, email, tipo, responsavel_estagiario_id, telefone, regiao, prontuario,
    menor_de_idade, responsavel_legal_nome, responsavel_legal_telefone FROM usuarios WHERE tipo = 'paciente'`;
  const params = [];
  if (estagiarioId != null && estagiarioId !== '') {
    sql += ' AND responsavel_estagiario_id = ?';
    params.push(Number(estagiarioId));
  }
  sql += ' ORDER BY nome';
  const [rows] = await pool.query(sql, params);
  return rows.map(usuarioFromRow);
}

export async function getPacientesComStatus(estagiarioId = null) {
  const pacientes = await getPacientes(estagiarioId);
  const out = [];
  for (const p of pacientes) {
    const [st] = await pool.query('SELECT status FROM status_paciente WHERE paciente_id = ?', [p.id]);
    const [respRows] = await pool.query(`SELECT nome FROM usuarios WHERE id = ? AND tipo = 'estagiario'`, [
      p.responsavelEstagiarioId,
    ]);
    out.push({
      ...p,
      statusPaciente: st[0]?.status || 'aguardando atendimento',
      estagiarioResponsavelNome: respRows[0]?.nome || 'Sem responsável',
    });
  }
  return out;
}

export async function getProntuarioPaciente(pacienteId) {
  const [pacRows] = await pool.query(`SELECT id, nome, email, tipo, responsavel_estagiario_id, telefone, regiao,
    prontuario, menor_de_idade, responsavel_legal_nome, responsavel_legal_telefone FROM usuarios
    WHERE id = ? AND tipo = 'paciente'`, [pacienteId]);
  const paciente = usuarioFromRow(pacRows[0]);
  if (!paciente) throw new Error('Paciente não encontrado.');

  const [estRows] = await pool.query(`SELECT nome, matricula FROM usuarios WHERE id = ? AND tipo = 'estagiario'`, [
    paciente.responsavelEstagiarioId,
  ]);
  const [consRows] = await pool.query(
    'SELECT * FROM consultas WHERE paciente_id = ? ORDER BY data_agenda, horario',
    [pacienteId]
  );
  const historico = [];
  for (const c of consRows) {
    historico.push(await enriquecerConsultaRow(c));
  }

  const [encRows] = await pool.query('SELECT * FROM encaminhamentos WHERE paciente_id = ? ORDER BY id DESC', [
    pacienteId,
  ]);

  return {
    paciente,
    profissionalResponsavel: estRows[0] ? { nome: estRows[0].nome, matricula: estRows[0].matricula } : null,
    historicoConsultas: historico,
    encaminhamentos: encRows.map(encaminhamentoFromRow),
  };
}

export async function getConsultasByUsuario(userId) {
  const [urows] = await pool.query('SELECT id, tipo FROM usuarios WHERE id = ?', [userId]);
  const usuario = urows[0];
  if (!usuario) return [];

  let consRows;
  if (usuario.tipo === 'admin') {
    [consRows] = await pool.query('SELECT * FROM consultas ORDER BY data_agenda DESC, horario DESC');
  } else if (usuario.tipo === 'estagiario') {
    [consRows] = await pool.query('SELECT * FROM consultas WHERE estagiario_id = ? ORDER BY data_agenda DESC', [
      userId,
    ]);
  } else {
    [consRows] = await pool.query('SELECT * FROM consultas WHERE paciente_id = ? ORDER BY data_agenda DESC', [
      userId,
    ]);
  }

  const out = [];
  for (const c of consRows) {
    out.push(await enriquecerConsultaRow(c));
  }
  return out;
}

export async function getConsultaById(consultaId) {
  const [rows] = await pool.query('SELECT * FROM consultas WHERE id = ?', [consultaId]);
  if (!rows[0]) throw new Error('Consulta não encontrada.');
  return enriquecerConsultaRow(rows[0]);
}

export async function getConsultasDisponiveis() {
  const ref = getDataReferencia();
  const [consRows] = await pool.query(
    'SELECT * FROM consultas WHERE data_agenda = ? AND status = ? ORDER BY horario',
    [ref, 'pendente']
  );
  const out = [];
  for (const c of consRows) {
    out.push(await enriquecerConsultaRow(c));
  }
  return out;
}

export async function fazerCheckIn(consultaId) {
  await pool.query(`UPDATE consultas SET status = 'confirmado' WHERE id = ?`, [consultaId]);
  const c = await getConsultaById(consultaId);
  await upsertStatusPaciente(c.pacienteId, 'confirmado');
  await notificarPaciente(c.pacienteId, 'Presença confirmada', 'Sua consulta foi registrada na recepção.');
  return c;
}

export async function atualizarStatusConsulta(consultaId, novoStatus) {
  await pool.query('UPDATE consultas SET status = ? WHERE id = ?', [novoStatus, consultaId]);
  const c = await getConsultaById(consultaId);
  await upsertStatusPaciente(c.pacienteId, novoStatus);
  if (novoStatus === 'cancelado') {
    await notificarPaciente(c.pacienteId, 'Consulta cancelada', 'Sua consulta foi cancelada no sistema.');
  }
  if (novoStatus === 'confirmado') {
    await notificarPaciente(c.pacienteId, 'Consulta confirmada', 'Sua consulta foi confirmada.');
  }
  return c;
}

export async function getRelatorioConsulta(consultaId) {
  const [rows] = await pool.query('SELECT texto FROM relatorio_consulta WHERE consulta_id = ?', [consultaId]);
  return { texto: rows[0]?.texto || '' };
}

export async function salvarRelatorioConsulta({ consultaId, texto, autorId }) {
  const [crows] = await pool.query('SELECT id FROM consultas WHERE id = ?', [consultaId]);
  if (!crows[0]) throw new Error('Consulta não encontrada.');
  const limpo = texto?.trim() || '';
  if (!limpo) throw new Error('Informe o relatório de atendimento.');
  await pool.query(
    `INSERT INTO relatorio_consulta (consulta_id, texto, autor_id) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE texto = VALUES(texto), autor_id = VALUES(autor_id)`,
    [consultaId, limpo, autorId || null]
  );
  return { consultaId: Number(consultaId), texto: limpo, autorId };
}

export async function getNotificacoes(usuarioId) {
  const [rows] = await pool.query(
    'SELECT * FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC',
    [usuarioId]
  );
  return rows.map(notificacaoFromRow);
}

export async function marcarNotificacaoLida(notificacaoId, usuarioId) {
  await pool.query('UPDATE notificacoes SET lida = 1 WHERE id = ? AND usuario_id = ?', [
    notificacaoId,
    usuarioId,
  ]);
  return true;
}

export async function getEncaminhamentosPorPaciente(pacienteId) {
  const [rows] = await pool.query('SELECT * FROM encaminhamentos WHERE paciente_id = ? ORDER BY id DESC', [
    pacienteId,
  ]);
  return rows.map(encaminhamentoFromRow);
}

export async function getEncaminhamentosDoEstagiario(estagiarioId) {
  const [ids] = await pool.query(`SELECT id FROM usuarios WHERE tipo = 'paciente' AND responsavel_estagiario_id = ?`, [
    estagiarioId,
  ]);
  if (!ids.length) return [];
  const place = ids.map(() => '?').join(',');
  const [rows] = await pool.query(`SELECT * FROM encaminhamentos WHERE paciente_id IN (${place}) ORDER BY id DESC`, [
    ...ids.map((x) => x.id),
  ]);
  return rows.map(encaminhamentoFromRow);
}

export async function getEncaminhamentosTodos() {
  const [rows] = await pool.query('SELECT * FROM encaminhamentos ORDER BY id DESC');
  return rows.map(encaminhamentoFromRow);
}

export async function criarEncaminhamento({ pacienteId, tipo, destino, observacao, criadoPorId }) {
  if (!['interno', 'externo'].includes(tipo)) throw new Error('Tipo de encaminhamento inválido.');
  if (!destino?.trim()) throw new Error('Informe o destino do encaminhamento.');
  const d = getDataReferencia();
  const [ins] = await pool.query(
    `INSERT INTO encaminhamentos (paciente_id, tipo, destino, observacao, criado_por_id, criado_em)
     VALUES (?,?,?,?,?,?)`,
    [pacienteId, tipo, destino.trim(), observacao?.trim() || '', criadoPorId, d]
  );
  const [[row]] = await pool.query('SELECT * FROM encaminhamentos WHERE id = ?', [ins.insertId]);
  return encaminhamentoFromRow(row);
}

export async function getAvaliacoes({ usuarioId, papel }) {
  let sql = 'SELECT * FROM avaliacoes';
  const params = [];
  if (papel === 'estagiario') {
    sql += ' WHERE estagiario_id = ?';
    params.push(usuarioId);
  } else if (papel === 'paciente') {
    sql += ' WHERE autor_id = ?';
    params.push(usuarioId);
  } else if (papel !== 'admin') {
    return [];
  }
  sql += ' ORDER BY id DESC';
  const [rows] = await pool.query(sql, params);
  return rows.map(avaliacaoFromRow);
}

export async function registrarAvaliacao({ tipo, nota, comentario, autorId, estagiarioId }) {
  if (nota < 1 || nota > 5) throw new Error('A nota deve ser de 1 a 5.');
  const d = getDataReferencia();
  const [ins] = await pool.query(
    `INSERT INTO avaliacoes (tipo, nota, comentario, autor_id, estagiario_id, criada_em) VALUES (?,?,?,?,?,?)`,
    [tipo, nota, comentario?.trim() || '', autorId, estagiarioId || null, d]
  );
  const [[row]] = await pool.query('SELECT * FROM avaliacoes WHERE id = ?', [ins.insertId]);
  return avaliacaoFromRow(row);
}

export async function getSalas() {
  const [rows] = await pool.query('SELECT * FROM salas ORDER BY id');
  return rows.map(salaFromRow);
}

export async function getSalasAtendimento() {
  const [rows] = await pool.query(`SELECT * FROM salas WHERE tipo = 'atendimento' ORDER BY id`);
  return rows.map(salaFromRow);
}

export async function atualizarStatusSala(salaId, novoStatus) {
  const statusLimpo = novoStatus.trim().toLowerCase();
  if (!['disponivel', 'ocupada', 'em reforma'].includes(statusLimpo)) {
    throw new Error('Status inválido para a sala.');
  }
  const [r] = await pool.query('UPDATE salas SET status = ? WHERE id = ?', [statusLimpo, salaId]);
  if (r.affectedRows === 0) throw new Error('Sala não encontrada.');
  const [[row]] = await pool.query('SELECT * FROM salas WHERE id = ?', [salaId]);
  return salaFromRow(row);
}

export async function criarConsulta({ pacienteId, estagiarioId, salaId, data, horario, status = 'pendente' }) {
  const [prows] = await pool.query(`SELECT * FROM usuarios WHERE id = ? AND tipo = 'paciente'`, [pacienteId]);
  const paciente = prows[0];
  if (!paciente) throw new Error('Paciente não encontrado.');
  const respId = paciente.responsavel_estagiario_id;
  if (!respId) throw new Error('Paciente sem estagiário responsável.');
  if (Number(estagiarioId) !== respId) throw new Error('Esse paciente pertence a outro estagiário responsável.');

  const [srows] = await pool.query('SELECT * FROM salas WHERE id = ?', [salaId]);
  const sala = srows[0];
  if (!sala || sala.tipo !== 'atendimento') throw new Error('Selecione um consultório de atendimento válido.');

  const dataLimpa = data?.trim() || getDataReferencia();
  const horarioLimpo = horario?.trim() || '08:00';
  const err = validarHorarioConsultorioRestrito(salaFromRow(sala), dataLimpa, horarioLimpo);
  if (err) throw new Error(err);

  const [ins] = await pool.query(
    `INSERT INTO consultas (paciente_id, estagiario_id, sala_id, data_agenda, horario, status, pacote_id, sessao_numero, duracao_minutos)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [pacienteId, respId, salaId, dataLimpa, horarioLimpo, status, null, null, DURACAO_SESSAO_MINUTOS]
  );
  await upsertStatusPaciente(pacienteId, status);
  await notificarPaciente(
    pacienteId,
    'Nova consulta',
    `Consulta agendada para ${dataLimpa} às ${horarioLimpo}.`,
    dataLimpa
  );
  const [[c]] = await pool.query('SELECT * FROM consultas WHERE id = ?', [ins.insertId]);
  return enriquecerConsultaRow(c);
}

export async function agendarPacoteDeSessoes({ pacienteId, estagiarioId, salaId, dataPrimeiraSessao, horario }) {
  const [prows] = await pool.query(`SELECT * FROM usuarios WHERE id = ? AND tipo = 'paciente'`, [pacienteId]);
  const paciente = prows[0];
  if (!paciente) throw new Error('Paciente não encontrado.');
  const respId = paciente.responsavel_estagiario_id;
  if (Number(estagiarioId) !== respId) {
    throw new Error('O paciente só pode ser agendado com o estagiário responsável.');
  }

  const [srows] = await pool.query('SELECT * FROM salas WHERE id = ?', [salaId]);
  const sala = srows[0];
  if (!sala || sala.tipo !== 'atendimento') throw new Error('Selecione um consultório de atendimento válido.');
  const salaObj = salaFromRow(sala);

  const dataIni = dataPrimeiraSessao?.trim();
  const horaIni = horario?.trim();
  if (!dataIni || !horaIni) throw new Error('Informe a data da primeira sessão e o horário.');

  const err0 = validarHorarioConsultorioRestrito(salaObj, dataIni, horaIni);
  if (err0) throw new Error(err0);

  const pacoteId = await proximoPacoteVirtual();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const criadas = [];
    for (let i = 0; i < 10; i++) {
      const dataSessao = i === 0 ? dataIni : addSemanasYmd(dataIni, i);
      const err = validarHorarioConsultorioRestrito(salaObj, dataSessao, horaIni);
      if (err) throw new Error(`Sessão ${i + 1} (${dataSessao}): ${err}`);

      const [ins] = await conn.query(
        `INSERT INTO consultas (paciente_id, estagiario_id, sala_id, data_agenda, horario, status, pacote_id, sessao_numero, duracao_minutos)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [pacienteId, respId, salaId, dataSessao, horaIni, 'pendente', pacoteId, i + 1, DURACAO_SESSAO_MINUTOS]
      );
      const [[c]] = await conn.query('SELECT * FROM consultas WHERE id = ?', [ins.insertId]);
      criadas.push(c);
      await conn.query(`INSERT INTO status_paciente (paciente_id, status) VALUES (?,?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)`, [pacienteId, statusPacientePorConsultaStatus('pendente')]);
    }
    await conn.commit();
    await notificarPaciente(
      pacienteId,
      'Pacote de sessões agendado',
      `Foram criadas 10 sessões consecutivas (${horaIni}, ${DURACAO_SESSAO_MINUTOS} min cada), mantendo o mesmo dia da semana.`,
      dataIni
    );
    const out = [];
    for (const c of criadas) {
      out.push(await enriquecerConsultaRow(c));
    }
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getUsuarios() {
  const [rows] = await pool.query(`SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo,
    responsavel_estagiario_id, telefone, regiao, prontuario, menor_de_idade, responsavel_legal_nome,
    responsavel_legal_telefone FROM usuarios ORDER BY id`);
  return rows.map(usuarioFromRow);
}

export async function getConsultasAdmin({ status = null } = {}) {
  let sql = 'SELECT * FROM consultas';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY data_agenda DESC, horario DESC';
  const [consRows] = await pool.query(sql, params);
  const out = [];
  for (const c of consRows) {
    out.push(await enriquecerConsultaRow(c));
  }
  return out;
}

export async function getStatsAdmin() {
  const [[{ pendentes }]] = await pool.query(`SELECT SUM(status = 'pendente') AS pendentes FROM consultas`);
  const [[{ confirmados }]] = await pool.query(`SELECT SUM(status = 'confirmado') AS confirmados FROM consultas`);
  const [[{ totalEstagiarios }]] = await pool.query(`SELECT COUNT(*) AS totalEstagiarios FROM usuarios WHERE tipo = 'estagiario'`);
  return {
    pendentes: Number(pendentes) || 0,
    confirmados: Number(confirmados) || 0,
    totalEstagiarios: Number(totalEstagiarios) || 0,
  };
}

export async function getAlertasAdmin() {
  const ref = getDataReferencia();
  const [[{ pendentesHoje }]] = await pool.query(
    `SELECT COUNT(*) AS pendentesHoje FROM consultas WHERE data_agenda = ? AND status = 'pendente'`,
    [ref]
  );
  const [estRows] = await pool.query(`SELECT id FROM usuarios WHERE tipo = 'estagiario'`);
  let estagiariosSemConsultas = 0;
  for (const e of estRows) {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM consultas WHERE estagiario_id = ?', [e.id]);
    if (Number(n) === 0) estagiariosSemConsultas += 1;
  }
  return { pendentesHoje: Number(pendentesHoje) || 0, estagiariosSemConsultas };
}

async function contarPacientesVinculados(estId) {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(*) AS c FROM usuarios WHERE tipo = 'paciente' AND responsavel_estagiario_id = ?`,
    [estId]
  );
  return Number(c);
}

export async function getEstagiariosComConsultas({ filtroNome = '', filtro = null } = {}) {
  const nomeLimpo = `%${filtroNome.trim().toLowerCase()}%`;
  const [estRows] = await pool.query(
    `SELECT id, nome, email, tipo, matricula, nivel_estagio, ativo FROM usuarios
     WHERE tipo = 'estagiario' AND LOWER(nome) LIKE ? ORDER BY nome`,
    [nomeLimpo]
  );

  let resultado = await Promise.all(
    estRows.map(async (est) => {
      const [[{ totalConsultas }]] = await pool.query('SELECT COUNT(*) AS totalConsultas FROM consultas WHERE estagiario_id = ?', [
        est.id,
      ]);
      const totalPacientes = await contarPacientesVinculados(est.id);
      const nivel = est.nivel_estagio || 1;
      const limite = maxPacientesPorNivel(nivel);
      let carga;
      const tc = Number(totalConsultas);
      if (tc === 0) carga = 'sem_consultas';
      else if (tc <= 3) carga = 'equilibrado';
      else carga = 'sobrecarregado';
      return {
        ...usuarioFromRow({ ...est, responsavel_estagiario_id: null }),
        totalConsultas: tc,
        totalPacientes,
        limitePacientes: limite,
        carga,
      };
    })
  );

  if (filtro === 'sem_consultas') resultado = resultado.filter((e) => e.totalConsultas === 0);
  else if (filtro === 'com_consultas') resultado = resultado.filter((e) => e.totalConsultas > 0);

  resultado.sort((a, b) => {
    const ordem = { sem_consultas: 0, equilibrado: 1, sobrecarregado: 2 };
    return ordem[a.carga] - ordem[b.carga];
  });
  return resultado;
}

export async function getPresencasEstagiario(estagiarioId) {
  const [rows] = await pool.query('SELECT * FROM presencas_estagiario WHERE estagiario_id = ? ORDER BY id DESC', [
    estagiarioId,
  ]);
  return rows.map(presencaFromRow);
}

export async function registrarPresencaEstagiario(estagiarioId) {
  const ref = getDataReferencia();
  const horarioChegada = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const [ins] = await pool.query(
    `INSERT INTO presencas_estagiario (estagiario_id, data_presenca, horario_chegada) VALUES (?,?,?)`,
    [estagiarioId, ref, horarioChegada]
  );
  const [[row]] = await pool.query('SELECT * FROM presencas_estagiario WHERE id = ?', [ins.insertId]);
  return presencaFromRow(row);
}

// remove unused import if any - rowDataParaYmd was imported in clinicService - I imported rowDataParaYmd from clinicaRules in clinicService but didn't use directly - remove