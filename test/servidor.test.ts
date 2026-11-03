// Sobe o servidor de verdade num banco temporário e passa pelas travas:
// convite → senha → autenticador → sessão; Host; X-Central; tokens por escopo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import * as totp from '../src/totp.ts';

const PORTA = 17800;
const base = `http://127.0.0.1:${PORTA}`;
let proc: ChildProcess;
let pasta: string;
let env: NodeJS.ProcessEnv;
let sessao = '';

before(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'central-'));
  writeFileSync(join(pasta, 'local.json'), JSON.stringify({
    nome: 'Teste', espacos: [{ id: 'pessoal', nome: 'Pessoal' }, { id: 'loja', nome: 'Loja' }],
    conectores: [{ id: 'painel', espaco: 'loja', tipo: 'resumo-push', nome: 'Painel da loja' }],
  }));
  env = { ...process.env, CENTRAL_PORTA: String(PORTA), CENTRAL_BANCO: join(pasta, 'c.sqlite3'), CENTRAL_CONFIG: join(pasta, 'local.json'), CENTRAL_CHAVE_ARQ: join(pasta, 'chave') };
  proc = spawn(process.execPath, ['src/server.ts'], { env, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/sessao`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('servidor não subiu');
});
after(() => { proc.kill(); rmSync(pasta, { recursive: true, force: true }); });

const admin = (...args: string[]) => execFileSync(process.execPath, ['src/admin.ts', ...args], { env, encoding: 'utf8' });
const chamar = (metodo: string, caminho: string, corpo?: unknown, cab: Record<string, string> = {}) =>
  fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Central': '1', ...(sessao ? { Cookie: sessao } : {}), ...cab }, body: corpo ? JSON.stringify(corpo) : undefined });

test('sem dono: a API fecha e a página abre com CSP', async () => {
  assert.equal((await chamar('GET', '/api/hoje')).status, 401);
  const p = await fetch(base + '/');
  const csp = p.headers.get('content-security-policy')!;
  assert.match(csp, /script-src 'sha256-[^']+'/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(p.headers.get('x-frame-options'), 'DENY');
  assert.deepEqual(await (await fetch(base + '/api/sessao')).json(), { logado: false, configurado: false });
});

test('Host estranho é recusado', async () => {
  // fetch ignora Host trocado; node:http manda o que se pede.
  const status = await new Promise((ok, falha) => {
    request({ host: '127.0.0.1', port: PORTA, path: '/api/sessao', headers: { Host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode); })
      .on('error', falha).end();
  });
  assert.equal(status, 421);
});

test('convite pelo admin, senha e autenticador, depois entrar', async () => {
  const convite = admin('convite').match(/#convite=(cvt_[\w-]+)/)![1];
  assert.equal((await chamar('POST', '/api/convite/abrir', { convite, senha: 'senha comprida de teste' }, { 'X-Central': '' })).status, 403);
  const { segredo } = await (await chamar('POST', '/api/convite/abrir', { convite, senha: 'senha comprida de teste' })).json();
  assert.equal((await chamar('POST', '/api/convite/ativar', { convite, codigo: totp.codigo(segredo, totp.passoAtual() - 1) })).status, 200);
  assert.equal((await chamar('POST', '/api/entrar', { senha: 'senha comprida de teste', codigo: '000000' })).status, 401);
  const r = await chamar('POST', '/api/entrar', { senha: 'senha comprida de teste', codigo: totp.codigo(segredo) });
  assert.equal(r.status, 200);
  const ck = r.headers.get('set-cookie')!;
  assert.match(ck, /__Host-central=ses_[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  sessao = ck.split(';')[0];
  assert.equal((await chamar('GET', '/api/hoje')).status, 200);
});

test('logado: escrita sem X-Central é 403 e erro de entrada vira 400/404', async () => {
  assert.equal((await chamar('POST', '/api/tarefas', { espaco_id: 'pessoal', titulo: 'x' }, { 'X-Central': '' })).status, 403);
  assert.equal((await chamar('POST', '/api/tarefas', { espaco_id: 'pessoal', titulo: 'Testar' })).status, 200);
  assert.equal((await chamar('POST', '/api/tarefas', { espaco_id: 'nao-existe', titulo: 'x' })).status, 404);
  assert.equal((await chamar('POST', '/api/tarefas', { espaco_id: 'pessoal', titulo: '' })).status, 400);
});

test('fonte empurrada: só o token dela entra, e o item aparece no Hoje', async () => {
  const token = admin('token', 'Painel', 'fonte:painel').match(/cen_[\w-]+/)![0];
  const outro = admin('token', 'MCP', 'leitura').match(/cen_[\w-]+/)![0];
  const empurrar = (t: string) => fetch(`${base}/api/ingest/resumo/painel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ itens: [{ titulo: '3 pedidos parados', qtd: 3, urgente: true, link: 'javascript:alert(1)' }] }) });
  assert.equal((await empurrar('cen_inventado')).status, 401);
  assert.equal((await empurrar(outro)).status, 403);
  assert.equal((await empurrar(token)).status, 200);
  const h = await (await chamar('GET', '/api/hoje')).json();
  const loja = h.espacos.find((e: { espaco: { id: string } }) => e.espaco.id === 'loja');
  assert.equal(loja.fontes[0].itens[0].titulo, '3 pedidos parados');
  assert.equal(loja.fontes[0].itens[0].link, '');
});

test('token de leitura lê, mas não escreve nem vê contas e tokens', async () => {
  const t = admin('token', 'MCP 2', 'leitura').match(/cen_[\w-]+/)![0];
  const com = (m: string, c: string, corpo?: unknown) => fetch(base + c, { method: m, headers: { 'Content-Type': 'application/json', 'X-Central': '1', Authorization: `Bearer ${t}` }, body: corpo ? JSON.stringify(corpo) : undefined });
  assert.equal((await com('GET', '/api/tarefas')).status, 200);
  assert.equal((await com('GET', '/api/busca?q=testar')).status, 200);
  assert.equal((await com('POST', '/api/tarefas', { espaco_id: 'pessoal', titulo: 'x' })).status, 401);
  assert.equal((await com('GET', '/api/contas')).status, 401);
  assert.equal((await com('GET', '/api/tokens')).status, 401);
});

test('MCP: lista só ferramentas de leitura e consulta a Central com o token', async () => {
  const t = admin('token', 'MCP 3', 'leitura').match(/cen_[\w-]+/)![0];
  const mcp = spawn(process.execPath, ['mcp/central-mcp.ts'], { env: { ...process.env, CENTRAL_URL: `http://localhost:${PORTA}`, CENTRAL_TOKEN: t }, stdio: 'pipe' });
  const respostas: Array<{ id: number; result: { tools?: Array<{ name: string; annotations: { readOnlyHint: boolean } }>; content?: Array<{ text: string }> } }> = [];
  let buf = '';
  mcp.stdout!.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { respostas.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const mandar = (o: unknown) => mcp.stdin!.write(JSON.stringify(o) + '\n');
  mandar({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  mandar({ jsonrpc: '2.0', method: 'notifications/initialized' });
  mandar({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  mandar({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tarefas', arguments: { espaco: 'pessoal' } } });
  for (let i = 0; i < 50 && respostas.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
  mcp.kill();
  const lista = respostas.find((r) => r.id === 2)!.result.tools!;
  assert.ok(lista.length >= 5 && lista.every((f) => f.annotations.readOnlyHint));
  assert.match(respostas.find((r) => r.id === 3)!.result.content![0].text, /Testar/);
});

test('sair encerra a sessão', async () => {
  assert.equal((await chamar('POST', '/api/sair', {})).status, 200);
  assert.equal((await chamar('GET', '/api/hoje')).status, 401);
});
