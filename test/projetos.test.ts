import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrir } from '../src/db.ts';
import * as espacos from '../src/espacos.ts';
import * as tarefas from '../src/tarefas.ts';

test('tarefa preserva campos de projeto e impede edições concorrentes', () => {
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'vida', nome: 'Vida' }]);
  const t = tarefas.criar(db, {
    espaco_id: 'vida',
    titulo: 'Preparar',
    descricao: 'Plano',
    prioridade: 'alta',
    prazo: '2026-12-01',
    checklist: [{ texto: 'Revisar', feito: false }],
  });
  assert.equal(t.descricao, 'Plano');
  assert.equal(t.prioridade, 'alta');
  assert.equal(t.checklist.length, 1);
  tarefas.alterar(db, t.id, { versao: t.versao, titulo: 'Preparado' });
  assert.throws(
    () => tarefas.alterar(db, t.id, { versao: t.versao, titulo: 'Atrasado' }),
    (e) => e.status === 409,
  );
});

test('projetos ativos isolam tarefas e rejeitam vínculos com projeto pausado', async () => {
  const projetos = await import('../src/projetos.ts');
  const db = abrir(':memory:');
  espacos.semear(db, [
    { id: 'vida', nome: 'Vida' },
    { id: 'loja', nome: 'Loja' },
  ]);
  const p = projetos.criar(db, { espaco_id: 'vida', nome: 'Reforma' });
  const t = tarefas.criar(db, { espaco_id: 'vida', titulo: 'Medir', projeto_id: p.id });
  assert.equal(t.projeto_nome, 'Reforma');
  assert.throws(
    () => tarefas.criar(db, { espaco_id: 'loja', titulo: 'Inválida', projeto_id: p.id }),
    /espaço/,
  );
  projetos.alterar(db, p.id, { versao: p.versao, status: 'pausado' });
  assert.throws(
    () => tarefas.criar(db, { espaco_id: 'vida', titulo: 'Inválida', projeto_id: p.id }),
    /ativo/,
  );
  assert.equal(tarefas.listar(db, { projeto: p.id }).length, 1);
});

test('concluir ou arquivar projeto exige resolver todas tarefas abertas', async () => {
  const projetos = await import('../src/projetos.ts');
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'vida', nome: 'Vida' }]);
  const p = projetos.criar(db, { espaco_id: 'vida', nome: 'Planejar' });
  const t = tarefas.criar(db, { espaco_id: 'vida', projeto_id: p.id, titulo: 'Pendente' });
  for (const status of ['concluido', 'arquivado'])
    assert.throws(
      () => projetos.alterar(db, p.id, { status }),
      (e) => e.status === 409 && /1/.test(e.message),
    );
  tarefas.alterar(db, t.id, { status: 'feito' });
  assert.equal(projetos.alterar(db, p.id, { status: 'concluido' }).status, 'concluido');
});

test('editar tarefa mantém associação existente com projeto pausado', async () => {
  const projetos = await import('../src/projetos.ts');
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'vida', nome: 'Vida' }]);
  const p = projetos.criar(db, { espaco_id: 'vida', nome: 'Planejar' });
  const t = tarefas.criar(db, { espaco_id: 'vida', projeto_id: p.id, titulo: 'Preparar' });
  projetos.alterar(db, p.id, { status: 'pausado' });
  assert.equal(tarefas.alterar(db, t.id, { titulo: 'Preparar depois', projeto_id: p.id }).projeto_id, p.id);
});

test('projeto concluído impede reabrir tarefa até ser reativado', async () => {
  const projetos = await import('../src/projetos.ts');
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'vida', nome: 'Vida' }]);
  const p = projetos.criar(db, { espaco_id: 'vida', nome: 'Planejar' });
  const t = tarefas.criar(db, { espaco_id: 'vida', projeto_id: p.id, titulo: 'Preparar' });
  tarefas.alterar(db, t.id, { status: 'feito' });
  projetos.alterar(db, p.id, { status: 'concluido' });
  assert.throws(
    () => tarefas.alterar(db, t.id, { status: 'a-fazer' }),
    (e) => e.status === 409 && /Reative/.test(e.message),
  );
  projetos.alterar(db, p.id, { status: 'ativo' });
  assert.equal(tarefas.alterar(db, t.id, { status: 'a-fazer' }).status, 'a-fazer');
});
