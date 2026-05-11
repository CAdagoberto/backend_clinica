export const DURACAO_SESSAO_MINUTOS = 50;

function parseYmd(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(date) {
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function addSemanasYmd(dataStr, semanas) {
  const dt = parseYmd(dataStr);
  dt.setDate(dt.getDate() + semanas * 7);
  return formatYmd(dt);
}

/** 0=dom … 6=sáb */
export function diaSemana(dataStr) {
  return parseYmd(dataStr).getDay();
}

export function horaMinutos(horario) {
  const [h, m = 0] = horario.split(':').map(Number);
  return h * 60 + m;
}

export function rowDataParaYmd(v) {
  if (!v) return '';
  if (v instanceof Date) return formatYmd(v);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * Consultórios 1 e 2: terça 13–16h, quarta e sexta 13–18h (alinhado ao mock).
 */
export function validarHorarioConsultorioRestrito(sala, dataStr, horario) {
  if (!sala?.restricaoConsultorio) return null;
  const dow = diaSemana(dataStr);
  const minutos = horaMinutos(horario);

  if (dow !== 2 && dow !== 3 && dow !== 5) {
    return 'Consultórios 1 e 2: agendamento apenas às terças, quartas ou sextas-feiras.';
  }

  if (dow === 2) {
    if (minutos < 13 * 60 || minutos >= 16 * 60) {
      return 'Consultórios 1 e 2: às terças-feiras, horário permitido das 13h às 16h.';
    }
  }
  if (dow === 3 || dow === 5) {
    if (minutos < 13 * 60 || minutos >= 18 * 60) {
      return 'Consultórios 1 e 2: às quartas e sextas-feiras, horário permitido das 13h às 18h.';
    }
  }
  return null;
}

export function maxPacientesPorNivel(nivel) {
  if (nivel === 1) return 2;
  return 3;
}

export function statusPacientePorConsultaStatus(statusConsulta) {
  if (statusConsulta === 'confirmado') return 'sessão confirmada';
  if (statusConsulta === 'cancelado') return 'cancelado';
  return 'aguardando atendimento';
}
