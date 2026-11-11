// Notas do Obsidian: a leitura do banco de sincronização (LiveSync/CouchDB),
// contra um CouchDB de mentira que anota cada pedido recebido.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { abrir } from '../src/db.ts';
import * as espacos from '../src/espacos.ts';
import * as pessoas from '../src/pessoas.ts';
import * as projetos from '../src/projetos.ts';
import * as notas from '../src/notas.ts';

type Doc = Record<string, any>;

// CouchDB mínimo: _changes (com since e limit) e _all_docs por chaves.
function couchFalso() {
  const docs = new Map<string, Doc>();
  const fila: string[] = []; // ordem das mudanças; a posição + 1 é o seq
  const pedidos: string[] = [];
  let rev = 0;
  const por = (id: string, doc: Doc) => {
    docs.set(id, { ...doc, _id: id, _rev: `${++rev}-x` });
    fila.push(id);
  };
  const servidor: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (p) => (corpo += p));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      pedidos.push(`${req.method} ${url.pathname}`);
      const ok = (v: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(v)));
      if (req.headers.authorization !== 'Basic ' + Buffer.from('central:segredo').toString('base64'))
        return res.writeHead(401).end('{}');
      if (url.pathname === '/vault/_changes') {
        const desde = Number(url.searchParams.get('since')) || 0;
        const limite = Number(url.searchParams.get('limit')) || 100;
        // Como no CouchDB: cada documento aparece uma vez, na posição da última mudança.
        const ultimas = fila.map((id, i) => ({ id, seq: i + 1 })).filter((m, i) => fila.lastIndexOf(m.id) === i && m.seq > desde);
        const notasSo = ultimas.filter((m) => ['plain', 'newnote'].includes(docs.get(m.id)!.type) || docs.get(m.id)!._deleted);
        const pagina = notasSo.slice(0, limite);
        return ok({
          results: pagina.map((m) => ({ id: m.id, seq: m.seq, deleted: !!docs.get(m.id)!._deleted, doc: docs.get(m.id) })),
          last_seq: pagina.length < notasSo.length ? pagina.at(-1)!.seq : fila.length,
          pending: notasSo.length - pagina.length,
        });
      }
      if (url.pathname === '/vault/_all_docs') {
        const { keys } = JSON.parse(corpo);
        return ok({ rows: keys.map((k: string) => (docs.has(k) ? { id: k, key: k, doc: docs.get(k) } : { key: k, error: 'not_found' })) });
      }
      res.writeHead(404).end('{}');
    });
  });
  return {
    pedidos,
    pedaco: (id: string, data: string) => por(id, { type: 'leaf', data }),
    nota: (caminho: string, filhos: string[], extra: Doc = {}) =>
      por(caminho.toLowerCase(), { type: 'plain', path: caminho, children: filhos, mtime: 1794354285457, ctime: 1794000000000, size: 10, eden: {}, ...extra }),
    escutar: () => new Promise<string>((ok) => servidor.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`))),
    // O fetch deixa a conexão aberta (keep-alive): sem derrubar, o close não termina.
    fechar: () => new Promise((ok) => (servidor.closeAllConnections(), servidor.close(ok))),
  };
}

async function cenario(t: TestContext) {
  const couch = couchFalso();
  const url = await couch.escutar();
  t.after(() => couch.fechar()); // fecha mesmo quando o teste falha
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'pessoal', nome: 'Pessoal' }, { id: 'loja', nome: 'Loja' }]);
  const cfg: notas.ConfigNotas = {
    url, banco: 'vault', usuario: 'central', senha: 'segredo', segundos: 60,
    ignorar: notas.IGNORAR_PADRAO, pastas: { 'Projetos/Loja': 'loja', Projetos: 'pessoal' },
  };
  return { couch, db, cfg };
}

test('lê as notas, junta os pedaços e busca sem acento', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:1', '# Reunião\n\nO forno ');
  couch.pedaco('h:2', 'novo chega na terça. Ver [[Fornecedores]].');
  couch.nota('Projetos/Loja/Reunião de março.md', ['h:1', 'h:2']);
  couch.pedaco('h:3', 'Lista de fornecedores');
  couch.nota('Projetos/Loja/Fornecedores.md', ['h:3']);
  couch.nota('Diário/2026-11-10.md', [], { size: 0 });

  assert.deepEqual(await notas.sincronizar(db, cfg), { lidas: 3, apagadas: 0, ignoradas: 0, pendentes: 0 });
  const achadas = notas.listar(db, { q: 'reuniao' }) as any[];
  assert.equal(achadas.length, 1);
  assert.equal(achadas[0].titulo, 'Reunião de março');
  assert.equal(achadas[0].pasta, 'Projetos/Loja');
  assert.equal(achadas[0].espaco_id, 'loja'); // a pasta mais específica ganha
  assert.match(achadas[0].trecho, /\u0002Reunião\u0003/);

  const n = notas.obter(db, achadas[0].id) as any;
  assert.equal(n.texto, '# Reunião\n\nO forno novo chega na terça. Ver [[Fornecedores]].');
  assert.equal(n.modificada, new Date(1794354285457).toISOString());
  assert.deepEqual(Object.keys(n.ligacoes), ['Fornecedores']); // [[ligação]] resolvida pelo título

  assert.equal((notas.listar(db, { pasta: 'Projetos' }) as any[]).length, 2); // inclui as subpastas
  assert.equal((notas.listar(db, { espaco: 'loja' }) as any[]).length, 2);
  assert.deepEqual(notas.pastas(db).map((p) => ({ ...p })), [{ nome: 'Diário', notas: 1 }, { nome: 'Projetos', notas: 2 }]);
  // Rodar de novo sem mudança não lê nada.
  assert.deepEqual(await notas.sincronizar(db, cfg), { lidas: 0, apagadas: 0, ignoradas: 0, pendentes: 0 });
});

test('nota de credencial nunca entra na Central', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:s', 'senha: hunter2');
  couch.nota('Projetos/Loja/🔐 Credenciais.md', ['h:s']);
  couch.nota('Projetos/Loja/Credenciais SITE.md', ['h:s']);
  couch.nota('Backup/central-backup-CHAVE-PRIVADA.asc', ['h:s']);
  couch.nota('LOGIN CONTA ROOT.md', ['h:s']);
  couch.nota('Segurança/Senha do wifi.md', ['h:s']);
  couch.pedaco('h:n', 'nota comum');
  couch.nota('Projetos/Loja/Comum.md', ['h:n']);
  couch.nota('Projetos/Loja/Catálogo de produtos.md', ['h:n']); // "logo" dentro da palavra não é "login"

  const r = await notas.sincronizar(db, cfg);
  assert.equal(r.lidas, 2);
  assert.equal(r.ignoradas, 5);
  assert.equal(db.prepare('SELECT count(*) n FROM notas').get()!.n, 2);
  assert.equal((notas.listar(db, { q: 'hunter2' }) as any[]).length, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM notas WHERE texto LIKE '%hunter2%'").get()!.n, 0);
});

test('mudança, renomeio e apagamento no Obsidian chegam à Central', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:a', 'primeira versão');
  couch.nota('Ideias.md', ['h:a']);
  await notas.sincronizar(db, cfg);
  const id = (notas.listar(db) as any[])[0].id;

  couch.pedaco('h:b', 'segunda versão');
  couch.nota('Ideias.md', ['h:b']);
  assert.equal((await notas.sincronizar(db, cfg)).lidas, 1);
  assert.equal((notas.obter(db, id) as any).texto, 'segunda versão');
  assert.equal((notas.listar(db, { q: 'primeira' }) as any[]).length, 0);
  assert.equal((notas.listar(db, { q: 'segunda' }) as any[]).length, 1);

  // O LiveSync marca o apagado com deleted: true.
  couch.nota('Ideias.md', [], { deleted: true });
  assert.equal((await notas.sincronizar(db, cfg)).apagadas, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM notas').get()!.n, 0);
  assert.equal((notas.listar(db, { q: 'segunda' }) as any[]).length, 0);
});

test('pedaço que ainda não chegou: a nota espera e entra na rodada seguinte', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.nota('Grande.md', ['h:p1', 'h:p2']);
  couch.pedaco('h:p1', 'começo ');
  const r = await notas.sincronizar(db, cfg);
  assert.deepEqual([r.lidas, r.pendentes], [0, 1]);
  assert.equal(notas.estado(db, true).esperando, 1);

  couch.pedaco('h:p2', 'e fim');
  const r2 = await notas.sincronizar(db, cfg);
  assert.deepEqual([r2.lidas, r2.pendentes], [1, 0]);
  assert.equal((notas.obter(db, (notas.listar(db) as any[])[0].id) as any).texto, 'começo e fim');
});

test('imagem e PDF entram só com o nome; muitos arquivos passam em lotes', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:img', 'iVBORw0KGgo=');
  couch.nota('Anexos/foto.png', ['h:img'], { type: 'newnote', size: 131048 });
  couch.pedaco('h:t', 'texto');
  for (let i = 0; i < 450; i++) couch.nota(`Lote/n${i}.md`, ['h:t']);

  const r = await notas.sincronizar(db, cfg);
  assert.equal(r.lidas, 451);
  const foto = db.prepare("SELECT tipo, texto, tamanho FROM notas WHERE caminho = 'Anexos/foto.png'").get()!;
  assert.deepEqual({ ...foto }, { tipo: 'arquivo', texto: '', tamanho: 131048 });
  assert.ok(couch.pedidos.filter((p) => p === 'POST /vault/_changes').length >= 3);
  assert.equal(notas.estado(db, true).total, 451);
});

test('ligar nota a projeto e pessoa', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:x', 'ata');
  couch.nota('Ata.md', ['h:x']);
  await notas.sincronizar(db, cfg);
  const id = (notas.listar(db) as any[])[0].id;
  const pessoa = pessoas.salvar(db, { nome: 'Bruno', espacos: ['loja'] }) as any;
  const projeto = projetos.criar(db, { espaco_id: 'loja', nome: 'Reforma' }) as any;

  notas.vincular(db, id, { projeto_id: projeto.id });
  const v = notas.vincular(db, id, { pessoa_id: pessoa.id }) as any[];
  assert.deepEqual(v.map((x) => x.projeto_nome || x.pessoa_nome), ['Reforma', 'Bruno']);
  assert.equal((notas.vincular(db, id, { projeto_id: projeto.id }) as any[]).length, 2); // repetir não duplica
  assert.equal((notas.deProjeto(db, projeto.id) as any[])[0].titulo, 'Ata');
  assert.equal((notas.dePessoa(db, pessoa.id) as any[])[0].titulo, 'Ata');
  assert.throws(() => notas.vincular(db, id, {}), /pessoa_id ou projeto_id/);
  assert.throws(() => notas.vincular(db, id, { projeto_id: 999 }), /projeto não existe/);
  assert.equal((notas.desvincular(db, id, v[0].id) as any[]).length, 1);
});

test('a Central só consulta o banco do Obsidian: nenhuma chamada que grava', async (t) => {
  const { couch, db, cfg } = await cenario(t);
  couch.pedaco('h:1', 'a');
  couch.nota('A.md', ['h:1']);
  couch.nota('B.md', ['h:falta']);
  await notas.sincronizar(db, cfg);
  await notas.sincronizar(db, cfg);
  // No fio: só _changes e _all_docs, que no CouchDB são consultas mesmo com POST.
  assert.deepEqual([...new Set(couch.pedidos)].sort(), ['POST /vault/_all_docs', 'POST /vault/_changes']);
  // No código: nada de PUT, DELETE, _bulk_docs e companhia.
  const fonte = readFileSync(new URL('../src/notas.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(fonte, /method:\s*['"`](PUT|DELETE|PATCH|COPY)/i);
  assert.doesNotMatch(fonte, /_bulk_docs|_purge|_compact|_revs_limit|_security|_design|_index|_find\b/);
  assert.equal((fonte.match(/fetch\(/g) || []).length, 1); // um só ponto de saída: consultar()
});
