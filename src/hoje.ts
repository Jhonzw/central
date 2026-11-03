// O dia juntando todos os espaços: o que venceu ou vence hoje nas tarefas,
// as conversas que pedem resposta e o que cada fonte diz que pede ação. Cada
// espaço vem separado.

import type { Banco } from './db.ts';
import { listar as listarEspacos } from './espacos.ts';
import { listar as listarTarefas, type Tarefa } from './tarefas.ts';
import { pendentesPorEspaco } from './caixa.ts';
import { ler, type ConfigConector, type Leitura } from './conectores/index.ts';

export function hojeLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export async function montarHoje(db: Banco, conectores: ConfigConector[], { forcar = false } = {}) {
  const hoje = hojeLocal();
  const leituras = await Promise.all(conectores.map((c) => ler(c, db, forcar)));
  const conversas = pendentesPorEspaco(db);
  const espacos = listarEspacos(db).map((e) => {
    const abertas = listarTarefas(db, { espaco: e.id });
    return {
      espaco: e,
      vencidas: abertas.filter((t: Tarefa) => !!t.proxima && t.proxima < hoje),
      deHoje: abertas.filter((t) => t.proxima === hoje),
      abertas: abertas.length,
      semData: abertas.filter((t) => !t.proxima).length,
      conversas: conversas[e.id] ?? { responder: 0, esperando: 0, primeiras: [] },
      fontes: leituras.filter((l: Leitura) => l.espaco === e.id),
    };
  });
  return { hoje, espacos };
}
