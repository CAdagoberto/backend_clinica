import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as svc from '../services/clinicService.js';

export const apiRouter = Router();

/** Cabeçalhos opcionais de contexto para cadastro: X-Ator-Tipo (admin|estagiario), X-Ator-Id (number). */
function contextoCadastro(req) {
  return {
    atorTipo: req.headers['x-ator-tipo'] || '',
    atorId: Number(req.headers['x-ator-id']) || 0,
  };
}

function bad(msg, status = 400) {
  const e = new Error(msg);
  e.statusCode = status;
  return e;
}

apiRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body || {};
    if (!email || !senha) throw bad('Informe email e senha.');
    const usuario = await svc.login(email, senha);
    res.json(usuario);
  })
);

/** Cadastro (admin/estagiário): envie X-Ator-Tipo e X-Ator-Id. */
apiRouter.post(
  '/cadastro',
  asyncHandler(async (req, res) => {
    const novo = req.body || {};
    const usuario = await svc.cadastrarUsuario(novo, contextoCadastro(req));
    res.status(201).json(usuario);
  })
);

apiRouter.get(
  '/estagiarios',
  asyncHandler(async (req, res) => {
    const list = await svc.getEstagiarios(req.query.filtroNome ?? '');
    res.json(list);
  })
);

apiRouter.get(
  '/pacientes',
  asyncHandler(async (req, res) => {
    const list = await svc.getPacientes(req.query.estagiarioId ?? null);
    res.json(list);
  })
);

apiRouter.get(
  '/pacientes/com-status',
  asyncHandler(async (req, res) => {
    const list = await svc.getPacientesComStatus(req.query.estagiarioId ?? null);
    res.json(list);
  })
);

apiRouter.get(
  '/pacientes/:pacienteId/prontuario',
  asyncHandler(async (req, res) => {
    const data = await svc.getProntuarioPaciente(req.params.pacienteId);
    res.json(data);
  })
);

apiRouter.get(
  '/consultas/usuario/:userId',
  asyncHandler(async (req, res) => {
    const list = await svc.getConsultasByUsuario(Number(req.params.userId));
    res.json(list);
  })
);

apiRouter.get(
  '/consultas/disponiveis',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getConsultasDisponiveis());
  })
);

apiRouter.get(
  '/consultas/:consultaId',
  asyncHandler(async (req, res) => {
    res.json(await svc.getConsultaById(Number(req.params.consultaId)));
  })
);

apiRouter.patch(
  '/consultas/:consultaId/check-in',
  asyncHandler(async (req, res) => {
    res.json(await svc.fazerCheckIn(Number(req.params.consultaId)));
  })
);

apiRouter.patch(
  '/consultas/:consultaId/status',
  asyncHandler(async (req, res) => {
    const { novoStatus } = req.body || {};
    if (!novoStatus) throw bad('Informe novoStatus.');
    res.json(await svc.atualizarStatusConsulta(Number(req.params.consultaId), novoStatus));
  })
);

apiRouter.get(
  '/consultas/:consultaId/relatorio',
  asyncHandler(async (req, res) => {
    res.json(await svc.getRelatorioConsulta(Number(req.params.consultaId)));
  })
);

apiRouter.put(
  '/consultas/:consultaId/relatorio',
  asyncHandler(async (req, res) => {
    const { texto, autorId } = req.body || {};
    res.json(await svc.salvarRelatorioConsulta({ consultaId: Number(req.params.consultaId), texto, autorId }));
  })
);

apiRouter.get(
  '/notificacoes/:usuarioId',
  asyncHandler(async (req, res) => {
    res.json(await svc.getNotificacoes(Number(req.params.usuarioId)));
  })
);

apiRouter.patch(
  '/notificacoes/:notificacaoId/lida',
  asyncHandler(async (req, res) => {
    const { usuarioId } = req.body || {};
    if (usuarioId == null) throw bad('Informe usuarioId no body.');
    res.json(await svc.marcarNotificacaoLida(Number(req.params.notificacaoId), Number(usuarioId)));
  })
);

apiRouter.get(
  '/encaminhamentos',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getEncaminhamentosTodos());
  })
);

apiRouter.get(
  '/encaminhamentos/paciente/:pacienteId',
  asyncHandler(async (req, res) => {
    res.json(await svc.getEncaminhamentosPorPaciente(Number(req.params.pacienteId)));
  })
);

apiRouter.get(
  '/encaminhamentos/estagiario/:estagiarioId',
  asyncHandler(async (req, res) => {
    res.json(await svc.getEncaminhamentosDoEstagiario(Number(req.params.estagiarioId)));
  })
);

apiRouter.post(
  '/encaminhamentos',
  asyncHandler(async (req, res) => {
    const item = await svc.criarEncaminhamento(req.body || {});
    res.status(201).json(item);
  })
);

apiRouter.get(
  '/avaliacoes',
  asyncHandler(async (req, res) => {
    const usuarioId = Number(req.query.usuarioId);
    const papel = req.query.papel || '';
    if (!papel) throw bad('Informe query papel (admin|estagiario|paciente) e usuarioId quando aplicável.');
    res.json(await svc.getAvaliacoes({ usuarioId, papel }));
  })
);

apiRouter.post(
  '/avaliacoes',
  asyncHandler(async (req, res) => {
    const item = await svc.registrarAvaliacao(req.body || {});
    res.status(201).json(item);
  })
);

apiRouter.get(
  '/salas',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getSalas());
  })
);

apiRouter.get(
  '/salas/atendimento',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getSalasAtendimento());
  })
);

apiRouter.patch(
  '/salas/:salaId/status',
  asyncHandler(async (req, res) => {
    const { novoStatus } = req.body || {};
    if (!novoStatus) throw bad('Informe novoStatus.');
    res.json(await svc.atualizarStatusSala(Number(req.params.salaId), novoStatus));
  })
);

apiRouter.post(
  '/consultas',
  asyncHandler(async (req, res) => {
    const c = await svc.criarConsulta(req.body || {});
    res.status(201).json(c);
  })
);

apiRouter.post(
  '/consultas/pacote',
  asyncHandler(async (req, res) => {
    const list = await svc.agendarPacoteDeSessoes(req.body || {});
    res.status(201).json(list);
  })
);

apiRouter.get(
  '/usuarios',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getUsuarios());
  })
);

apiRouter.get(
  '/admin/consultas',
  asyncHandler(async (req, res) => {
    const status = req.query.status || null;
    res.json(await svc.getConsultasAdmin({ status }));
  })
);

apiRouter.get(
  '/admin/stats',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getStatsAdmin());
  })
);

apiRouter.get(
  '/admin/alertas',
  asyncHandler(async (_req, res) => {
    res.json(await svc.getAlertasAdmin());
  })
);

apiRouter.get(
  '/admin/estagiarios-carga',
  asyncHandler(async (req, res) => {
    res.json(
      await svc.getEstagiariosComConsultas({
        filtroNome: req.query.filtroNome ?? '',
        filtro: req.query.filtro ?? null,
      })
    );
  })
);

apiRouter.get(
  '/presencas/:estagiarioId',
  asyncHandler(async (req, res) => {
    res.json(await svc.getPresencasEstagiario(Number(req.params.estagiarioId)));
  })
);

apiRouter.post(
  '/presencas/:estagiarioId',
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.registrarPresencaEstagiario(Number(req.params.estagiarioId)));
  })
);
