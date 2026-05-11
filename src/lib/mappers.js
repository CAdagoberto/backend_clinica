import { rowDataParaYmd } from './clinicaRules.js';

export function usuarioFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    tipo: r.tipo,
    matricula: r.matricula || undefined,
    nivelEstagio: r.nivel_estagio != null ? r.nivel_estagio : undefined,
    ativo: r.ativo != null ? Boolean(r.ativo) : undefined,
    responsavelEstagiarioId: r.responsavel_estagiario_id ?? undefined,
    telefone: r.telefone || '',
    regiao: r.regiao || '',
    prontuario: r.prontuario || '',
    menorDeIdade: Boolean(r.menor_de_idade),
    responsavelLegalNome: r.responsavel_legal_nome || '',
    responsavelLegalTelefone: r.responsavel_legal_telefone || '',
  };
}

export function salaFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    nome: r.nome,
    status: r.status,
    tipo: r.tipo,
    restricaoConsultorio: Boolean(r.restricao_consultorio),
  };
}

export function consultaBaseFromRow(r) {
  return {
    id: r.id,
    pacienteId: r.paciente_id,
    estagiarioId: r.estagiario_id,
    salaId: r.sala_id,
    data: rowDataParaYmd(r.data_agenda),
    horario: r.horario,
    status: r.status,
    pacoteId: r.pacote_id != null ? r.pacote_id : null,
    sessaoNumero: r.sessao_numero != null ? r.sessao_numero : null,
    duracaoMinutos: r.duracao_minutos,
  };
}

export function encaminhamentoFromRow(r) {
  return {
    id: r.id,
    pacienteId: r.paciente_id,
    tipo: r.tipo,
    destino: r.destino,
    observacao: r.observacao,
    criadoPorId: r.criado_por_id,
    criadoEm: rowDataParaYmd(r.criado_em),
  };
}

export function avaliacaoFromRow(r) {
  return {
    id: r.id,
    tipo: r.tipo,
    nota: r.nota,
    comentario: r.comentario,
    autorId: r.autor_id,
    estagiarioId: r.estagiario_id,
    criadaEm: rowDataParaYmd(r.criada_em),
  };
}

export function notificacaoFromRow(r) {
  return {
    id: r.id,
    usuarioId: r.usuario_id,
    titulo: r.titulo,
    corpo: r.corpo,
    criadaEm: rowDataParaYmd(r.criada_em),
    lida: Boolean(r.lida),
  };
}

export function presencaFromRow(r) {
  return {
    id: r.id,
    estagiarioId: r.estagiario_id,
    data: rowDataParaYmd(r.data_presenca),
    horarioChegada: r.horario_chegada,
  };
}
