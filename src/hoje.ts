// O dia juntando todos os espaços: o que venceu ou vence hoje nas tarefas,
// as conversas que pedem resposta e o que cada fonte diz que pede ação. Cada
// espaço vem separado.

import type { Banco } from './db.ts';
import { listar as listarEspacos } from './espacos.ts';
import { listar as listarTarefas } from './tarefas.ts';
import { listar as listarProjetos } from './projetos.ts';
import { pendentesPorEspaco, listar as listarConversas } from './caixa.ts';
import { ler, type ConfigConector, type Leitura } from './conectores/index.ts';

export function hojeLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export async function montarHoje(db: Banco, conectores: ConfigConector[], { forcar = false } = {}) {
  const hoje = hojeLocal();
  const instante = new Date().toISOString();
  const leituras = await Promise.all(conectores.map((c) => ler(c, db, forcar)));
  const conversas = pendentesPorEspaco(db);
  const espacos = listarEspacos(db).map((e) => {
    const abertas = listarTarefas(db, { espaco: e.id });
    const vencidas = abertas.filter(
      (t) => (!!t.proxima && t.proxima < hoje) || (!!t.prazo && t.prazo < hoje),
    );
    const lembretes = abertas.filter((t) => !!t.lembrete && t.lembrete <= instante);
    const destacados = new Set([...vencidas, ...lembretes].map((t) => t.id));
    return {
      espaco: e,
      projetos: listarProjetos(db, { espaco: e.id }),
      cobrancas: listarConversas(db, { espaco: e.id, estado: 'cobrar' }),
      vencidas,
      lembretes,
      deHoje: abertas.filter((t) => !destacados.has(t.id) && (t.proxima === hoje || t.prazo === hoje)),
      abertas: abertas.length,
      semData: abertas.filter((t) => !t.proxima).length,
      conversas: conversas[e.id] ?? { responder: 0, esperando: 0, primeiras: [] },
      fontes: leituras.filter((l: Leitura) => l.espaco === e.id),
    };
  });
  return { hoje, espacos };
}
