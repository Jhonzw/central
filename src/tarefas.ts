// Tarefas de cada espaço, com status, com quem está, próxima cobrança e
// anotações datadas. É o acompanhamento dos chamados, valendo para qualquer coisa.

import { type Banco, agora, emTransacao, registrar, texto, ErroDeEntrada } from './db.ts';
import { obter as obterEspaco } from './espacos.ts';

export const STATUS = ['a-fazer', 'fazendo', 'aguardando', 'feito', 'cancelado'];
export const ABERTOS = ['a-fazer', 'fazendo', 'aguardando'];

export type Anotacao = { id: number; texto: string; em: string };
export type Tarefa = {
  id: number; espaco_id: string; titulo: string; status: string; pessoa_id: number | null; pessoa_nome: string | null;
  proxima: string | null; origem: string; criado: string; atualizado: string; concluido: string | null; anotacoes: Anotacao[];
};

const SELECT = `SELECT t.id, t.espaco_id, t.titulo, t.status, t.pessoa_id, p.nome pessoa_nome, t.proxima, t.origem,
  t.criado, t.atualizado, t.concluido FROM tarefas t LEFT JOIN pessoas p ON p.id = t.pessoa_id`;

function montar(db: Banco, linha: Record<string, unknown>): Tarefa {
  return { ...(linha as Omit<Tarefa, 'anotacoes'>), anotacoes: db.prepare('SELECT id, texto, em FROM anotacoes WHERE tarefa_id = ? ORDER BY em DESC, id DESC').all(linha.id) as Anotacao[] };
}

export function obter(db: Banco, id: number | bigint): Tarefa {
  const t = db.prepare(`${SELECT} WHERE t.id = ?`).get(id);
  if (!t) throw new ErroDeEntrada(`tarefa ${id} não existe`, 404);
  return montar(db, t);
}

export function listar(db: Banco, { espaco, abertas = true, pessoa }: { espaco?: string; abertas?: boolean; pessoa?: number } = {}): Tarefa[] {
  const f: string[] = [];
  const a: Array<string | number> = [];
  if (espaco) { f.push('t.espaco_id = ?'); a.push(espaco); }
  if (abertas) { f.push(`t.status IN (${ABERTOS.map(() => '?').join(',')})`); a.push(...ABERTOS); }
  if (pessoa) { f.push('t.pessoa_id = ?'); a.push(pessoa); }
  // Sem data por último; entre as com data, a mais antiga primeiro.
  return db.prepare(`${SELECT} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY t.proxima IS NULL, t.proxima, t.atualizado DESC LIMIT 1000`)
    .all(...a).map((t) => montar(db, t));
}

const data = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new ErroDeEntrada('data no formato AAAA-MM-DD');
  return String(v);
};

export function criar(db: Banco, dados: Record<string, unknown>): Tarefa {
  return emTransacao(db, () => {
    const espaco = obterEspaco(db, String(dados.espaco_id ?? '')).id;
    const status = dados.status === undefined ? 'a-fazer' : String(dados.status);
    if (!STATUS.includes(status)) throw new ErroDeEntrada(`status inválido: ${status}`);
    const pessoa = pessoaDoEspaco(db, dados.pessoa_id, espaco);
    const r = db.prepare('INSERT INTO tarefas (espaco_id, titulo, status, pessoa_id, proxima, origem, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(espaco, texto(dados.titulo, 'título', 200), status, pessoa, data(dados.proxima), texto(dados.origem, 'origem', 200, false), agora(), agora());
    const nota = texto(dados.nota, 'anotação', 4000, false);
    if (nota) db.prepare('INSERT INTO anotacoes (tarefa_id, texto, em) VALUES (?, ?, ?)').run(r.lastInsertRowid, nota, agora());
    const t = obter(db, r.lastInsertRowid);
    registrar(db, 'tarefas', t.id, 'criou', t);
    return t;
  });
}

// A pessoa da tarefa tem de estar ligada ao mesmo espaço: é o que impede
// um contato de uma empresa de aparecer amarrado em tarefa de outra.
function pessoaDoEspaco(db: Banco, v: unknown, espaco: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const id = Number(v);
  if (!db.prepare('SELECT 1 FROM pessoa_espaco WHERE pessoa_id = ? AND espaco_id = ?').get(id, espaco))
    throw new ErroDeEntrada(`a pessoa #${id} não está neste espaço`);
  return id;
}

export function alterar(db: Banco, id: number, dados: Record<string, unknown>): Tarefa {
  return emTransacao(db, () => {
    const t = obter(db, id);
    const novo = { ...t };
    if ('titulo' in dados) novo.titulo = texto(dados.titulo, 'título', 200);
    if ('status' in dados) {
      if (!STATUS.includes(String(dados.status))) throw new ErroDeEntrada(`status inválido: ${dados.status}`);
      novo.status = String(dados.status);
    }
    if ('pessoa_id' in dados) novo.pessoa_id = pessoaDoEspaco(db, dados.pessoa_id, t.espaco_id);
    if ('proxima' in dados) novo.proxima = data(dados.proxima);
    const fechou = !ABERTOS.includes(novo.status);
    const concluido = fechou ? (t.concluido ?? agora()) : null;
    db.prepare('UPDATE tarefas SET titulo = ?, status = ?, pessoa_id = ?, proxima = ?, concluido = ?, atualizado = ? WHERE id = ?')
      .run(novo.titulo, novo.status, novo.pessoa_id, novo.proxima, concluido, agora(), id);
    const nota = texto(dados.nota, 'anotação', 4000, false);
    if (nota) db.prepare('INSERT INTO anotacoes (tarefa_id, texto, em) VALUES (?, ?, ?)').run(id, nota, agora());
    if (dados.apagarAnotacao) db.prepare('DELETE FROM anotacoes WHERE id = ? AND tarefa_id = ?').run(Number(dados.apagarAnotacao), id);
    const r = obter(db, id);
    registrar(db, 'tarefas', id, 'alterou', { de: t, para: r });
    return r;
  });
}
