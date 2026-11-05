// A caixa: conversas de e-mail e WhatsApp, cada uma num espaço, com estado
// (responder / esperando / resolvida / arquivada) e nota interna. Nada aqui
// fala com o e-mail ou com o WhatsApp: mudar o estado ou anotar só muda a
// Central, nunca a caixa de verdade.
//
// A mensagem que chega não vai para `alteracoes` (o histórico é das ações do
// dono). Assim a retenção, que apaga o texto velho, apaga de verdade.

import {
  type Banco,
  agora,
  emTransacao,
  registrar,
  texto,
  ErroDeEntrada,
  conferirVersao,
  instante,
  data,
} from './db.ts';
import { obter as obterConta } from './contas.ts';
import { obter as obterEspaco } from './espacos.ts';
import { criar as criarTarefa, obter as obterTarefa } from './tarefas.ts';

export const ESTADOS = ['responder', 'esperando', 'resolvida', 'arquivada'];

export type Entrada = {
  conta: string;
  chave: string;
  titulo: string;
  endereco: string;
  autor: string;
  externo: string;
  de_mim: boolean;
  assunto?: string;
  texto: string;
  em: string;
  // Veio do histórico que o celular manda ao conectar: não deve encher a fila.
  historico?: boolean;
};

// Histórico: só pede resposta o que a outra pessoa mandou nas últimas 48 h.
// O resto entra resolvido (consultável e pesquisável, fora da fila do Hoje).
const RECENTE_HISTORICO = 48 * 36e5;
function estadoDe(m: Entrada, em: string): string {
  if (!m.historico) return m.de_mim ? 'esperando' : 'responder';
  if (m.de_mim || Date.now() - Date.parse(em) > RECENTE_HISTORICO) return 'resolvida';
  return 'responder';
}

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
  const r =
    tipo === 'email'
      ? db.prepare("SELECT pessoa_id FROM canais WHERE tipo = 'email' AND valor = ?").get(endereco)
      : db
          .prepare(
            `SELECT pessoa_id FROM canais WHERE tipo IN ('whatsapp', 'telefone') AND valor IN (${variantesFone(
              endereco,
            )
              .map(() => '?')
              .join(',')}) LIMIT 1`,
          )
          .get(...variantesFone(endereco));
  return r ? Number(r.pessoa_id) : null;
}

// A conversa vai para o espaço da pessoa quando ela está num espaço só; se a
// pessoa está no espaço da conta, ou em vários, fica no da conta.
function espacoPara(db: Banco, pessoa: number | null, padrao: string): string {
  if (!pessoa) return padrao;
  const es = db
    .prepare('SELECT espaco_id FROM pessoa_espaco WHERE pessoa_id = ?')
    .all(pessoa)
    .map((r) => String(r.espaco_id));
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
    let c = db
      .prepare(
        'SELECT id, estado, ultima_em, titulo, pendente_desde FROM conversas WHERE conta_id = ? AND chave = ?',
      )
      .get(conta.id, chave) as
      | { id: number; estado: string; ultima_em: string; titulo: string; pendente_desde?: string | null }
      | undefined;
    if (!c) {
      const pessoa = acharPessoa(db, conta.tipo, endereco);
      const r = db
        .prepare(
          'INSERT INTO conversas (conta_id, espaco_id, chave, titulo, endereco, pessoa_id, estado, ultima_em, pendente_desde) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          conta.id,
          espacoPara(db, pessoa, conta.espaco_id),
          chave,
          String(m.titulo ?? '').slice(0, 200),
          endereco,
          pessoa,
          estadoDe(m, em),
          em,
          em,
        );
      c = {
        id: Number(r.lastInsertRowid),
        estado: estadoDe(m, em),
        ultima_em: em,
        titulo: String(m.titulo ?? ''),
      };
    }
    const ins = db
      .prepare(
        'INSERT OR IGNORE INTO mensagens (conversa_id, externo, de_mim, autor, assunto, texto, em) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        c.id,
        externo,
        m.de_mim ? 1 : 0,
        String(m.autor ?? '').slice(0, 200),
        String(m.assunto ?? '').slice(0, 300),
        String(m.texto ?? '').slice(0, 4000),
        em,
      );
    if (!ins.changes) return { nova: false, conversa: c.id };
    if (em >= c.ultima_em) {
      const estado = estadoDe(m, em);
      const pendente = c.estado === estado ? (c.pendente_desde ?? em) : em;
      db.prepare(
        "UPDATE conversas SET ultima_em=?,estado=?,pendente_desde=?,visto_em=CASE WHEN ?=0 THEN NULL ELSE visto_em END,triada=CASE WHEN ?=0 THEN 0 ELSE triada END,adiada_ate=NULL,cobrar_em=CASE WHEN ?='responder' THEN NULL ELSE cobrar_em END,versao=versao+1,titulo=CASE WHEN titulo='' THEN ? ELSE titulo END WHERE id=?",
      ).run(
        em,
        estado,
        pendente,
        m.de_mim ? 1 : 0,
        m.de_mim ? 1 : 0,
        estado,
        String(m.titulo ?? '').slice(0, 200),
        c.id,
      );
    }
    return { nova: true, conversa: c.id };
  });
}

// Depois de cadastrar ou mudar canais: liga as conversas sem pessoa a quem tem
// aquele e-mail/número, e muda de espaço as que o dono não moveu à mão.
export function religar(db: Banco): number {
  let n = 0;
  emTransacao(db, () => {
    const soltas = db
      .prepare(
        `SELECT c.id, c.endereco, c.movida, c.espaco_id atual, ct.tipo, ct.espaco_id da_conta FROM conversas c
      JOIN contas ct ON ct.id = c.conta_id WHERE c.pessoa_id IS NULL AND c.endereco <> ''`,
      )
      .all() as Array<{
      id: number;
      endereco: string;
      movida: number;
      atual: string;
      tipo: string;
      da_conta: string;
    }>;
    for (const s of soltas) {
      const p = acharPessoa(db, s.tipo, s.endereco);
      if (!p) continue;
      db.prepare('UPDATE conversas SET pessoa_id = ?, espaco_id = ? WHERE id = ?').run(
        p,
        s.movida || db.prepare('SELECT 1 FROM vinculos WHERE conversa_id=?').get(s.id)
          ? s.atual
          : espacoPara(db, p, s.da_conta),
        s.id,
      );
      n++;
    }
  });
  return n;
}

const SELECT_CONVERSA = `SELECT c.id, c.conta_id, ct.nome conta_nome, ct.tipo canal, c.espaco_id, c.titulo, c.endereco, c.pessoa_id, p.nome pessoa_nome,
  c.estado, c.movida, c.nota, c.tarefa_id, c.ultima_em,c.triada,c.adiada_ate,c.cobrar_em,c.pendente_desde,c.versao,c.visto_em,
  (SELECT count(*) FROM mensagens m WHERE m.conversa_id = c.id) qtd,
  (SELECT json_object('autor', m.autor, 'de_mim', m.de_mim, 'assunto', m.assunto, 'texto', substr(m.texto, 1, 240), 'em', m.em)
     FROM mensagens m WHERE m.conversa_id = c.id ORDER BY m.em DESC, m.id DESC LIMIT 1) ultima
  FROM conversas c JOIN contas ct ON ct.id = c.conta_id LEFT JOIN pessoas p ON p.id = c.pessoa_id`;

function montar(db: Banco, l: Record<string, unknown>) {
  const tarefas = db
    .prepare(
      'SELECT DISTINCT t.id,t.titulo,t.status,t.projeto_id,p.nome projeto_nome FROM vinculos v JOIN tarefas t ON t.id=v.tarefa_id LEFT JOIN projetos p ON p.id=t.projeto_id WHERE v.conversa_id=? ORDER BY t.id',
    )
    .all(l.id);
  return { ...l, triada: !!l.triada, ultima: l.ultima ? JSON.parse(String(l.ultima)) : null, tarefas };
}
function limiteValido(v: number, max: number) {
  if (!Number.isInteger(v) || v < 1) throw new ErroDeEntrada('limite deve ser inteiro positivo');
  return Math.min(v, max);
}
export function listar(
  db: Banco,
  {
    espaco,
    estado,
    conta,
    canal,
    pessoa,
    projeto,
    q,
    antes,
    limite = 200,
  }: {
    espaco?: string;
    estado?: string;
    conta?: string;
    canal?: string;
    pessoa?: number;
    projeto?: number;
    q?: string;
    antes?: number;
    limite?: number;
  } = {},
) {
  const f: string[] = [];
  const a: Array<string | number> = [];
  if (espaco) {
    f.push('c.espaco_id=?');
    a.push(espaco);
  }
  if (estado && estado !== 'todos') {
    if (ESTADOS.includes(estado)) {
      f.push('c.estado=?');
      a.push(estado);
    } else if (estado === 'triar')
      (f.push("c.triada=0 AND c.estado<>'arquivada' AND (c.adiada_ate IS NULL OR c.adiada_ate<=?)"),
        a.push(agora()));
    else if (estado === 'adiadas') (f.push('c.adiada_ate>?'), a.push(agora()));
    else if (estado === 'cobrar')
      (f.push("c.cobrar_em IS NOT NULL AND c.cobrar_em<=? AND c.estado='esperando'"), a.push(agora()));
    else throw new ErroDeEntrada(`estado inválido: ${estado}`);
  }
  if (['responder', 'esperando', 'cobrar'].includes(estado ?? '')) {
    f.push('(c.adiada_ate IS NULL OR c.adiada_ate<=?)');
    a.push(agora());
  }
  if (conta) {
    f.push('c.conta_id=?');
    a.push(conta);
  }
  if (canal) {
    if (!['email', 'whatsapp'].includes(canal)) throw new ErroDeEntrada('canal inválido');
    f.push('ct.tipo=?');
    a.push(canal);
  }
  if (pessoa) {
    f.push('c.pessoa_id=?');
    a.push(pessoa);
  }
  if (projeto) {
    f.push(
      'EXISTS(SELECT 1 FROM vinculos v JOIN tarefas t ON t.id=v.tarefa_id WHERE v.conversa_id=c.id AND t.projeto_id=?)',
    );
    a.push(projeto);
  }
  if (q) {
    f.push(
      '(c.titulo LIKE ? OR c.endereco LIKE ? OR EXISTS(SELECT 1 FROM mensagens m WHERE m.conversa_id=c.id AND m.texto LIKE ?))',
    );
    a.push(...Array(3).fill('%' + q + '%'));
  }
  if (antes) {
    const cursor = db.prepare('SELECT ultima_em,id FROM conversas WHERE id=?').get(antes);
    if (!cursor) throw new ErroDeEntrada('cursor de conversa inválido');
    f.push('(c.ultima_em<? OR (c.ultima_em=? AND c.id<?))');
    a.push(String(cursor.ultima_em), String(cursor.ultima_em), antes);
  }
  return db
    .prepare(
      `${SELECT_CONVERSA} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY c.ultima_em DESC,c.id DESC LIMIT ?`,
    )
    .all(...a, limiteValido(limite, 500))
    .map((l) => montar(db, l));
}
export function obter(
  db: Banco,
  id: number,
  { antes, mensagem, limite = 100 }: { antes?: number; mensagem?: number; limite?: number } = {},
) {
  const c = db.prepare(`${SELECT_CONVERSA} WHERE c.id=?`).get(id);
  if (!c) throw new ErroDeEntrada(`conversa ${id} não existe`, 404);
  const n = limiteValido(limite, 500);
  if (mensagem !== undefined) {
    if (!Number.isSafeInteger(mensagem) || mensagem < 1) throw new ErroDeEntrada('id de mensagem inválido');
    const alvo = db.prepare('SELECT id,em FROM mensagens WHERE id=? AND conversa_id=?').get(mensagem, id);
    if (!alvo) throw new ErroDeEntrada('mensagem não pertence à conversa');
    if (antes === undefined) {
      const colunas = 'id,de_mim,autor,assunto,texto,em';
      const anteriores = db
        .prepare(
          `SELECT ${colunas} FROM mensagens WHERE conversa_id=? AND (em<? OR (em=? AND id<=?)) ORDER BY em DESC,id DESC LIMIT ?`,
        )
        .all(id, String(alvo.em), String(alvo.em), mensagem, Math.ceil(n / 2))
        .reverse();
      const posteriores = db
        .prepare(
          `SELECT ${colunas} FROM mensagens WHERE conversa_id=? AND (em>? OR (em=? AND id>?)) ORDER BY em,id LIMIT ?`,
        )
        .all(id, String(alvo.em), String(alvo.em), mensagem, n - anteriores.length);
      const mensagens = [...anteriores, ...posteriores];
      const primeira = mensagens[0];
      const tem_anteriores = !!db
        .prepare('SELECT 1 FROM mensagens WHERE conversa_id=? AND (em<? OR (em=? AND id<?)) LIMIT 1')
        .get(id, String(primeira.em), String(primeira.em), Number(primeira.id));
      return { ...montar(db, c), mensagens, tem_anteriores, responder: responderEm(db, c) };
    }
  }
  const a: Array<string | number> = [id];
  let cursor = '';
  if (antes) {
    const m = db.prepare('SELECT id,em FROM mensagens WHERE id=? AND conversa_id=?').get(antes, id);
    if (!m) throw new ErroDeEntrada('cursor de mensagem inválido');
    cursor = ' AND (em<? OR (em=? AND id<?))';
    a.push(String(m.em), String(m.em), antes);
  }
  const mensagens = db
    .prepare(
      `SELECT id,de_mim,autor,assunto,texto,em FROM mensagens WHERE conversa_id=?${cursor} ORDER BY em DESC,id DESC LIMIT ?`,
    )
    .all(...a, n + 1);
  const tem_anteriores = mensagens.length > n;
  mensagens.splice(n);
  return { ...montar(db, c), mensagens: mensagens.reverse(), tem_anteriores, responder: responderEm(db, c) };
}

// Onde responder: a Central não envia nada, mas abre a conversa no app certo.
// WhatsApp pelo número; Gmail direto na mensagem (pelo Message-ID); outro
// e-mail, um rascunho de resposta no programa de e-mail do aparelho.
export function responderEm(db: Banco, c: Record<string, unknown>): { app: string; url: string } | null {
  const endereco = String(c.endereco ?? '');
  if (c.canal === 'whatsapp')
    return /^\d{8,15}$/.test(endereco) ? { app: 'WhatsApp', url: `https://wa.me/${endereco}` } : null;
  const conta = obterConta(db, String(c.conta_id));
  const ultima = db
    .prepare(
      'SELECT externo, assunto FROM mensagens WHERE conversa_id = ? AND de_mim = 0 ORDER BY em DESC, id DESC LIMIT 1',
    )
    .get(c.id as number) as { externo: string; assunto: string } | undefined;
  const msgid = ultima?.externo.match(/^<([^<>\s]+)>$/)?.[1];
  if (conta.config.host === 'imap.gmail.com' && msgid && conta.config.usuario)
    return {
      app: 'Gmail',
      url: `https://mail.google.com/mail/u/${encodeURIComponent(conta.config.usuario)}/#search/rfc822msgid%3A${encodeURIComponent(msgid)}`,
    };
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(endereco)) return null;
  const assunto = String(ultima?.assunto || c.titulo || '').replace(/^(\s*(re|res|fw|fwd|enc)\s*:\s*)+/i, '');
  return {
    app: 'e-mail',
    url: `mailto:${encodeURIComponent(endereco).replace('%40', '@')}?subject=${encodeURIComponent('Re: ' + assunto)}`,
  };
}

export function alterar(db: Banco, id: number, dados: Record<string, unknown>) {
  return emTransacao(db, () => {
    const c = obter(db, id);
    conferirVersao(Number(c.versao), dados.versao);
    const mud: Record<string, string | number | null> = {};
    if ('estado' in dados) {
      if (!ESTADOS.includes(String(dados.estado))) throw new ErroDeEntrada('estado inválido');
      mud.estado = String(dados.estado);
      if (mud.estado !== c.estado)
        mud.pendente_desde = ['responder', 'esperando'].includes(mud.estado) ? agora() : null;
    }
    if ('nota' in dados) mud.nota = texto(dados.nota, 'nota', 4000, false);
    if ('espaco_id' in dados) {
      mud.espaco_id = obterEspaco(db, String(dados.espaco_id)).id;
      mud.movida = 1;
      if (
        db
          .prepare(
            'SELECT 1 FROM vinculos v JOIN tarefas t ON t.id=v.tarefa_id WHERE v.conversa_id=? AND t.espaco_id<>?',
          )
          .get(id, mud.espaco_id)
      )
        throw new ErroDeEntrada('Desvincule as tarefas antes de mover a conversa para outro espaço.', 409);
    }
    if ('triada' in dados) {
      if (typeof dados.triada !== 'boolean' && ![0, 1].includes(dados.triada as number))
        throw new ErroDeEntrada('triada deve ser booleano');
      mud.triada = dados.triada ? 1 : 0;
    }
    for (const campo of ['adiada_ate', 'cobrar_em', 'visto_em'])
      if (campo in dados) mud[campo] = instante(dados[campo]);
    if (!Object.keys(mud).length) throw new ErroDeEntrada('nada para mudar');
    db.prepare(
      `UPDATE conversas SET ${Object.keys(mud)
        .map((k) => `${k}=?`)
        .join(',')},versao=versao+1 WHERE id=?`,
    ).run(...Object.values(mud), id);
    registrar(db, 'conversas', id, 'alterou', {
      de: { estado: c.estado, espaco_id: c.espaco_id },
      para: mud,
    });
    return obter(db, id);
  });
}
export function vincular(db: Banco, id: number, dados: Record<string, unknown>) {
  return emTransacao(db, () => {
    const c = obter(db, id);
    const t = obterTarefa(db, Number(dados.tarefa_id));
    if (c.espaco_id !== t.espaco_id) throw new ErroDeEntrada('a tarefa deve pertencer ao mesmo espaço');
    if (t.projeto_id) {
      const p = db.prepare('SELECT status FROM projetos WHERE id=?').get(t.projeto_id);
      if (p?.status !== 'ativo') throw new ErroDeEntrada('projeto deve estar ativo', 409);
    }
    const m = dados.mensagem_id == null ? null : Number(dados.mensagem_id);
    if (m !== null && !db.prepare('SELECT 1 FROM mensagens WHERE id=? AND conversa_id=?').get(m, id))
      throw new ErroDeEntrada('mensagem não pertence à conversa');
    db.prepare(
      'INSERT OR IGNORE INTO vinculos(conversa_id,tarefa_id,mensagem_id,criado) VALUES(?,?,?,?)',
    ).run(id, t.id, m, agora());
    db.prepare(
      'UPDATE conversas SET tarefa_id=coalesce(tarefa_id,?),triada=1,versao=versao+1 WHERE id=?',
    ).run(t.id, id);
    return obter(db, id);
  });
}
export function desvincular(db: Banco, id: number, tarefa: number) {
  return emTransacao(db, () => {
    obter(db, id);
    const r = db.prepare('DELETE FROM vinculos WHERE conversa_id=? AND tarefa_id=?').run(id, tarefa);
    if (!r.changes) throw new ErroDeEntrada('vínculo não existe', 404);
    db.prepare(
      'UPDATE conversas SET tarefa_id=(SELECT tarefa_id FROM vinculos WHERE conversa_id=? ORDER BY id LIMIT 1),versao=versao+1 WHERE id=?',
    ).run(id, id);
    registrar(db, 'conversas', id, 'alterou', { desvinculou_tarefa: tarefa });
    return obter(db, id);
  });
}
export function virarTarefa(db: Banco, id: number, dados: Record<string, unknown>) {
  return emTransacao(db, () => {
    const c = obter(db, id);
    const operacao = dados.operacao == null ? null : String(dados.operacao);
    if (
      operacao &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operacao)
    )
      throw new ErroDeEntrada('operação deve ser UUID');
    const titulo = texto(
      dados.titulo ||
        (c.canal === 'email' ? `Responder: ${c.titulo}` : `Responder ${c.pessoa_nome || c.titulo}`),
      'título',
      200,
    );
    const payload = JSON.stringify({
      conversa_id: id,
      titulo: dados.titulo ? texto(dados.titulo, 'título', 200) : null,
      mensagem_id: dados.mensagem_id == null ? null : Number(dados.mensagem_id),
      projeto_id: dados.projeto_id == null ? null : Number(dados.projeto_id),
      proxima: data(dados.proxima),
    });
    if (operacao) {
      const anterior = db.prepare('SELECT * FROM operacoes_tarefa WHERE operacao=?').get(operacao);
      if (anterior) {
        if (anterior.payload !== payload)
          throw new ErroDeEntrada('operação já utilizada com outros dados', 409);
        return obterTarefa(db, Number(anterior.tarefa_id));
      }
    }
    if (!operacao && dados.mensagem_id == null && c.tarefa_id) {
      const legado = db
        .prepare(
          'SELECT t.id FROM tarefas t JOIN vinculos v ON v.tarefa_id=t.id WHERE t.id=? AND t.espaco_id=? AND v.conversa_id=? LIMIT 1',
        )
        .get(Number(c.tarefa_id), String(c.espaco_id), id);
      if (legado) return obterTarefa(db, Number(legado.id));
      db.prepare('UPDATE conversas SET tarefa_id=NULL WHERE id=?').run(id);
    }
    const daPessoa =
      c.pessoa_id &&
      db
        .prepare('SELECT 1 FROM pessoa_espaco WHERE pessoa_id=? AND espaco_id=?')
        .get(Number(c.pessoa_id), String(c.espaco_id));
    const t = criarTarefa(db, {
      espaco_id: c.espaco_id,
      titulo,
      proxima: dados.proxima ?? null,
      projeto_id: dados.projeto_id ?? null,
      pessoa_id: daPessoa ? c.pessoa_id : null,
      origem: `${c.canal === 'email' ? 'e-mail' : 'WhatsApp'} · conversa #${id}`,
    });
    vincular(db, id, { tarefa_id: t.id, mensagem_id: dados.mensagem_id });
    if (operacao)
      db.prepare('INSERT INTO operacoes_tarefa(operacao,conversa_id,payload,tarefa_id) VALUES(?,?,?,?)').run(
        operacao,
        id,
        payload,
        t.id,
      );
    return obterTarefa(db, t.id);
  });
}

// Para o Hoje: quantas pedem resposta em cada espaço e as mais antigas.
export function pendentesPorEspaco(
  db: Banco,
): Record<string, { responder: number; esperando: number; primeiras: unknown[] }> {
  const out: Record<string, { responder: number; esperando: number; primeiras: unknown[] }> = {};
  for (const r of db
    .prepare(
      "SELECT espaco_id, estado, count(*) n FROM conversas WHERE estado IN ('responder', 'esperando') AND (adiada_ate IS NULL OR adiada_ate<=?) GROUP BY espaco_id, estado",
    )
    .all(agora())) {
    const e = (out[String(r.espaco_id)] ??= { responder: 0, esperando: 0, primeiras: [] });
    e[r.estado as 'responder' | 'esperando'] = Number(r.n);
  }
  for (const [esp, e] of Object.entries(out)) {
    if (e.responder)
      e.primeiras = db
        .prepare(
          `${SELECT_CONVERSA} WHERE c.espaco_id = ? AND c.estado = 'responder' AND (c.adiada_ate IS NULL OR c.adiada_ate<=?) ORDER BY c.pendente_desde,c.id LIMIT 5`,
        )
        .all(esp, agora())
        .map((l) => montar(db, l));
  }
  return out;
}

// Retenção: o texto de mensagem mais velha que N dias é apagado (a busca junto).
// Fica o registro de que houve a conversa, com quem e quando.
export function reter(db: Banco, dias: number): number {
  const limite = new Date(Date.now() - dias * 864e5).toISOString();
  return Number(
    db.prepare("UPDATE mensagens SET texto = '' WHERE em < ? AND texto <> ''").run(limite).changes,
  );
}

// Busca no que tem: mensagens (FTS), tarefas e pessoas.
export function buscar(db: Banco, q: string, { espaco }: { espaco?: string } = {}) {
  const termos =
    q
      .normalize('NFC')
      .match(/[\p{L}\p{N}@._-]+/gu)
      ?.slice(0, 8) ?? [];
  if (!termos.length) return { conversas: [], tarefas: [], pessoas: [] };
  const fts = termos.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
  const comEspaco = espaco ? ' AND c.espaco_id = ?' : '';
  const conversas = db
    .prepare(
      `SELECT c.id, c.espaco_id, ct.tipo canal, c.titulo, c.estado, c.ultima_em, p.nome pessoa_nome,
      snippet(mensagens_busca, 2, char(2), char(3), '…', 12) trecho, m.em
    FROM mensagens_busca JOIN mensagens m ON m.id = mensagens_busca.rowid JOIN conversas c ON c.id = m.conversa_id
    JOIN contas ct ON ct.id = c.conta_id LEFT JOIN pessoas p ON p.id = c.pessoa_id
    WHERE mensagens_busca MATCH ?${comEspaco} ORDER BY m.em DESC LIMIT 30`,
    )
    .all(fts, ...(espaco ? [espaco] : []));
  const like = `%${termos.join(' ').toLowerCase()}%`;
  const tarefas = db
    .prepare(
      `SELECT t.id, t.espaco_id, t.titulo, t.status, t.proxima FROM tarefas t
    WHERE (lower(t.titulo) LIKE ? OR EXISTS (SELECT 1 FROM anotacoes a WHERE a.tarefa_id = t.id AND lower(a.texto) LIKE ?))${espaco ? ' AND t.espaco_id = ?' : ''}
    ORDER BY t.atualizado DESC LIMIT 30`,
    )
    .all(like, like, ...(espaco ? [espaco] : []));
  const pessoas = db
    .prepare(
      `SELECT DISTINCT p.id, p.nome FROM pessoas p LEFT JOIN canais c ON c.pessoa_id = p.id
    WHERE (lower(p.nome) LIKE ? OR c.valor LIKE ?)${espaco ? ' AND EXISTS (SELECT 1 FROM pessoa_espaco pe WHERE pe.pessoa_id = p.id AND pe.espaco_id = ?)' : ''}
    ORDER BY p.nome LIMIT 30`,
    )
    .all(like, like, ...(espaco ? [espaco] : []));
  return { conversas, tarefas, pessoas };
}
