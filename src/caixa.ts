// A caixa: conversas de e-mail e WhatsApp, cada uma num espaço, com estado
// (responder / esperando / resolvida / arquivada) e nota interna. Nada aqui
// fala com o e-mail ou com o WhatsApp: mudar o estado ou anotar só muda a
// Central, nunca a caixa de verdade.
//
// A mensagem que chega não vai para `alteracoes` (o histórico é das ações do
// dono). Assim a retenção, que apaga o texto velho, apaga de verdade.

import { type Banco, agora, emTransacao, registrar, texto, ErroDeEntrada } from './db.ts';
import { obter as obterConta } from './contas.ts';
import { obter as obterEspaco } from './espacos.ts';
import { criar as criarTarefa } from './tarefas.ts';

export const ESTADOS = ['responder', 'esperando', 'resolvida', 'arquivada'];

export type Entrada = {
  conta: string; chave: string; titulo: string; endereco: string; autor: string;
  externo: string; de_mim: boolean; assunto?: string; texto: string; em: string;
};

// Celular brasileiro chega do WhatsApp às vezes sem o 9 (55 62 8xxx-xxxx).
// As duas formas valem para achar a pessoa.
export function variantesFone(d: string): string[] {
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, d.slice(0, 4) + '9' + d.slice(4)];
  return [d];
}

function normalizarEndereco(tipo: string, v: string): string {
  return tipo === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, '');
}

function acharPessoa(db: Banco, tipo: string, endereco: string): number | null {
  if (!endereco) return null;
  const r = tipo === 'email'
    ? db.prepare("SELECT pessoa_id FROM canais WHERE tipo = 'email' AND valor = ?").get(endereco)
    : db.prepare(`SELECT pessoa_id FROM canais WHERE tipo IN ('whatsapp', 'telefone') AND valor IN (${variantesFone(endereco).map(() => '?').join(',')}) LIMIT 1`)
      .get(...variantesFone(endereco));
  return r ? Number(r.pessoa_id) : null;
}

// A conversa vai para o espaço da pessoa quando ela está num espaço só; se a
// pessoa está no espaço da conta, ou em vários, fica no da conta.
function espacoPara(db: Banco, pessoa: number | null, padrao: string): string {
  if (!pessoa) return padrao;
  const es = db.prepare('SELECT espaco_id FROM pessoa_espaco WHERE pessoa_id = ?').all(pessoa).map((r) => String(r.espaco_id));
  return es.length === 1 ? es[0] : padrao;
}

export function receber(db: Banco, m: Entrada): { nova: boolean; conversa: number } {
  return emTransacao(db, () => {
    const conta = obterConta(db, m.conta);
    const endereco = normalizarEndereco(conta.tipo, String(m.endereco ?? '')).slice(0, 200);
    const em = new Date(m.em).toISOString();
    const chave = String(m.chave ?? '').slice(0, 300);
    const externo = String(m.externo ?? '').slice(0, 300);
    if (!chave || !externo) throw new ErroDeEntrada('mensagem sem chave ou id');
    let c = db.prepare('SELECT id, estado, ultima_em, titulo FROM conversas WHERE conta_id = ? AND chave = ?').get(conta.id, chave) as
      { id: number; estado: string; ultima_em: string; titulo: string } | undefined;
    if (!c) {
      const pessoa = acharPessoa(db, conta.tipo, endereco);
      const r = db.prepare('INSERT INTO conversas (conta_id, espaco_id, chave, titulo, endereco, pessoa_id, estado, ultima_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(conta.id, espacoPara(db, pessoa, conta.espaco_id), chave, String(m.titulo ?? '').slice(0, 200), endereco, pessoa, m.de_mim ? 'esperando' : 'responder', em);
      c = { id: Number(r.lastInsertRowid), estado: m.de_mim ? 'esperando' : 'responder', ultima_em: em, titulo: String(m.titulo ?? '') };
    }
    const ins = db.prepare('INSERT OR IGNORE INTO mensagens (conversa_id, externo, de_mim, autor, assunto, texto, em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, externo, m.de_mim ? 1 : 0, String(m.autor ?? '').slice(0, 200), String(m.assunto ?? '').slice(0, 300), String(m.texto ?? '').slice(0, 4000), em);
    if (!ins.changes) return { nova: false, conversa: c.id };
    if (em >= c.ultima_em) {
      // Respondi: fico esperando. Chegou coisa nova: volta para "responder",
      // mesmo se estava resolvida. Arquivada continua quieta.
      const estado = c.estado === 'arquivada' ? 'arquivada' : m.de_mim ? 'esperando' : 'responder';
      db.prepare('UPDATE conversas SET ultima_em = ?, estado = ?, titulo = CASE WHEN titulo = \'\' THEN ? ELSE titulo END WHERE id = ?')
        .run(em, estado, String(m.titulo ?? '').slice(0, 200), c.id);
    }
    return { nova: true, conversa: c.id };
  });
}

// Depois de cadastrar ou mudar canais: liga as conversas sem pessoa a quem tem
// aquele e-mail/número, e muda de espaço as que o dono não moveu à mão.
export function religar(db: Banco): number {
  let n = 0;
  emTransacao(db, () => {
    const soltas = db.prepare(`SELECT c.id, c.endereco, c.movida, c.espaco_id atual, ct.tipo, ct.espaco_id da_conta FROM conversas c
      JOIN contas ct ON ct.id = c.conta_id WHERE c.pessoa_id IS NULL AND c.endereco <> ''`).all() as
      Array<{ id: number; endereco: string; movida: number; atual: string; tipo: string; da_conta: string }>;
    for (const s of soltas) {
      const p = acharPessoa(db, s.tipo, s.endereco);
      if (!p) continue;
      db.prepare('UPDATE conversas SET pessoa_id = ?, espaco_id = ? WHERE id = ?').run(p, s.movida ? s.atual : espacoPara(db, p, s.da_conta), s.id);
      n++;
    }
  });
  return n;
}

const SELECT_CONVERSA = `SELECT c.id, c.conta_id, ct.nome conta_nome, ct.tipo canal, c.espaco_id, c.titulo, c.endereco, c.pessoa_id, p.nome pessoa_nome,
  c.estado, c.movida, c.nota, c.tarefa_id, c.ultima_em,
  (SELECT count(*) FROM mensagens m WHERE m.conversa_id = c.id) qtd,
  (SELECT json_object('autor', m.autor, 'de_mim', m.de_mim, 'assunto', m.assunto, 'texto', substr(m.texto, 1, 240), 'em', m.em)
     FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.em DESC, m.id DESC LIMIT 1) ultima
  FROM conversas c JOIN contas ct ON ct.id = c.conta_id LEFT JOIN pessoas p ON p.id = c.pessoa_id`;

const montar = (l: Record<string, unknown>) => ({ ...l, ultima: l.ultima ? JSON.parse(String(l.ultima)) : null });

export function listar(db: Banco, { espaco, estado, conta, limite = 200 }: { espaco?: string; estado?: string; conta?: string; limite?: number } = {}) {
  const f: string[] = [];
  const a: Array<string | number> = [];
  if (espaco) { f.push('c.espaco_id = ?'); a.push(espaco); }
  if (estado) {
    if (!ESTADOS.includes(estado)) throw new ErroDeEntrada(`estado inválido: ${estado}`);
    f.push('c.estado = ?'); a.push(estado);
  }
  if (conta) { f.push('c.conta_id = ?'); a.push(conta); }
  return db.prepare(`${SELECT_CONVERSA} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY c.ultima_em DESC LIMIT ?`).all(...a, Math.min(limite, 500)).map(montar);
}

export function obter(db: Banco, id: number) {
  const c = db.prepare(`${SELECT_CONVERSA} WHERE c.id = ?`).get(id);
  if (!c) throw new ErroDeEntrada(`conversa ${id} não existe`, 404);
  const mensagens = db.prepare('SELECT id, de_mim, autor, assunto, texto, em FROM mensagens WHERE conversa_id = ? ORDER BY em DESC, id DESC LIMIT 100').all(id).reverse();
  return { ...montar(c), mensagens };
}

export function alterar(db: Banco, id: number, dados: Record<string, unknown>) {
  return emTransacao(db, () => {
    const c = obter(db, id) as unknown as { espaco_id: string; estado: string; nota: string };
    const mud: Record<string, unknown> = {};
    if ('estado' in dados) {
      if (!ESTADOS.includes(String(dados.estado))) throw new ErroDeEntrada(`estado inválido: ${dados.estado}`);
      mud.estado = String(dados.estado);
    }
    if ('nota' in dados) mud.nota = texto(dados.nota, 'nota', 4000, false);
    if ('espaco_id' in dados) { mud.espaco_id = obterEspaco(db, String(dados.espaco_id)).id; mud.movida = 1; }
    if (!Object.keys(mud).length) throw new ErroDeEntrada('nada para mudar');
    db.prepare(`UPDATE conversas SET ${Object.keys(mud).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(mud) as string[]), id);
    registrar(db, 'conversas', id, 'alterou', { de: { estado: c.estado, espaco_id: c.espaco_id }, para: mud });
    return obter(db, id);
  });
}

// Vira tarefa no mesmo espaço da conversa, com a pessoa quando ela é do espaço.
export function virarTarefa(db: Banco, id: number, dados: Record<string, unknown>) {
  const c = obter(db, id) as unknown as { espaco_id: string; titulo: string; canal: string; pessoa_id: number | null; pessoa_nome: string | null; endereco: string };
  const daPessoa = c.pessoa_id && db.prepare('SELECT 1 FROM pessoa_espaco WHERE pessoa_id = ? AND espaco_id = ?').get(c.pessoa_id, c.espaco_id);
  const t = criarTarefa(db, {
    espaco_id: c.espaco_id,
    titulo: texto(dados.titulo || (c.canal === 'email' ? `Responder: ${c.titulo}` : `Responder ${c.pessoa_nome || c.titulo}`).slice(0, 200), 'título', 200),
    proxima: dados.proxima ?? null,
    pessoa_id: daPessoa ? c.pessoa_id : null,
    origem: `${c.canal === 'email' ? 'e-mail' : 'WhatsApp'} · conversa #${id}`,
  });
  emTransacao(db, () => {
    db.prepare('UPDATE conversas SET tarefa_id = ? WHERE id = ?').run(t.id, id);
    registrar(db, 'conversas', id, 'alterou', { tarefa_id: t.id });
  });
  return t;
}

// Para o Hoje: quantas pedem resposta em cada espaço e as mais antigas.
export function pendentesPorEspaco(db: Banco): Record<string, { responder: number; esperando: number; primeiras: unknown[] }> {
  const out: Record<string, { responder: number; esperando: number; primeiras: unknown[] }> = {};
  for (const r of db.prepare("SELECT espaco_id, estado, count(*) n FROM conversas WHERE estado IN ('responder', 'esperando') GROUP BY espaco_id, estado").all()) {
    const e = (out[String(r.espaco_id)] ??= { responder: 0, esperando: 0, primeiras: [] });
    e[r.estado as 'responder' | 'esperando'] = Number(r.n);
  }
  for (const [esp, e] of Object.entries(out)) {
    if (e.responder) e.primeiras = db.prepare(`${SELECT_CONVERSA} WHERE c.espaco_id = ? AND c.estado = 'responder' ORDER BY c.ultima_em LIMIT 5`).all(esp).map(montar);
  }
  return out;
}

// Retenção: o texto de mensagem mais velha que N dias é apagado (a busca junto).
// Fica o registro de que houve a conversa, com quem e quando.
export function reter(db: Banco, dias: number): number {
  const limite = new Date(Date.now() - dias * 864e5).toISOString();
  return Number(db.prepare("UPDATE mensagens SET texto = '' WHERE em < ? AND texto <> ''").run(limite).changes);
}

// Busca no que tem: mensagens (FTS), tarefas e pessoas.
export function buscar(db: Banco, q: string, { espaco }: { espaco?: string } = {}) {
  const termos = q.normalize('NFC').match(/[\p{L}\p{N}@._-]+/gu)?.slice(0, 8) ?? [];
  if (!termos.length) return { conversas: [], tarefas: [], pessoas: [] };
  const fts = termos.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
  const comEspaco = espaco ? ' AND c.espaco_id = ?' : '';
  const conversas = db.prepare(`SELECT c.id, c.espaco_id, ct.tipo canal, c.titulo, c.estado, c.ultima_em, p.nome pessoa_nome,
      snippet(mensagens_busca, 2, char(2), char(3), '…', 12) trecho, m.em
    FROM mensagens_busca JOIN mensagens m ON m.id = mensagens_busca.rowid JOIN conversas c ON c.id = m.conversa_id
    JOIN contas ct ON ct.id = c.conta_id LEFT JOIN pessoas p ON p.id = c.pessoa_id
    WHERE mensagens_busca MATCH ?${comEspaco} ORDER BY m.em DESC LIMIT 30`).all(fts, ...(espaco ? [espaco] : []));
  const like = `%${termos.join(' ').toLowerCase()}%`;
  const tarefas = db.prepare(`SELECT t.id, t.espaco_id, t.titulo, t.status, t.proxima FROM tarefas t
    WHERE (lower(t.titulo) LIKE ? OR EXISTS (SELECT 1 FROM anotacoes a WHERE a.tarefa_id = t.id AND lower(a.texto) LIKE ?))${espaco ? ' AND t.espaco_id = ?' : ''}
    ORDER BY t.atualizado DESC LIMIT 30`).all(like, like, ...(espaco ? [espaco] : []));
  const pessoas = db.prepare(`SELECT DISTINCT p.id, p.nome FROM pessoas p LEFT JOIN canais c ON c.pessoa_id = p.id
    WHERE (lower(p.nome) LIKE ? OR c.valor LIKE ?)${espaco ? ' AND EXISTS (SELECT 1 FROM pessoa_espaco pe WHERE pe.pessoa_id = p.id AND pe.espaco_id = ?)' : ''}
    ORDER BY p.nome LIMIT 30`).all(like, like, ...(espaco ? [espaco] : []));
  return { conversas, tarefas, pessoas };
}
