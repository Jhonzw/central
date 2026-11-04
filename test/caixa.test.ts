import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { abrir } from '../src/db.ts';
import { criarCofre } from '../src/cofre.ts';
import * as espacos from '../src/espacos.ts';
import * as pessoas from '../src/pessoas.ts';
import * as contas from '../src/contas.ts';
import * as caixa from '../src/caixa.ts';
import * as whatsapp from '../src/whatsapp.ts';
import { montarHoje } from '../src/hoje.ts';

const cofre = criarCofre(randomBytes(32));

function banco() {
  const db = abrir(':memory:');
  espacos.semear(db, [{ id: 'pessoal', nome: 'Pessoal' }, { id: 'loja', nome: 'Loja' }]);
  contas.salvar(db, cofre, { id: 'wa', tipo: 'whatsapp', nome: 'Meu WhatsApp', espaco_id: 'pessoal' });
  return db;
}
const msg = (o: Partial<caixa.Entrada> = {}): caixa.Entrada => ({
  conta: 'wa', chave: '556299990000@s.whatsapp.net', titulo: 'Bruno', endereco: '556299990000', autor: 'Bruno',
  externo: 'm1', de_mim: false, texto: 'oi', em: '2026-11-03T10:00:00Z', ...o,
});

test('conta de e-mail: senha cifrada, nunca volta, e só IMAP com TLS', () => {
  const db = banco();
  assert.throws(() => contas.salvar(db, cofre, { id: 'gg', tipo: 'email', nome: 'G', espaco_id: 'pessoal', host: 'imap.gmail.com', usuario: 'a@b.com', senha: 'x', porta: 143 }), /993/);
  const c = contas.salvar(db, cofre, { id: 'gmail', tipo: 'email', nome: 'Gmail', espaco_id: 'pessoal', host: 'imap.gmail.com', usuario: 'Eu@Gmail.com', senha: 'abcd efgh' });
  assert.equal(c.tem_senha, true);
  assert.equal(JSON.stringify(c).includes('abcd'), false);
  assert.equal(contas.senha(db, cofre, 'gmail'), 'abcd efgh');
  const cru = db.prepare('SELECT segredo FROM contas WHERE id = ?').get('gmail') as { segredo: string };
  assert.ok(cru.segredo.startsWith('v1:'));
  // O histórico não leva a senha.
  assert.equal(JSON.stringify(db.prepare('SELECT dados FROM alteracoes').all()).includes('abcd'), false);
  assert.throws(() => contas.salvar(db, cofre, { id: 'x1', tipo: 'email', nome: 'X', espaco_id: 'pessoal', host: 'mail.localhost', usuario: 'a@b.com', senha: 'x' }), /interno/);
});

test('estado: chega → responder; respondi → esperando; resolvida reabre; arquivada reabre', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  assert.equal(caixa.obter(db, conversa).estado, 'responder');
  caixa.receber(db, msg({ externo: 'm2', de_mim: true, em: '2026-11-03T10:05:00Z' }));
  assert.equal(caixa.obter(db, conversa).estado, 'esperando');
  caixa.alterar(db, conversa, { estado: 'resolvida' });
  caixa.receber(db, msg({ externo: 'm3', em: '2026-11-03T11:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).estado, 'responder');
  caixa.alterar(db, conversa, { estado: 'arquivada' });
  caixa.receber(db, msg({ externo: 'm4', em: '2026-11-03T12:00:00Z' }));
  assert.equal(caixa.obter(db, conversa).estado, 'responder');
  // Mesma mensagem duas vezes não duplica.
  assert.equal(caixa.receber(db, msg({ externo: 'm4' })).nova, false);
  assert.equal(caixa.obter(db, conversa).mensagens.length, 4);
});

test('acha a pessoa mesmo sem o 9 e põe no espaço dela', () => {
  const db = banco();
  pessoas.salvar(db, { nome: 'Bruno', espacos: ['loja'], canais: [{ tipo: 'whatsapp', valor: '(62) 99999-0000' }] });
  const { conversa } = caixa.receber(db, msg());
  const c = caixa.obter(db, conversa) as unknown as { pessoa_nome: string; espaco_id: string };
  assert.equal(c.pessoa_nome, 'Bruno');
  assert.equal(c.espaco_id, 'loja');
});

test('religar liga a conversa a quem foi cadastrado depois', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  assert.equal((caixa.obter(db, conversa) as unknown as { pessoa_id: null }).pessoa_id, null);
  pessoas.salvar(db, { nome: 'Bruno', espacos: ['loja'], canais: [{ tipo: 'whatsapp', valor: '5562999990000' }] });
  assert.equal(caixa.religar(db), 1);
  assert.equal((caixa.obter(db, conversa) as unknown as { espaco_id: string }).espaco_id, 'loja');
});

test('conversa movida à mão não volta sozinha', () => {
  const db = banco();
  const { conversa } = caixa.receber(db, msg());
  caixa.alterar(db, conversa, { espaco_id: 'pessoal' });
  pessoas.salvar(db, { nome: 'Bruno', espacos: ['loja'], canais: [{ tipo: 'whatsapp', valor: '5562999990000' }] });
  caixa.religar(db);
  assert.equal((caixa.obter(db, conversa) as unknown as { espaco_id: string }).espaco_id, 'pessoal');
});

test('virar tarefa: no espaço da conversa, pessoa só se for de lá', () => {
  const db = banco();
  pessoas.salvar(db, { nome: 'Bruno', espacos: ['loja', 'pessoal'], canais: [{ tipo: 'whatsapp', valor: '5562999990000' }] });
  const { conversa } = caixa.receber(db, msg());
  const t = caixa.virarTarefa(db, conversa, {});
  assert.equal(t.espaco_id, 'pessoal');
  assert.equal(t.pessoa_nome, 'Bruno');
  assert.match(t.origem, /WhatsApp/);
});

test('busca acha sem acento; retenção apaga o texto e a busca junto', () => {
  const db = banco();
  caixa.receber(db, msg({ texto: 'Orçamento da reunião', em: new Date(Date.now() - 100 * 864e5).toISOString() }));
  caixa.receber(db, msg({ externo: 'm2', texto: 'outra coisa', em: new Date().toISOString() }));
  assert.equal(caixa.buscar(db, 'reuniao').conversas.length, 1);
  assert.equal(caixa.reter(db, 90), 1);
  assert.equal(caixa.buscar(db, 'reuniao').conversas.length, 0);
  assert.equal(caixa.buscar(db, 'outra').conversas.length, 1);
});

test('WhatsApp: lote validado, estado e pedido de uso único', () => {
  const db = banco();
  assert.throws(() => whatsapp.receberLote(db, 'wa', { mensagens: [{ chave: 'qualquer', em: 'x' }] }), /chave/);
  assert.equal(whatsapp.receberLote(db, 'wa', { mensagens: [msg(), msg({ externo: 'm2' })] }).novas, 2);
  whatsapp.anotarEstado(db, 'wa', { conectado: true, numero: '5562988887777', senha: 'ignorado' });
  const c = contas.obter(db, 'wa');
  assert.equal(c.estado.conectado, true);
  assert.equal('senha' in c.estado, false);
  assert.equal(c.endereco, '5562988887777');
  whatsapp.pedir(db, 'wa', { acao: 'parear', numero: '+55 62 98888-7777' });
  assert.equal((whatsapp.retirarPedido(db, 'wa').pedido as { numero: string }).numero, '5562988887777');
  assert.equal(whatsapp.retirarPedido(db, 'wa').pedido, null);
});

test('hoje mostra as conversas pedindo resposta por espaço', async () => {
  const db = banco();
  caixa.receber(db, msg());
  const h = await montarHoje(db, []);
  const p = h.espacos.find((e) => e.espaco.id === 'pessoal')!;
  assert.equal(p.conversas.responder, 1);
  assert.equal(h.espacos.find((e) => e.espaco.id === 'loja')!.conversas.responder, 0);
});

test('responder em: WhatsApp pelo número, Gmail pela mensagem, outro e-mail por rascunho', () => {
  const db = banco();
  caixa.receber(db, msg());
  const wa = caixa.listar(db)[0] as { id: number };
  assert.deepEqual(caixa.obter(db, wa.id).responder, { app: 'WhatsApp', url: 'https://wa.me/556299990000' });

  contas.salvar(db, cofre, { id: 'gmail', tipo: 'email', nome: 'Gmail', espaco_id: 'pessoal', host: 'imap.gmail.com', usuario: 'eu@gmail.com', senha: 'x' });
  caixa.receber(db, { conta: 'gmail', chave: '<a1@mail>', titulo: 'Proposta', endereco: 'ana@cliente.com', autor: 'Ana', externo: '<a1@mail>', de_mim: false, assunto: 'Proposta', texto: 'oi', em: '2026-11-03T11:00:00Z' });
  const g = caixa.listar(db, { conta: 'gmail' })[0] as { id: number };
  assert.equal(caixa.obter(db, g.id).responder?.url, 'https://mail.google.com/mail/u/eu%40gmail.com/#search/rfc822msgid%3Aa1%40mail');

  contas.salvar(db, cofre, { id: 'outro', tipo: 'email', nome: 'Outro', espaco_id: 'pessoal', host: 'imap.exemplo.com.br', usuario: 'eu@exemplo.com.br', senha: 'x' });
  caixa.receber(db, { conta: 'outro', chave: '<b1@mail>', titulo: 'Re: Orçamento', endereco: 'bia@cliente.com', autor: 'Bia', externo: '<b1@mail>', de_mim: false, assunto: 'Re: Orçamento', texto: 'oi', em: '2026-11-03T12:00:00Z' });
  const o = caixa.listar(db, { conta: 'outro' })[0] as { id: number };
  assert.equal(caixa.obter(db, o.id).responder?.url, 'mailto:bia@cliente.com?subject=Re%3A%20Or%C3%A7amento');
});
