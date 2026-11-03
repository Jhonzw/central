import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrir } from '../src/db.ts';
import * as espacos from '../src/espacos.ts';
import * as pessoas from '../src/pessoas.ts';
import * as tarefas from '../src/tarefas.ts';
import { montarHoje, hojeLocal } from '../src/hoje.ts';

function banco() {
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'pessoal', nome: 'Pessoal' }, { id: 'empresa-a', nome: 'Empresa A' }]);
  return db;
}

test('migração cria as tabelas e semear não duplica', () => {
  const db = banco();
  espacos.semear(db, [{ id: 'pessoal', nome: 'Outro nome' }]);
  assert.equal(espacos.listar(db).length, 2);
  assert.equal(espacos.obter(db, 'pessoal').nome, 'Pessoal');
});

test('id de espaço inválido é recusado', () => {
  assert.throws(() => espacos.salvar(banco(), { id: 'Com Espaço', nome: 'x' }), /id do espaço/);
});

test('canal é normalizado e não pode ser de duas pessoas', () => {
  const db = banco();
  const p = pessoas.salvar(db, { nome: 'Ana', espacos: ['pessoal'], canais: [{ tipo: 'whatsapp', valor: '(62) 99999-0000' }, { tipo: 'email', valor: 'Ana@X.com' }] });
  assert.deepEqual(p.canais.map((c) => c.valor).sort(), ['5562999990000', 'ana@x.com']);
  assert.throws(() => pessoas.salvar(db, { nome: 'Outra', canais: [{ tipo: 'whatsapp', valor: '5562999990000' }] }), /já é de outra pessoa/);
  // A mesma pessoa pode regravar os próprios canais.
  pessoas.salvar(db, { nome: 'Ana Maria', canais: [{ tipo: 'whatsapp', valor: '62999990000' }] }, p.id);
  assert.equal(pessoas.obter(db, p.id).canais.length, 1);
});

test('busca por pedaço do número acha a pessoa', () => {
  const db = banco();
  pessoas.salvar(db, { nome: 'Bruno', espacos: ['empresa-a'], canais: [{ tipo: 'telefone', valor: '62 3333-4444' }] });
  assert.equal(pessoas.listar(db, { q: '3333-4444' }).length, 1);
  assert.equal(pessoas.listar(db, { espaco: 'pessoal' }).length, 0);
});

test('tarefa não aceita pessoa de outro espaço', () => {
  const db = banco();
  const p = pessoas.salvar(db, { nome: 'Carla', espacos: ['empresa-a'] });
  assert.throws(() => tarefas.criar(db, { espaco_id: 'pessoal', titulo: 'x', pessoa_id: p.id }), /não está neste espaço/);
  const t = tarefas.criar(db, { espaco_id: 'empresa-a', titulo: 'Cobrar retorno', pessoa_id: p.id, nota: 'liguei' });
  assert.equal(t.pessoa_nome, 'Carla');
  assert.equal(t.anotacoes.length, 1);
});

test('fechar e reabrir tarefa mexe no concluido; anotação apaga', () => {
  const db = banco();
  const t = tarefas.criar(db, { espaco_id: 'pessoal', titulo: 'x', nota: 'a' });
  const f = tarefas.alterar(db, t.id, { status: 'feito' });
  assert.ok(f.concluido);
  assert.equal(tarefas.listar(db, { espaco: 'pessoal' }).length, 0);
  const r = tarefas.alterar(db, t.id, { status: 'fazendo', apagarAnotacao: t.anotacoes[0].id });
  assert.equal(r.concluido, null);
  assert.equal(r.anotacoes.length, 0);
});

test('toda escrita fica em alteracoes', () => {
  const db = banco();
  tarefas.criar(db, { espaco_id: 'pessoal', titulo: 'x' });
  const n = db.prepare("SELECT count(*) n FROM alteracoes WHERE tabela = 'tarefas'").get() as { n: number };
  assert.equal(n.n, 1);
});

test('hoje separa vencidas e de hoje por espaço', async () => {
  const db = banco();
  const hoje = hojeLocal();
  tarefas.criar(db, { espaco_id: 'pessoal', titulo: 'velha', proxima: '2020-01-01' });
  tarefas.criar(db, { espaco_id: 'empresa-a', titulo: 'hoje', proxima: hoje });
  const h = await montarHoje(db, []);
  const por = Object.fromEntries(h.espacos.map((e) => [e.espaco.id, e]));
  assert.equal(por.pessoal.vencidas.length, 1);
  assert.equal(por['empresa-a'].deHoje.length, 1);
  assert.equal(por['empresa-a'].vencidas.length, 0);
});
