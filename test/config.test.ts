// Central dividindo domínio com outro site: caminho base e página sem endereço absoluto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerConfig } from '../src/config.ts';

const env = (extra: Record<string, string>) => ({ CENTRAL_CONFIG: '/nao/existe.json', ...extra });

test('CENTRAL_BASE aceita /central e tira a barra do fim', () => {
  assert.equal(lerConfig(env({})).base, '');
  assert.equal(lerConfig(env({ CENTRAL_BASE: '/central/' })).base, '/central');
  assert.equal(lerConfig(env({ CENTRAL_BASE: '/a/b-2' })).base, '/a/b-2');
});

test('CENTRAL_BASE estranho para a subida', () => {
  for (const b of ['central', '/Central', '/x;y', '/../x', '/a b']) assert.throws(() => lerConfig(env({ CENTRAL_BASE: b })), /CENTRAL_BASE/);
});

test('a página só usa caminhos relativos (funciona em /central/)', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /url\(\/|fetch\(['"`]\//);
});
