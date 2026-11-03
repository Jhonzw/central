// Pessoas e os canais de cada uma. Uma pessoa pode estar em mais de um
// espaço; a tela de um espaço só mostra quem está ligado a ele.

import { type Banco, agora, emTransacao, registrar, texto, ErroDeEntrada } from './db.ts';
import { obter as obterEspaco } from './espacos.ts';

export type Canal = { id: number; tipo: string; valor: string };
export type Pessoa = { id: number; nome: string; notas: string; espacos: Array<{ id: string; papel: string }>; canais: Canal[] };

const TIPOS = ['email', 'whatsapp', 'telefone', 'outro'];

// E-mail em minúsculas; telefone e WhatsApp só com dígitos e DDI 55 quando
// vier sem (número brasileiro de 10 ou 11 dígitos).
export function normalizarCanal(tipo: string, valor: unknown): string {
  const v = String(valor ?? '').trim();
  if (tipo === 'email') {
    const e = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ErroDeEntrada(`e-mail inválido: ${v}`);
    return e;
  }
  if (tipo === 'whatsapp' || tipo === 'telefone') {
    let d = v.replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.length < 12 || d.length > 15) throw new ErroDeEntrada(`telefone inválido: ${v}`);
    return d;
  }
  return texto(v, 'canal', 200);
}

function montar(db: Banco, id: number | bigint): Pessoa {
  const p = db.prepare('SELECT id, nome, notas FROM pessoas WHERE id = ?').get(id) as { id: number; nome: string; notas: string } | undefined;
  if (!p) throw new ErroDeEntrada(`pessoa ${id} não existe`, 404);
  return {
    ...p,
    espacos: db.prepare('SELECT espaco_id id, papel FROM pessoa_espaco WHERE pessoa_id = ? ORDER BY espaco_id').all(id) as Pessoa['espacos'],
    canais: db.prepare('SELECT id, tipo, valor FROM canais WHERE pessoa_id = ? ORDER BY tipo, valor').all(id) as Canal[],
  };
}
export const obter = montar;

export function listar(db: Banco, { espaco, q }: { espaco?: string; q?: string } = {}): Pessoa[] {
  const filtros: string[] = [];
  const args: string[] = [];
  if (espaco) { filtros.push('EXISTS (SELECT 1 FROM pessoa_espaco pe WHERE pe.pessoa_id = p.id AND pe.espaco_id = ?)'); args.push(espaco); }
  if (q) {
    const termo = `%${q.trim().toLowerCase()}%`;
    const digitos = q.replace(/\D/g, '');
    filtros.push(`(lower(p.nome) LIKE ? OR EXISTS (SELECT 1 FROM canais c WHERE c.pessoa_id = p.id AND (c.valor LIKE ?${digitos.length >= 4 ? ' OR c.valor LIKE ?' : ''})))`);
    args.push(termo, termo);
    if (digitos.length >= 4) args.push(`%${digitos}%`);
  }
  const ids = db.prepare(`SELECT id FROM pessoas p ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''} ORDER BY nome LIMIT 500`).all(...args);
  return ids.map((r) => montar(db, Number(r.id)));
}

// Cria ou atualiza nome/notas/espaços/canais de uma vez. Canal que já é de
// outra pessoa é recusado: é sinal de cadastro duplicado, que a pessoa resolve.
export function salvar(db: Banco, dados: Record<string, unknown>, id?: number): Pessoa {
  return emTransacao(db, () => {
    const nome = texto(dados.nome, 'nome', 120);
    const notas = texto(dados.notas, 'notas', 4000, false);
    let pid: number | bigint;
    if (id) {
      montar(db, id);
      db.prepare('UPDATE pessoas SET nome = ?, notas = ?, atualizado = ? WHERE id = ?').run(nome, notas, agora(), id);
      pid = id;
    } else {
      pid = db.prepare('INSERT INTO pessoas (nome, notas, criado, atualizado) VALUES (?, ?, ?, ?)').run(nome, notas, agora(), agora()).lastInsertRowid;
    }
    if (Array.isArray(dados.espacos)) {
      db.prepare('DELETE FROM pessoa_espaco WHERE pessoa_id = ?').run(pid);
      for (const e of dados.espacos as Array<Record<string, unknown> | string>) {
        const eid = typeof e === 'string' ? e : String(e.id);
        obterEspaco(db, eid);
        db.prepare('INSERT OR IGNORE INTO pessoa_espaco (pessoa_id, espaco_id, papel) VALUES (?, ?, ?)')
          .run(pid, eid, typeof e === 'string' ? '' : texto(e.papel, 'papel', 60, false));
      }
    }
    if (Array.isArray(dados.canais)) {
      db.prepare('DELETE FROM canais WHERE pessoa_id = ?').run(pid);
      for (const c of dados.canais as Array<Record<string, unknown>>) {
        const tipo = String(c.tipo);
        if (!TIPOS.includes(tipo)) throw new ErroDeEntrada(`tipo de canal inválido: ${tipo}`);
        const valor = normalizarCanal(tipo, c.valor);
        const dono = db.prepare('SELECT pessoa_id FROM canais WHERE tipo = ? AND valor = ?').get(tipo, valor);
        if (dono) throw new ErroDeEntrada(`${valor} já é de outra pessoa (#${dono.pessoa_id})`, 409);
        db.prepare('INSERT INTO canais (pessoa_id, tipo, valor) VALUES (?, ?, ?)').run(pid, tipo, valor);
      }
    }
    const p = montar(db, pid);
    registrar(db, 'pessoas', pid, id ? 'alterou' : 'criou', p);
    return p;
  });
}

export function apagar(db: Banco, id: number): void {
  emTransacao(db, () => {
    const p = montar(db, id);
    db.prepare('DELETE FROM pessoas WHERE id = ?').run(id);
    registrar(db, 'pessoas', id, 'apagou', p);
  });
}
