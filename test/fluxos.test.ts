import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { abrir } from '../src/db.ts';
import { criarCofre } from '../src/cofre.ts';
import * as espacos from '../src/espacos.ts';
import * as contas from '../src/contas.ts';
import * as caixa from '../src/caixa.ts';

function banco() {
  const db = abrir(':memory:');
  espacos.semear(db, [
    { id: 'vida', nome: 'Vida' },
    { id: 'loja', nome: 'Loja' },
  ]);
  contas.salvar(db, criarCofre(randomBytes(32)), {
    id: 'wa',
    tipo: 'whatsapp',
    nome: 'Caixa',
    espaco_id: 'vida',
  });
  return db;
}
const msg = (o = {}) => ({
  conta: 'wa',
  chave: 'chat',
  titulo: 'Assunto',
  endereco: '5562999990000',
  autor: 'Contato',
  externo: 'm1',
  de_mim: false,
  texto: 'Texto efêmero',
  em: '2026-11-01T10:00:00Z',
  ...o,
});
test('conversão legada e operação repetida não duplicam; payload diferente conflita', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const a = caixa.virarTarefa(db, conversa, {});
  assert.equal(caixa.virarTarefa(db, conversa, {}).id, a.id);
  const dados = {
    titulo: 'Preparar',
    mensagem_id: caixa.obter(db, conversa).mensagens[0].id,
    operacao: 'e443d7df-c32c-4fc4-9dc4-6358a7a348a6',
  };
  const b = caixa.virarTarefa(db, conversa, dados);
  assert.equal(caixa.virarTarefa(db, conversa, dados).id, b.id);
  assert.throws(
    () => caixa.virarTarefa(db, conversa, { ...dados, titulo: 'Outro' }),
    (e) => e.status === 409,
  );
  assert.equal(caixa.obter(db, conversa).tarefas.length, 2);
});
test('pendência mede primeira entrada; mensagem velha não muda edição recente', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  caixa.receber(db, msg({ externo: 'm2', em: '2026-11-02T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).pendente_desde, '2026-11-01T10:00:00.000Z');
  const c = caixa.obter(db, conversa);
  caixa.alterar(db, conversa, { versao: c.versao, estado: 'resolvida', triada: true });
  assert.throws(
    () => caixa.alterar(db, conversa, { versao: c.versao, nota: 'velha' }),
    (e) => e.status === 409,
  );
  caixa.receber(db, msg({ externo: 'antiga', em: '2026-10-01T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).estado, 'resolvida');
  caixa.receber(db, msg({ externo: 'm3', em: '2026-11-03T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).estado, 'responder');
  assert.equal(caixa.obter(db, conversa).pendente_desde, '2026-11-03T10:00:00.000Z');
});

test('falha ao vincular reverte criação da tarefa e auditoria', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const antes = db.prepare('SELECT count(*) n FROM alteracoes').get().n;
  assert.throws(() => caixa.virarTarefa(db, conversa, { titulo: 'Inválida', mensagem_id: 999 }), /mensagem/);
  assert.equal(db.prepare('SELECT count(*) n FROM tarefas').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM alteracoes').get().n, antes);
});
test('vínculos cruzados recusados e conversa vinculada não muda de espaço', async () => {
  const tarefas = await import('../src/tarefas.ts');
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const outra = tarefas.criar(db, { espaco_id: 'loja', titulo: 'Outro espaço' });
  assert.throws(() => caixa.vincular(db, conversa, { tarefa_id: outra.id }), /espaço/);
  caixa.virarTarefa(db, conversa, {});
  assert.throws(
    () => caixa.alterar(db, conversa, { espaco_id: 'loja' }),
    (e) => e.status === 409 && /Desvincule/.test(e.message),
  );
  assert.equal(caixa.obter(db, conversa).espaco_id, 'vida');
});
test('histórico e lista paginam sem repetir datas empatadas; filtros de fluxo', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  caixa.receber(db, msg({ externo: 'm2' }));
  caixa.receber(db, msg({ externo: 'm3' }));
  const primeira = caixa.obter(db, conversa, { limite: 2 });
  assert.equal(primeira.tem_anteriores, true);
  const segunda = caixa.obter(db, conversa, { limite: 2, antes: primeira.mensagens[0].id });
  assert.equal(segunda.mensagens.length, 1);
  assert.equal(segunda.tem_anteriores, false);
  caixa.receber(db, msg({ chave: 'outra' }));
  const lista = caixa.listar(db, { limite: 1 });
  const resto = caixa.listar(db, { antes: Number(lista[0].id) });
  assert.equal(resto.length, 1);
  assert.notEqual(lista[0].id, resto[0].id);
  caixa.alterar(db, conversa, { triada: true, adiada_ate: '2099-01-01T00:00:00Z' });
  assert.equal(caixa.listar(db, { estado: 'adiadas' }).length, 1);
  assert.equal(caixa.listar(db, { estado: 'triar' }).length, 1);
});
test('timeline e Hoje incluem projeto e cobrança preservando campos antigos', async () => {
  const pessoas = await import('../src/pessoas.ts');
  const projetos = await import('../src/projetos.ts');
  const { montarHoje } = await import('../src/hoje.ts');
  const db = banco();
  const pessoa = pessoas.salvar(db, {
    nome: 'Contato',
    espacos: ['vida'],
    canais: [{ tipo: 'whatsapp', valor: '5562999990000' }],
  });
  const p = projetos.criar(db, { espaco_id: 'vida', nome: 'Planejar' });
  const { conversa } = caixa.receber(db, msg());
  caixa.virarTarefa(db, conversa, { projeto_id: p.id });
  caixa.alterar(db, conversa, { estado: 'esperando', cobrar_em: '2026-01-01T00:00:00Z' });
  const linha = pessoas.linhaDoTempo(db, pessoa.id, { espaco: 'vida' });
  assert.ok(linha.eventos.some((e) => e.tipo === 'tarefa'));
  assert.ok(linha.eventos.some((e) => e.tipo === 'conversa'));
  const hoje = await montarHoje(db, []);
  const e = hoje.espacos.find((e) => e.espaco.id === 'vida');
  assert.equal(e.projetos[0].id, p.id);
  assert.equal(e.cobrancas.length, 1);
  assert.ok(Array.isArray(e.vencidas));
});

test('conversões simultâneas em conexões independentes criam uma única tarefa', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Worker } = await import('node:worker_threads');
  const pasta = mkdtempSync(join(tmpdir(), 'central-fluxos-'));
  const caminho = join(pasta, 'banco.sqlite');
  const db = abrir(caminho);
  espacos.semear(db, [{ id: 'vida', nome: 'Vida' }]);
  contas.salvar(db, criarCofre(randomBytes(32)), {
    id: 'wa',
    tipo: 'whatsapp',
    nome: 'Caixa',
    espaco_id: 'vida',
  });
  const { conversa } = caixa.receber(db, msg());
  const codigo = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {abrir}=await import(workerData.db);const caixa=await import(workerData.caixa);const db=abrir(workerData.caminho);try{const t=caixa.virarTarefa(db,workerData.conversa,{titulo:'Simultânea',operacao:'1e834105-1b8e-4f1b-920a-950458eb2331'});parentPort.postMessage({id:t.id});}catch(e){parentPort.postMessage({erro:e.message});}finally{db.close();}})();`;
  const executar = () =>
    new Promise((resolve, reject) => {
      const w = new Worker(codigo, {
        eval: true,
        workerData: {
          db: new URL('../src/db.ts', import.meta.url).href,
          caixa: new URL('../src/caixa.ts', import.meta.url).href,
          caminho,
          conversa,
        },
      });
      w.once('message', resolve);
      w.once('error', reject);
    });
  try {
    const [a, b] = await Promise.all([executar(), executar()]);
    assert.ok(a.id, JSON.stringify(a));
    assert.equal(a.id, b.id);
    assert.equal(db.prepare('SELECT count(*) n FROM tarefas').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM vinculos').get().n, 1);
  } finally {
    db.close();
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('retenção remove texto sem cópia em tarefa ou auditoria', () => {
  const db = banco();
  const { conversa } = caixa.receber(
    db,
    msg({ texto: 'CONTEUDO_EFEMERO_UNICO', em: '2001-01-01T00:00:00Z' }),
  );
  caixa.virarTarefa(db, conversa, { mensagem_id: caixa.obter(db, conversa).mensagens[0].id });
  caixa.reter(db, 1);
  assert.equal(caixa.obter(db, conversa).mensagens[0].texto, '');
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM alteracoes').all()).includes('CONTEUDO_EFEMERO_UNICO'),
    false,
  );
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM tarefas').all()).includes('CONTEUDO_EFEMERO_UNICO'),
    false,
  );
});

test('desvincular permite mover conversa sem mover tarefa', async () => {
  const tarefas = await import('../src/tarefas.ts');
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const tarefa = caixa.virarTarefa(db, conversa, {});
  caixa.desvincular(db, conversa, tarefa.id);
  assert.equal(caixa.obter(db, conversa).tarefas.length, 0);
  assert.equal(caixa.obter(db, conversa).tarefa_id, null);
  caixa.alterar(db, conversa, { espaco_id: 'loja' });
  assert.equal(tarefas.obter(db, tarefa.id).espaco_id, 'vida');
});

test('origem antiga abre janela com mensagem alvo e mantém paginação anterior', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  for (let i = 2; i <= 130; i++)
    caixa.receber(db, msg({ externo: `m${i}`, em: new Date(Date.UTC(2026, 10, 1, 10, i)).toISOString() }));
  const alvo = Number(db.prepare("SELECT id FROM mensagens WHERE externo='m10'").get().id);
  const janela = caixa.obter(db, conversa, { mensagem: alvo, limite: 6 });
  assert.ok(janela.mensagens.some((m) => m.id === alvo));
  assert.equal(janela.mensagens.length, 6);
  assert.equal(janela.tem_anteriores, true);
  const anteriores = caixa.obter(db, conversa, { antes: Number(janela.mensagens[0].id), limite: 6 });
  assert.ok(anteriores.mensagens.every((m) => Number(m.id) < Number(janela.mensagens[0].id)));
  const outra = caixa.receber(db, msg({ chave: 'outra' }));
  assert.throws(
    () => caixa.obter(db, outra.conversa, { mensagem: alvo }),
    (e) => e.status === 400,
  );
});

test('entrada nova limpa visto; duplicata e histórico antigo preservam leitura', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const visto = '2026-11-02T10:00:00.000Z';
  caixa.alterar(db, conversa, { visto_em: visto });
  caixa.receber(db, msg());
  assert.equal(caixa.obter(db, conversa).visto_em, visto);
  caixa.receber(db, msg({ externo: 'velha', em: '2026-10-01T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).visto_em, visto);
  caixa.receber(db, msg({ externo: 'nova', em: '2026-11-03T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).visto_em, null);
});

test('adiamento oculta pendências e cobranças até vencer; entrada nova reativa', async () => {
  const { montarHoje } = await import('../src/hoje.ts');
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  caixa.alterar(db, conversa, { adiada_ate: '2099-01-01T00:00:00Z' });
  assert.equal(caixa.listar(db, { estado: 'responder' }).length, 0);
  assert.equal(caixa.listar(db, { estado: 'adiadas' }).length, 1);
  let h = await montarHoje(db, []);
  assert.equal(h.espacos.find((e) => e.espaco.id === 'vida').conversas.responder, 0);
  caixa.alterar(db, conversa, { estado: 'esperando', cobrar_em: '2000-01-01T00:00:00Z' });
  assert.equal(caixa.listar(db, { estado: 'esperando' }).length, 0);
  assert.equal(caixa.listar(db, { estado: 'cobrar' }).length, 0);
  h = await montarHoje(db, []);
  assert.equal(h.espacos.find((e) => e.espaco.id === 'vida').conversas.esperando, 0);
  assert.equal(h.espacos.find((e) => e.espaco.id === 'vida').cobrancas.length, 0);
  caixa.alterar(db, conversa, { adiada_ate: '2000-01-01T00:00:00Z' });
  assert.equal(caixa.listar(db, { estado: 'cobrar' }).length, 1);
  caixa.alterar(db, conversa, { adiada_ate: '2099-01-01T00:00:00Z' });
  caixa.receber(db, msg({ externo: 'nova', em: '2026-11-03T10:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).adiada_ate, null);
  assert.equal(caixa.listar(db, { estado: 'responder' }).length, 1);
});

test('Hoje considera prazo e lembrete devido sem repetir tarefa em deHoje', async () => {
  const { montarHoje, hojeLocal } = await import('../src/hoje.ts');
  const tarefas = await import('../src/tarefas.ts');
  const db = banco();
  const hoje = hojeLocal();
  const vencida = tarefas.criar(db, {
    espaco_id: 'vida',
    titulo: 'Prazo vencido',
    proxima: hoje,
    prazo: '2000-01-01',
  });
  const prazo = tarefas.criar(db, { espaco_id: 'vida', titulo: 'Prazo hoje', prazo: hoje });
  const lembrete = tarefas.criar(db, {
    espaco_id: 'vida',
    titulo: 'Lembrar',
    lembrete: '2000-01-01T00:00:00Z',
    proxima: hoje,
  });
  tarefas.criar(db, { espaco_id: 'vida', titulo: 'Futuro', lembrete: '2099-01-01T00:00:00Z' });
  const h = await montarHoje(db, []);
  const e = h.espacos.find((e) => e.espaco.id === 'vida');
  assert.deepEqual(
    e.vencidas.map((t) => t.id),
    [vencida.id],
  );
  assert.deepEqual(
    e.deHoje.map((t) => t.id),
    [prazo.id],
  );
  assert.deepEqual(
    e.lembretes.map((t) => t.id),
    [lembrete.id],
  );
});

test('migração corrige ponteiro legado cruzado preservando tarefas e conversão segura', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const pasta = mkdtempSync(join(tmpdir(), 'central-legado-'));
  const caminho = join(pasta, 'banco.sqlite');
  const antigo = new DatabaseSync(caminho);
  try {
    antigo.exec('CREATE TABLE migracoes(nome TEXT PRIMARY KEY,em TEXT NOT NULL)');
    for (const nome of ['0001_nucleo.sql', '0002_acesso_e_caixa.sql']) {
      antigo.exec(readFileSync(new URL('../migrations/' + nome, import.meta.url), 'utf8'));
      antigo.prepare('INSERT INTO migracoes VALUES(?,?)').run(nome, '2026-01-01T00:00:00Z');
    }
    antigo.exec(
      "INSERT INTO espacos(id,nome,criado) VALUES('vida','Vida','2026'),('loja','Loja','2026'); INSERT INTO contas(id,espaco_id,tipo,nome,criado) VALUES('wa','vida','whatsapp','Caixa','2026'); INSERT INTO tarefas(id,espaco_id,titulo,criado,atualizado) VALUES(1,'vida','Preservar','2026','2026'); INSERT INTO conversas(id,conta_id,espaco_id,chave,titulo,tarefa_id,ultima_em) VALUES(1,'wa','loja','chat','Assunto',1,'2026-01-01T00:00:00Z');",
    );
    antigo.close();
    const db = abrir(caminho);
    try {
      assert.equal(caixa.obter(db, 1).tarefa_id, null);
      assert.equal(db.prepare('SELECT espaco_id FROM tarefas WHERE id=1').get().espaco_id, 'vida');
      const nova = caixa.virarTarefa(db, 1, {});
      assert.equal(nova.espaco_id, 'loja');
      assert.notEqual(nova.id, 1);
    } finally {
      db.close();
    }
  } finally {
    if (antigo.isOpen) antigo.close();
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('conversão recusa reutilizar ponteiro legado obsoleto mesmo após migração', async () => {
  const tarefas = await import('../src/tarefas.ts');
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  const cruzada = tarefas.criar(db, { espaco_id: 'loja', titulo: 'Outro espaço' });
  db.prepare('UPDATE conversas SET tarefa_id=? WHERE id=?').run(cruzada.id, conversa);
  const nova = caixa.virarTarefa(db, conversa, {});
  assert.equal(nova.espaco_id, 'vida');
  assert.notEqual(nova.id, cruzada.id);
  assert.equal(caixa.obter(db, conversa).tarefas[0].id, nova.id);
});

test('hojeLocal usa dia de São Paulo na virada UTC', async (t) => {
  const { hojeLocal } = await import('../src/hoje.ts');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T01:30:00Z') });
  assert.equal(hojeLocal(), '2026-11-04');
});
