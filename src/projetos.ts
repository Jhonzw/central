import {
  type Banco,
  agora,
  emTransacao,
  registrar,
  texto,
  ErroDeEntrada,
  conferirVersao,
  data,
} from './db.ts';
import { obter as espaco } from './espacos.ts';
export const STATUS = ['ativo', 'pausado', 'concluido', 'arquivado'];
export type Projeto = {
  id: number;
  espaco_id: string;
  nome: string;
  objetivo: string;
  status: string;
  proxima_acao: string;
  prazo: string | null;
  notas: string;
  versao: number;
  criado: string;
  atualizado: string;
};
export function obter(db: Banco, id: number | bigint): Projeto {
  const p = db.prepare('SELECT * FROM projetos WHERE id=?').get(id);
  if (!p) throw new ErroDeEntrada(`projeto ${id} não existe`, 404);
  return p as Projeto;
}
export function listar(
  db: Banco,
  { espaco: e, todos = false }: { espaco?: string; todos?: boolean } = {},
): Projeto[] {
  return db
    .prepare(
      `SELECT * FROM projetos WHERE (? IS NULL OR espaco_id=?) ${todos ? '' : "AND status='ativo'"} ORDER BY atualizado DESC,id DESC`,
    )
    .all(e ?? null, e ?? null) as Projeto[];
}
export function validarVinculo(db: Banco, v: unknown, e: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const p = obter(db, Number(v));
  if (p.espaco_id !== e) throw new ErroDeEntrada('projeto deve pertencer ao mesmo espaço');
  if (p.status !== 'ativo') throw new ErroDeEntrada('projeto deve estar ativo', 409);
  return p.id;
}
export function criar(db: Banco, d: Record<string, unknown>): Projeto {
  return emTransacao(db, () => {
    const e = espaco(db, String(d.espaco_id ?? '')).id;
    const status = String(d.status ?? 'ativo');
    if (!STATUS.includes(status)) throw new ErroDeEntrada('status de projeto inválido');
    const r = db
      .prepare(
        'INSERT INTO projetos(espaco_id,nome,objetivo,status,proxima_acao,prazo,notas,criado,atualizado) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        e,
        texto(d.nome, 'nome', 200),
        texto(d.objetivo, 'objetivo', 4000, false),
        status,
        texto(d.proxima_acao, 'próxima ação', 1000, false),
        data(d.prazo),
        texto(d.notas, 'notas', 8000, false),
        agora(),
        agora(),
      );
    const p = obter(db, r.lastInsertRowid);
    registrar(db, 'projetos', p.id, 'criou', p);
    return p;
  });
}
export function alterar(db: Banco, id: number, d: Record<string, unknown>): Projeto {
  return emTransacao(db, () => {
    const p = obter(db, id);
    conferirVersao(p.versao, d.versao);
    const n = { ...p };
    if ('espaco_id' in d && d.espaco_id !== p.espaco_id)
      throw new ErroDeEntrada('O espaço do projeto não pode ser alterado.', 409);
    for (const [k, max] of [
      ['nome', 200],
      ['objetivo', 4000],
      ['proxima_acao', 1000],
      ['notas', 8000],
    ] as const)
      if (k in d) n[k] = texto(d[k], k, max, k === 'nome');
    if ('status' in d) {
      if (!STATUS.includes(String(d.status))) throw new ErroDeEntrada('status de projeto inválido');
      n.status = String(d.status);
    }
    if ('prazo' in d) n.prazo = data(d.prazo);
    if (['concluido', 'arquivado'].includes(n.status)) {
      const abertas = Number(
        db
          .prepare(
            "SELECT count(*) n FROM tarefas WHERE projeto_id=? AND status IN('a-fazer','fazendo','aguardando')",
          )
          .get(id)?.n ?? 0,
      );
      if (abertas)
        throw new ErroDeEntrada(
          `Resolva ${abertas} tarefa(s) aberta(s) antes de concluir ou arquivar o projeto.`,
          409,
        );
    }
    db.prepare(
      'UPDATE projetos SET nome=?,objetivo=?,status=?,proxima_acao=?,prazo=?,notas=?,versao=versao+1,atualizado=? WHERE id=?',
    ).run(n.nome, n.objetivo, n.status, n.proxima_acao, n.prazo, n.notas, agora(), id);
    const r = obter(db, id);
    registrar(db, 'projetos', id, 'alterou', { de: p, para: r });
    return r;
  });
}
