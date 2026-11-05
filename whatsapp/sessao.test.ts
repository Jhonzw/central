// Precisa das dependências do WhatsApp (npm install em whatsapp/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { criarCofre } from '../src/cofre.ts';
import { sessaoCifrada } from './sessao.ts';

test('sessão grava cifrada e volta igual, com Buffer e tudo', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'wa-'));
  const cofre = criarCofre(randomBytes(32));
  const s = await sessaoCifrada(pasta, cofre);
  await s.salvarCreds();
  await s.state.keys.set({ 'pre-key': { '1': { public: Buffer.from('chave-publica'), private: Buffer.from('chave-privada') } } });
  for (const f of readdirSync(pasta)) assert.equal(readFileSync(join(pasta, f), 'utf8').includes('chave-privada'), false);
  const de = await sessaoCifrada(pasta, cofre);
  assert.deepEqual(de.state.creds.noiseKey, s.state.creds.noiseKey);
  const k = await de.state.keys.get('pre-key', ['1', '2']) as Record<string, { private: Buffer } | null>;
  assert.deepEqual(k['1']!.private, Buffer.from('chave-privada'));
  assert.equal(k['2'], null);
  // Com outra chave não abre: começa do zero.
  const outra = await sessaoCifrada(pasta, criarCofre(randomBytes(32)));
  assert.equal(outra.state.creds.registered, false);
  assert.notDeepEqual(outra.state.creds.noiseKey, s.state.creds.noiseKey);
  rmSync(pasta, { recursive: true, force: true });
});

test('apagar a sessão esvazia a pasta mas não remove a pasta (é um volume no servidor)', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'wa-'));
  const s = await sessaoCifrada(pasta, criarCofre(randomBytes(32)));
  await s.salvarCreds();
  assert.ok(readdirSync(pasta).length > 0);
  await s.apagarTudo();
  assert.deepEqual(readdirSync(pasta), []);
  rmSync(pasta, { recursive: true, force: true });
});
