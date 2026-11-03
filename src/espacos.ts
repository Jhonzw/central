// Espaço = uma empresa ou uma vida (pessoal, cada empresa, freelas). Tudo de
// trabalho pertence a um espaço, e as telas nunca misturam dado de dois.

import { type Banco, agora, emTransacao, registrar, texto, ErroDeEntrada } from './db.ts';

export type Espaco = { id: string; nome: string; cor: string; ordem: number; arquivado: number };

export function listar(db: Banco, { comArquivados = false } = {}): Espaco[] {
  return db.prepare(`SELECT id, nome, cor, ordem, arquivado FROM espacos ${comArquivados ? '' : 'WHERE arquivado = 0'} ORDER BY ordem, nome`)
    .all() as Espaco[];
}

export function obter(db: Banco, id: string): Espaco {
  const e = db.prepare('SELECT id, nome, cor, ordem, arquivado FROM espacos WHERE id = ?').get(id) as Espaco | undefined;
  if (!e) throw new ErroDeEntrada(`espaço ${id} não existe`, 404);
  return e;
}

const validarId = (id: unknown): string => {
  const s = String(id ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(s)) throw new ErroDeEntrada('id do espaço: 2 a 30 letras minúsculas, números ou hífen');
  return s;
};
const validarCor = (c: unknown): string => {
  const s = String(c ?? '#0e5a55');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new ErroDeEntrada('cor no formato #rrggbb');
  return s;
};

// Cria ou atualiza. Espaço não se apaga: arquiva (as tarefas antigas continuam apontando para ele).
export function salvar(db: Banco, dados: Record<string, unknown>): Espaco {
  const id = validarId(dados.id);
  return emTransacao(db, () => {
    const existe = db.prepare('SELECT id FROM espacos WHERE id = ?').get(id);
    const nome = texto(dados.nome, 'nome', 60);
    const cor = validarCor(dados.cor);
    const ordem = Number.isInteger(dados.ordem) ? Number(dados.ordem) : 0;
    const arquivado = dados.arquivado ? 1 : 0;
    if (existe) db.prepare('UPDATE espacos SET nome = ?, cor = ?, ordem = ?, arquivado = ? WHERE id = ?').run(nome, cor, ordem, arquivado, id);
    else db.prepare('INSERT INTO espacos (id, nome, cor, ordem, arquivado, criado) VALUES (?, ?, ?, ?, ?, ?)').run(id, nome, cor, ordem, arquivado, agora());
    registrar(db, 'espacos', id, existe ? 'alterou' : 'criou', { nome, cor, ordem, arquivado });
    return obter(db, id);
  });
}

// Na primeira subida, cria os espaços do config/local.json que ainda não existem.
export function semear(db: Banco, lista: Array<Record<string, unknown>>): void {
  lista.forEach((e, i) => {
    if (!db.prepare('SELECT 1 FROM espacos WHERE id = ?').get(String(e.id))) salvar(db, { ordem: i, ...e });
  });
}
