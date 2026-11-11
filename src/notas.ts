// Notas do Obsidian. O vault é sincronizado entre os aparelhos pelo plugin
// Self-hosted LiveSync, num CouchDB ao lado da Central. Aqui a Central LÊ esse
// banco e guarda uma cópia para buscar, mostrar e ligar a pessoas e projetos.
//
// Só leitura, por desenho: este arquivo só faz GET e POST de consulta
// (_changes e _all_docs). Nada aqui grava, apaga ou muda documento no CouchDB,
// e um teste falha se alguém puser uma chamada dessas. O editor é o Obsidian.
//
// Formato do LiveSync (sem cifra): cada arquivo é um documento
//   { _id, path, type: 'plain' | 'newnote', children: ['h:...'], mtime, ctime, size }
// e o conteúdo é a junção, em ordem, do campo data dos pedaços (type 'leaf').
// 'plain' é texto; 'newnote' é binário em base64 (imagem, PDF): desse a Central
// guarda só o nome, não o conteúdo.

import { agora, emTransacao, ErroDeEntrada, type Banco } from './db.ts';

export type ConfigNotas = {
  url: string;                      // ex.: http://central-couchdb:5984
  banco: string;                    // ex.: vault
  usuario: string;
  senha: string;
  segundos: number;                 // de quanto em quanto tempo olhar o que mudou
  ignorar: string[];                // expressões regulares; caminho que casa não entra na Central
  pastas: Record<string, string>;   // pasta do vault -> id do espaço
};

// Nota de credencial nunca entra, mesmo que ainda esteja no vault principal.
// Vale pelo nome do arquivo ou da pasta: cadeado, "credencial", "senha", "login", chaves.
export const IGNORAR_PADRAO = ['🔐', 'credenc', 'senha', 'password', '\\blogin\\b', 'chave-privada', '\\.(pem|asc|key|p12|pfx)$'];

const MAX_TEXTO = 2_000_000; // nota maior que isto fica só com o nome
const LOTE = 200;

type DocNota = {
  _id: string; _rev: string; _deleted?: boolean; deleted?: boolean;
  type?: string; path?: string; children?: string[]; mtime?: number; ctime?: number; size?: number;
};
type Mudanca = { id: string; deleted?: boolean; doc?: DocNota };

// ---------- CouchDB (só consulta) ----------

async function consultar(c: ConfigNotas, caminho: string, corpo?: unknown): Promise<any> {
  const r = await fetch(`${c.url.replace(/\/+$/, '')}/${encodeURIComponent(c.banco)}${caminho}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${c.usuario}:${c.senha}`).toString('base64'),
      Accept: 'application/json',
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`banco de notas respondeu HTTP ${r.status}`);
  return r.json();
}

// Busca de uma vez os pedaços de várias notas (um pedido para cada 1000, não um por nota).
async function buscarPedacos(c: ConfigNotas, ids: string[]): Promise<Map<string, string>> {
  const partes = new Map<string, string>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 1000) {
    const r = await consultar(c, '/_all_docs?include_docs=true', { keys: unicos.slice(i, i + 1000) });
    for (const linha of r.rows) if (linha.doc && typeof linha.doc.data === 'string') partes.set(linha.id, linha.doc.data);
  }
  return partes;
}

// Junta os pedaços de um documento. Devolve null se algum ainda não chegou.
function montarTexto(partes: Map<string, string>, filhos: string[]): string | null {
  let texto = '';
  for (const f of filhos) {
    const p = partes.get(f);
    if (p === undefined) return null;
    texto += p;
  }
  return texto;
}

// ---------- Estado ----------

const lerEstado = (db: Banco, chave: string): string | undefined =>
  db.prepare('SELECT valor FROM notas_estado WHERE chave = ?').get(chave)?.valor as string | undefined;
const gravarEstado = (db: Banco, chave: string, valor: string) =>
  db.prepare('INSERT INTO notas_estado (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);

// ---------- Regras de caminho ----------

function regras(c: ConfigNotas) {
  const ignorar = c.ignorar.map((s) => new RegExp(s, 'iu'));
  const pastas = Object.entries(c.pastas)
    .map(([pasta, espaco]) => [pasta.replace(/^\/+|\/+$/g, '').toLowerCase(), espaco] as const)
    .sort((a, b) => b[0].length - a[0].length);
  return {
    ignorado: (caminho: string) => ignorar.some((r) => r.test(caminho)),
    espacoDe: (caminho: string): string | null => {
      const baixo = caminho.toLowerCase();
      for (const [pasta, espaco] of pastas) if (baixo === pasta || baixo.startsWith(pasta + '/')) return espaco;
      return null;
    },
  };
}

function partesDoCaminho(caminho: string) {
  const i = caminho.lastIndexOf('/');
  const arquivo = i < 0 ? caminho : caminho.slice(i + 1);
  const ponto = arquivo.lastIndexOf('.');
  return { pasta: i < 0 ? '' : caminho.slice(0, i), titulo: ponto > 0 ? arquivo.slice(0, ponto) : arquivo };
}

const iso = (ms: unknown): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;

// ---------- Leitura do que mudou ----------

export type Resultado = { lidas: number; apagadas: number; ignoradas: number; pendentes: number };

// Os pedaços de que um lote de mudanças vai precisar: só de nota de texto, viva e não ignorada.
const filhosDoLote = (r: ReturnType<typeof regras>, lote: Mudanca[]) =>
  lote.flatMap((m) =>
    m.doc && !m.deleted && !m.doc.deleted && !m.doc._deleted && m.doc.type === 'plain' &&
    (m.doc.size ?? 0) <= MAX_TEXTO && !r.ignorado(String(m.doc.path || m.doc._id))
      ? (m.doc.children ?? [])
      : [],
  );

// Aplica um documento ao banco da Central. Devolve o que fez; 'pendente' = faltou pedaço.
function aplicar(
  db: Banco, r: ReturnType<typeof regras>, espacos: Set<string>, partes: Map<string, string>, m: Mudanca,
): 'lida' | 'apagada' | 'ignorada' | 'pendente' | 'nada' {
  const d = m.doc;
  const apagar = () => (db.prepare('DELETE FROM notas WHERE chave = ?').run(m.id).changes ? 'apagada' : 'nada');
  if (m.deleted || !d || d._deleted || d.deleted) return apagar();
  if (d.type !== 'plain' && d.type !== 'newnote') return 'nada';
  const caminho = String(d.path || d._id);
  if (r.ignorado(caminho)) {
    apagar();
    return 'ignorada';
  }
  const atual = db.prepare('SELECT rev FROM notas WHERE chave = ?').get(d._id);
  if (atual?.rev === d._rev) return 'nada';

  const ehTexto = d.type === 'plain' && (d.size ?? 0) <= MAX_TEXTO;
  let texto = '';
  if (ehTexto) {
    const t = montarTexto(partes, d.children ?? []);
    if (t === null) return 'pendente';
    texto = t;
  }
  const { pasta, titulo } = partesDoCaminho(caminho);
  const espaco = r.espacoDe(caminho);
  db.prepare(
    `INSERT INTO notas (chave, caminho, titulo, pasta, espaco_id, tipo, texto, tamanho, criada, modificada, rev, lida_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (chave) DO UPDATE SET caminho = excluded.caminho, titulo = excluded.titulo, pasta = excluded.pasta,
       espaco_id = excluded.espaco_id, tipo = excluded.tipo, texto = excluded.texto, tamanho = excluded.tamanho,
       criada = excluded.criada, modificada = excluded.modificada, rev = excluded.rev, lida_em = excluded.lida_em`,
  ).run(
    d._id, caminho, titulo, pasta, espaco && espacos.has(espaco) ? espaco : null,
    ehTexto ? 'texto' : 'arquivo', texto, Number(d.size) || 0, iso(d.ctime), iso(d.mtime), d._rev, agora(),
  );
  return 'lida';
}

// Lê do CouchDB tudo o que mudou desde a última vez. Pode ser chamada de novo a qualquer hora.
export async function sincronizar(db: Banco, c: ConfigNotas): Promise<Resultado> {
  const r = regras(c);
  const espacos = new Set(db.prepare('SELECT id FROM espacos').all().map((e) => String(e.id)));
  const res: Resultado = { lidas: 0, apagadas: 0, ignoradas: 0, pendentes: 0 };
  const pendentes = new Set<string>(JSON.parse(lerEstado(db, 'pendentes') || '[]'));
  const contar = (o: ReturnType<typeof aplicar>, id: string) => {
    if (o === 'pendente') pendentes.add(id);
    else pendentes.delete(id);
    if (o === 'lida') res.lidas++;
    else if (o === 'apagada') res.apagadas++;
    else if (o === 'ignorada') res.ignoradas++;
  };

  // Primeiro, o que ficou esperando pedaço na rodada anterior.
  if (pendentes.size) {
    const velhos = [...pendentes];
    const docs = await consultar(c, '/_all_docs?include_docs=true', { keys: velhos });
    const lote: Mudanca[] = docs.rows.map((l: any) => ({ id: l.key ?? l.id, deleted: !l.doc, doc: l.doc }));
    const partes = await buscarPedacos(c, filhosDoLote(r, lote));
    for (const m of lote) contar(aplicar(db, r, espacos, partes, m), m.id);
  }

  let seq = lerEstado(db, 'seq') || '0';
  for (;;) {
    const lote = await consultar(
      c,
      `/_changes?include_docs=true&limit=${LOTE}&filter=_selector&since=${encodeURIComponent(seq)}`,
      { selector: { $or: [{ type: { $in: ['plain', 'newnote'] } }, { _deleted: true }] } },
    );
    const mudancas = lote.results as Mudanca[];
    const partes = await buscarPedacos(c, filhosDoLote(r, mudancas));
    emTransacao(db, () => {
      for (const m of mudancas) contar(aplicar(db, r, espacos, partes, m), m.id);
    });
    seq = String(lote.last_seq);
    emTransacao(db, () => {
      gravarEstado(db, 'seq', seq);
      gravarEstado(db, 'pendentes', JSON.stringify([...pendentes]));
    });
    if (!lote.results.length || lote.pending === 0) break;
  }
  res.pendentes = pendentes.size;
  return res;
}

// Esquece até onde leu: a próxima leitura passa por tudo de novo (depois de mudar ignorar/pastas).
export function reler(db: Banco) {
  emTransacao(db, () => {
    db.prepare("DELETE FROM notas_estado WHERE chave IN ('seq', 'pendentes')").run();
    db.prepare("UPDATE notas SET rev = ''").run();
  });
}

// Liga a leitura periódica. Uma rodada por vez; erro fica anotado e a próxima tenta de novo.
export function iniciarLeitor(db: Banco, c: ConfigNotas) {
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await sincronizar(db, c);
      gravarEstado(db, 'ultima_ok', agora());
      gravarEstado(db, 'erro', '');
      if (r.lidas || r.apagadas) console.log(`notas: ${r.lidas} lidas, ${r.apagadas} apagadas, ${r.pendentes} esperando`);
    } catch (e) {
      gravarEstado(db, 'erro', (e as Error).message.slice(0, 300));
      console.error('notas: leitura falhou:', (e as Error).message);
    } finally {
      rodando = false;
    }
  };
  const inicio = setTimeout(rodar, 3000);
  const t = setInterval(rodar, Math.max(10, c.segundos) * 1000);
  inicio.unref();
  t.unref();
  return { parar: () => (clearTimeout(inicio), clearInterval(t)), agora: rodar };
}

// ---------- Consulta (o que a tela e o MCP usam) ----------

const CAMPOS = 'n.id, n.caminho, n.titulo, n.pasta, n.espaco_id, n.tipo, n.tamanho, n.modificada';

export function listar(
  db: Banco,
  { q, pasta, espaco, limite = 50 }: { q?: string; pasta?: string; espaco?: string; limite?: number } = {},
) {
  const n = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const onde: string[] = [];
  const args: Array<string | number> = [];
  if (pasta) {
    onde.push("(n.pasta = ? OR n.pasta LIKE ? ESCAPE '\\')");
    args.push(pasta, pasta.replace(/[%_\\]/g, '\\$&') + '/%');
  }
  if (espaco) {
    onde.push('n.espaco_id = ?');
    args.push(espaco);
  }
  const termos = (q || '').normalize('NFC').match(/[\p{L}\p{N}@._-]+/gu)?.slice(0, 8) ?? [];
  if (termos.length) {
    const fts = termos.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
    return db
      .prepare(
        `SELECT ${CAMPOS}, snippet(notas_busca, 2, char(2), char(3), '…', 16) trecho
         FROM notas_busca JOIN notas n ON n.id = notas_busca.rowid
         WHERE notas_busca MATCH ?${onde.length ? ' AND ' + onde.join(' AND ') : ''}
         ORDER BY bm25(notas_busca, 8.0, 2.0, 1.0) LIMIT ?`,
      )
      .all(fts, ...args, n);
  }
  return db
    .prepare(
      `SELECT ${CAMPOS}, substr(n.texto, 1, 160) trecho FROM notas n
       ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY n.modificada DESC, n.id DESC LIMIT ?`,
    )
    .all(...args, n);
}

// Pastas de primeiro nível, com a contagem, para filtrar.
export function pastas(db: Banco) {
  return db
    .prepare(
      `SELECT CASE WHEN instr(pasta, '/') > 0 THEN substr(pasta, 1, instr(pasta, '/') - 1) ELSE pasta END nome, count(*) notas
       FROM notas GROUP BY 1 ORDER BY 1`,
    )
    .all();
}

const vinculosDe = (db: Banco, id: number) =>
  db
    .prepare(
      `SELECT v.id, v.pessoa_id, v.projeto_id, pe.nome pessoa_nome, pr.nome projeto_nome
       FROM nota_vinculos v LEFT JOIN pessoas pe ON pe.id = v.pessoa_id LEFT JOIN projetos pr ON pr.id = v.projeto_id
       WHERE v.nota_id = ? ORDER BY v.id`,
    )
    .all(id);

export function obter(db: Banco, id: number) {
  const n = db.prepare(`SELECT ${CAMPOS}, n.texto, n.criada, n.lida_em FROM notas n WHERE n.id = ?`).get(id);
  if (!n) throw new ErroDeEntrada('nota não existe', 404);
  // [[ligações]] para outras notas: resolve pelo caminho ou pelo título, como o Obsidian.
  const ligacoes: Record<string, number> = {};
  const alvos = new Set([...String(n.texto).matchAll(/\[\[([^\]|#^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean));
  const porCaminho = db.prepare('SELECT id FROM notas WHERE lower(caminho) IN (lower(?), lower(?)) LIMIT 1');
  const porTitulo = db.prepare('SELECT id FROM notas WHERE lower(titulo) = lower(?) ORDER BY length(caminho) LIMIT 1');
  for (const alvo of [...alvos].slice(0, 300)) {
    const nome = alvo.includes('/') ? alvo.slice(alvo.lastIndexOf('/') + 1) : alvo;
    const r = porCaminho.get(alvo, alvo + '.md') ?? porTitulo.get(nome);
    if (r) ligacoes[alvo] = Number(r.id);
  }
  return { ...n, ligacoes, vinculos: vinculosDe(db, id) };
}

export function vincular(db: Banco, id: number, corpo: Record<string, unknown>) {
  if (!db.prepare('SELECT 1 FROM notas WHERE id = ?').get(id)) throw new ErroDeEntrada('nota não existe', 404);
  const pessoa = corpo.pessoa_id == null ? null : Number(corpo.pessoa_id);
  const projeto = corpo.projeto_id == null ? null : Number(corpo.projeto_id);
  if ((pessoa === null) === (projeto === null)) throw new ErroDeEntrada('informe pessoa_id ou projeto_id');
  const alvo = pessoa !== null ? ['pessoas', pessoa] : ['projetos', projeto];
  if (!Number.isInteger(alvo[1]) || !db.prepare(`SELECT 1 FROM ${alvo[0]} WHERE id = ?`).get(alvo[1] as number))
    throw new ErroDeEntrada(pessoa !== null ? 'pessoa não existe' : 'projeto não existe', 404);
  db.prepare('INSERT OR IGNORE INTO nota_vinculos (nota_id, pessoa_id, projeto_id, criado) VALUES (?, ?, ?, ?)').run(
    id, pessoa, projeto, agora(),
  );
  return vinculosDe(db, id);
}

export function desvincular(db: Banco, id: number, vinculo: number) {
  db.prepare('DELETE FROM nota_vinculos WHERE id = ? AND nota_id = ?').run(vinculo, id);
  return vinculosDe(db, id);
}

export const deProjeto = (db: Banco, projeto: number) =>
  db
    .prepare(`SELECT ${CAMPOS} FROM notas n JOIN nota_vinculos v ON v.nota_id = n.id WHERE v.projeto_id = ? ORDER BY n.modificada DESC`)
    .all(projeto);

export const dePessoa = (db: Banco, pessoa: number) =>
  db
    .prepare(`SELECT ${CAMPOS} FROM notas n JOIN nota_vinculos v ON v.nota_id = n.id WHERE v.pessoa_id = ? ORDER BY n.modificada DESC`)
    .all(pessoa);

export function estado(db: Banco, ligado: boolean) {
  const t = db.prepare("SELECT count(*) total, sum(tipo = 'texto') textos, max(modificada) ultima_nota FROM notas").get()!;
  return {
    ligado,
    total: Number(t.total),
    textos: Number(t.textos) || 0,
    ultima_nota: t.ultima_nota ?? null,
    ultima_leitura: lerEstado(db, 'ultima_ok') || null,
    erro: lerEstado(db, 'erro') || null,
    esperando: (JSON.parse(lerEstado(db, 'pendentes') || '[]') as string[]).length,
  };
}
