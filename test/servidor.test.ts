// Sobe o servidor de verdade num banco temporário e confere as travas de escrita.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORTA = 17800;
const base = `http://127.0.0.1:${PORTA}`;
let proc: ChildProcess;
let pasta: string;

before(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'central-'));
  proc = spawn(process.execPath, ['src/server.ts'], { env: { ...process.env, CENTRAL_PORTA: String(PORTA), CENTRAL_BANCO: join(pasta, 'c.sqlite3') }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/espacos`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('servidor não subiu');
});
after(() => { proc.kill(); rmSync(pasta, { recursive: true, force: true }); });

const post = (caminho: string, corpo: unknown, cab: Record<string, string> = { 'X-Central': '1' }) =>
  fetch(base + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cab }, body: JSON.stringify(corpo) });

test('escrita sem X-Central é 403', async () => {
  assert.equal((await post('/api/tarefas', { espaco_id: 'pessoal', titulo: 'x' }, {})).status, 403);
});

test('Host estranho é recusado', async () => {
  // fetch ignora Host trocado; node:http manda o que se pede.
  const { request } = await import('node:http');
  const status = await new Promise((ok, falha) => {
    request({ host: '127.0.0.1', port: PORTA, path: '/api/espacos', headers: { Host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode); })
      .on('error', falha).end();
  });
  assert.equal(status, 421);
});

test('cria tarefa e erro de entrada vira 400/404', async () => {
  const ok = await post('/api/tarefas', { espaco_id: 'pessoal', titulo: 'Testar' });
  assert.equal(ok.status, 200);
  assert.equal((await post('/api/tarefas', { espaco_id: 'nao-existe', titulo: 'x' })).status, 404);
  assert.equal((await post('/api/tarefas', { espaco_id: 'pessoal', titulo: '' })).status, 400);
  const h = await (await fetch(`${base}/api/hoje`)).json();
  assert.ok(h.espacos.length >= 1);
});
