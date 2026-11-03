import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { abrir } from '../src/db.ts';
import { criarCofre } from '../src/cofre.ts';
import * as totp from '../src/totp.ts';
import * as acesso from '../src/acesso.ts';

const cofre = criarCofre(randomBytes(32));

test('TOTP bate com o vetor da RFC 6238', () => {
  const segredo = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(totp.codigo(segredo, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codigo(segredo, Math.floor(1111111109 / 30)), '081804');
  assert.deepEqual(totp.deBase32(segredo), Buffer.from('12345678901234567890'));
});

test('TOTP aceita um passo de folga e recusa o resto', () => {
  const s = totp.novoSegredo();
  const agora = Date.now();
  assert.notEqual(totp.verificar(s, totp.codigo(s, totp.passoAtual(agora) - 1), agora), null);
  assert.equal(totp.verificar(s, totp.codigo(s, totp.passoAtual(agora) - 3), agora), null);
  assert.equal(totp.verificar(s, 'abc123', agora), null);
});

test('cofre decifra só com a mesma chave e o mesmo contexto', () => {
  const c = cofre.cifrar('senha-de-app', 'conta:gmail');
  assert.notEqual(c, 'senha-de-app');
  assert.equal(cofre.decifrar(c, 'conta:gmail'), 'senha-de-app');
  assert.throws(() => cofre.decifrar(c, 'conta:outra'));
  assert.throws(() => criarCofre(randomBytes(32)).decifrar(c, 'conta:gmail'));
});

async function configurar(db: ReturnType<typeof abrir>, senha = 'uma senha bem comprida') {
  const convite = acesso.criarConvite(db);
  const { segredo } = await acesso.abrirConvite(db, cofre, { convite, senha, ip: '1.1.1.1' });
  // Ativa com o código do passo anterior, para o login de logo depois ter um passo novo.
  acesso.ativarConvite(db, cofre, { convite, codigo: totp.codigo(segredo, totp.passoAtual() - 1), ip: '1.1.1.1' });
  return segredo;
}

test('convite: senha curta recusada, convite vale uma vez só', async () => {
  const db = abrir(':memory:');
  const convite = acesso.criarConvite(db);
  await assert.rejects(acesso.abrirConvite(db, cofre, { convite, senha: 'curta', ip: 'x' }), /12 caracteres/);
  const { segredo } = await acesso.abrirConvite(db, cofre, { convite, senha: 'uma senha bem comprida', ip: 'x' });
  assert.throws(() => acesso.ativarConvite(db, cofre, { convite, codigo: '000000', ip: 'x' }), /não confere/);
  acesso.ativarConvite(db, cofre, { convite, codigo: totp.codigo(segredo), ip: 'x' });
  assert.ok(acesso.configurado(db));
  await assert.rejects(acesso.abrirConvite(db, cofre, { convite, senha: 'outra senha comprida', ip: 'x' }), /convite inválido/);
});

test('entrar pede senha e código, e o mesmo código não vale duas vezes', async () => {
  const db = abrir(':memory:');
  const segredo = await configurar(db);
  const cod = totp.codigo(segredo);
  await assert.rejects(acesso.entrar(db, cofre, { senha: 'errada errada', codigo: cod, ip: '2.2.2.2', agente: '' }), /senha ou código errado/);
  const token = await acesso.entrar(db, cofre, { senha: 'uma senha bem comprida', codigo: cod, ip: '2.2.2.2', agente: 'teste' });
  assert.ok(acesso.sessaoValida(db, token));
  await assert.rejects(acesso.entrar(db, cofre, { senha: 'uma senha bem comprida', codigo: cod, ip: '2.2.2.2', agente: '' }), /senha ou código errado/);
  // No banco só fica o hash da sessão.
  const s = db.prepare('SELECT hash FROM sessoes').get() as { hash: string };
  assert.notEqual(s.hash, token);
  acesso.sair(db, token);
  assert.equal(acesso.sessaoValida(db, token), false);
});

test('cinco erros travam o IP; os outros IPs continuam', async () => {
  const db = abrir(':memory:');
  const segredo = await configurar(db);
  for (let i = 0; i < 5; i++) await assert.rejects(acesso.entrar(db, cofre, { senha: 'x'.repeat(12), codigo: '000000', ip: '3.3.3.3', agente: '' }));
  await assert.rejects(acesso.entrar(db, cofre, { senha: 'uma senha bem comprida', codigo: totp.codigo(segredo), ip: '3.3.3.3', agente: '' }), /muitas tentativas/);
  assert.ok(await acesso.entrar(db, cofre, { senha: 'uma senha bem comprida', codigo: totp.codigo(segredo), ip: '4.4.4.4', agente: '' }));
});

test('trocar senha pelo convite derruba as sessões', async () => {
  const db = abrir(':memory:');
  const segredo = await configurar(db);
  const token = await acesso.entrar(db, cofre, { senha: 'uma senha bem comprida', codigo: totp.codigo(segredo), ip: 'x', agente: '' });
  await configurar(db, 'senha nova bem comprida');
  assert.equal(acesso.sessaoValida(db, token), false);
});

test('token: escopo validado, só o hash guardado, revogado não vale', () => {
  const db = abrir(':memory:');
  assert.throws(() => acesso.criarToken(db, 'x', 'tudo'), /escopo/);
  const { token, registro } = acesso.criarToken(db, 'Painel', 'fonte:painel-a');
  assert.ok(token.startsWith('cen_'));
  assert.equal(acesso.conferirToken(db, token)?.escopo, 'fonte:painel-a');
  assert.equal(db.prepare('SELECT count(*) n FROM tokens WHERE hash = ?').get(token)!.n, 0);
  acesso.revogarToken(db, registro.id);
  assert.equal(acesso.conferirToken(db, token), null);
});
