#!/usr/bin/env node
// Central: espaços por empresa, pessoas, tarefas, caixa de e-mail e WhatsApp
// e o dia juntando tudo.
//
// Travas, na ordem em que valem:
//   1. Host fora da lista recebe 421 (contra DNS rebinding).
//   2. Cabeçalhos de segurança em toda resposta (CSP só com o hash do script
//      da página, sem moldura, sem referer).
//   3. /api/ingest/* só com token de máquina, e cada token vale para uma fonte.
//   4. O resto da API exige sessão do dono (cookie HttpOnly, SameSite=Strict);
//      leitura também aceita token 'leitura' (o MCP).
//   5. Escrita exige o cabeçalho X-Central: outra página aberta no navegador não
//      manda esse cabeçalho sem passar pelo preflight de CORS, que aqui não existe.
//
//   node src/server.ts   ->  http://localhost:7800

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { abrir, ErroDeEntrada } from './db.ts';
import { lerConfig } from './config.ts';
import { lerOuCriarChave, criarCofre } from './cofre.ts';
import * as acesso from './acesso.ts';
import * as espacos from './espacos.ts';
import * as pessoas from './pessoas.ts';
import * as tarefas from './tarefas.ts';
import * as contas from './contas.ts';
import * as caixa from './caixa.ts';
import * as whatsapp from './whatsapp.ts';
import { montarHoje } from './hoje.ts';
import { validarConfig, guardarEmpurrado } from './conectores/index.ts';
import { iniciarColetor, lerConta } from './email/coletor.ts';
import { agendar } from './manutencao.ts';

const cfg = lerConfig();
const db = abrir(cfg.banco);
const cofre = criarCofre(lerOuCriarChave(cfg.chave));

espacos.semear(db, cfg.espacos);
validarConfig(cfg.conectores, espacos.listar(db, { comArquivados: true }).map((e) => e.id));
// emailMinutos 0 desliga a leitura automática (demonstração, testes).
const coletor = cfg.emailMinutos > 0 ? iniciarColetor(db, cofre, { minutos: cfg.emailMinutos }) : null;
agendar(db, cfg);

const HOSTS = new Set([`localhost:${cfg.porta}`, `127.0.0.1:${cfg.porta}`, ...cfg.hosts]);
const COOKIE = '__Host-central';
const WEB = new URL('./web/', import.meta.url);

type Pedido = { req: IncomingMessage; res: ServerResponse; url: URL; ip: string; m: RegExpMatchArray };

// ---------- Respostas ----------

function seguranca(res: ServerResponse, csp: string) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (cfg.https) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
const CSP_API = "default-src 'none'; frame-ancestors 'none'";

const json = (res: ServerResponse, codigo: number, corpo: unknown) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
};

async function lerCorpo(req: IncomingMessage, limite = 64000): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new ErroDeEntrada('mande Content-Type: application/json', 415);
  let corpo = '';
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > limite) throw new ErroDeEntrada('corpo grande demais', 413);
  }
  try {
    const v = JSON.parse(corpo || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ErroDeEntrada('JSON inválido');
  }
}

function cookie(req: IncomingMessage): string | undefined {
  for (const p of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
}
const marcarSessao = (res: ServerResponse, token: string, segundos: number) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${segundos}`);

function ipDe(req: IncomingMessage): string {
  const direto = req.socket.remoteAddress || '';
  // Só confia no X-Real-IP atrás do nginx (que sobrescreve o cabeçalho).
  return (cfg.proxy && String(req.headers['x-real-ip'] || '').slice(0, 64)) || direto;
}

// A página: o CSP leva o hash do script embutido, então nenhum outro script roda.
async function pagina(res: ServerResponse) {
  const html = await readFile(new URL('index.html', WEB), 'utf8');
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  seguranca(res, `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; `
    + "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const FONTES = /^\/fontes\/([a-z0-9-]+\.woff2)$/;
async function fonte(res: ServerResponse, nome: string) {
  try {
    const f = await readFile(new URL(`fontes/${nome}`, WEB));
    res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(f);
  } catch {
    json(res, 404, { erro: 'não encontrado' });
  }
}

// ---------- Rotas ----------

type Fn = (p: Pedido) => Promise<unknown> | unknown;
const id = (p: Pedido) => Number(p.m[1]);
const q = (p: Pedido, k: string) => p.url.searchParams.get(k) || undefined;

// Abertas: entrar e o primeiro acesso.
const PUBLICAS: Array<[string, RegExp, Fn]> = [
  ['GET', /^\/api\/sessao$/, ({ req }) => ({ logado: acesso.sessaoValida(db, cookie(req)), configurado: acesso.configurado(db) })],
  ['POST', /^\/api\/entrar$/, async ({ req, res, ip }) => {
    const b = await lerCorpo(req);
    const token = await acesso.entrar(db, cofre, { senha: b.senha, codigo: b.codigo, ip, agente: String(req.headers['user-agent'] || '') });
    marcarSessao(res, token, 30 * 86400);
    return { ok: true };
  }],
  ['POST', /^\/api\/convite\/abrir$/, async ({ req, ip }) => { const b = await lerCorpo(req); return acesso.abrirConvite(db, cofre, { convite: b.convite, senha: b.senha, ip }); }],
  ['POST', /^\/api\/convite\/ativar$/, async ({ req, ip }) => { const b = await lerCorpo(req); acesso.ativarConvite(db, cofre, { convite: b.convite, codigo: b.codigo, ip }); return { ok: true }; }],
];

// Máquinas (token no Authorization). escopo(p) diz qual token a rota aceita.
const INGESTAO: Array<[string, RegExp, (p: Pedido) => string, Fn]> = [
  ['POST', /^\/api\/ingest\/resumo\/([a-z0-9-]+)$/, (p) => `fonte:${p.m[1]}`, async (p) => {
    const c = cfg.conectores.find((x) => x.id === p.m[1] && x.tipo === 'resumo-push');
    if (!c) throw new ErroDeEntrada('conector não existe ou não é resumo-push', 404);
    return { recebidos: guardarEmpurrado(db, c, (await lerCorpo(p.req)).itens) };
  }],
  ['POST', /^\/api\/ingest\/whatsapp\/([a-z0-9-]+)\/mensagens$/, (p) => `whatsapp:${p.m[1]}`, async (p) => whatsapp.receberLote(db, p.m[1], await lerCorpo(p.req, 2e6))],
  ['POST', /^\/api\/ingest\/whatsapp\/([a-z0-9-]+)\/estado$/, (p) => `whatsapp:${p.m[1]}`, async (p) => whatsapp.anotarEstado(db, p.m[1], await lerCorpo(p.req))],
  ['GET', /^\/api\/ingest\/whatsapp\/([a-z0-9-]+)\/pedido$/, (p) => `whatsapp:${p.m[1]}`, (p) => whatsapp.retirarPedido(db, p.m[1])],
];

// Do dono. As de leitura marcadas com `true` também aceitam token 'leitura'.
const DO_DONO: Array<[string, RegExp, Fn, boolean?]> = [
  ['POST', /^\/api\/sair$/, ({ req, res }) => { acesso.sair(db, cookie(req)); marcarSessao(res, '', 0); return { ok: true }; }],
  ['GET', /^\/api\/sessoes$/, () => acesso.listarSessoes(db)],
  ['POST', /^\/api\/sessoes\/sair-de-todas$/, ({ res }) => { marcarSessao(res, '', 0); return { saiu: acesso.sairDeTodas(db) }; }],

  ['GET', /^\/api\/hoje$/, (p) => montarHoje(db, cfg.conectores, { forcar: p.url.searchParams.has('forcar') }), true],
  ['GET', /^\/api\/vocabulario$/, () => ({ status: tarefas.STATUS, abertos: tarefas.ABERTOS, estados: caixa.ESTADOS, nome: cfg.nome }), true],
  ['GET', /^\/api\/espacos$/, (p) => espacos.listar(db, { comArquivados: p.url.searchParams.has('todos') }), true],
  ['POST', /^\/api\/espacos$/, async (p) => espacos.salvar(db, await lerCorpo(p.req))],

  ['GET', /^\/api\/pessoas$/, (p) => pessoas.listar(db, { espaco: q(p, 'espaco'), q: q(p, 'q') }), true],
  ['POST', /^\/api\/pessoas$/, async (p) => { const r = pessoas.salvar(db, await lerCorpo(p.req)); caixa.religar(db); return r; }],
  ['GET', /^\/api\/pessoas\/(\d+)$/, (p) => pessoas.obter(db, id(p)), true],
  ['PUT', /^\/api\/pessoas\/(\d+)$/, async (p) => { const r = pessoas.salvar(db, await lerCorpo(p.req), id(p)); caixa.religar(db); return r; }],
  ['DELETE', /^\/api\/pessoas\/(\d+)$/, (p) => { pessoas.apagar(db, id(p)); return { ok: true }; }],

  ['GET', /^\/api\/tarefas$/, (p) => tarefas.listar(db, { espaco: q(p, 'espaco'), abertas: !p.url.searchParams.has('todas'), pessoa: Number(q(p, 'pessoa')) || undefined }), true],
  ['POST', /^\/api\/tarefas$/, async (p) => tarefas.criar(db, await lerCorpo(p.req))],
  ['GET', /^\/api\/tarefas\/(\d+)$/, (p) => tarefas.obter(db, id(p)), true],
  ['PATCH', /^\/api\/tarefas\/(\d+)$/, async (p) => tarefas.alterar(db, id(p), await lerCorpo(p.req))],

  ['GET', /^\/api\/conversas$/, (p) => caixa.listar(db, { espaco: q(p, 'espaco'), estado: q(p, 'estado'), conta: q(p, 'conta') }), true],
  ['GET', /^\/api\/conversas\/(\d+)$/, (p) => caixa.obter(db, id(p)), true],
  ['PATCH', /^\/api\/conversas\/(\d+)$/, async (p) => caixa.alterar(db, id(p), await lerCorpo(p.req))],
  ['POST', /^\/api\/conversas\/(\d+)\/tarefa$/, async (p) => caixa.virarTarefa(db, id(p), await lerCorpo(p.req))],
  ['GET', /^\/api\/busca$/, (p) => caixa.buscar(db, String(q(p, 'q') || ''), { espaco: q(p, 'espaco') }), true],

  ['GET', /^\/api\/contas$/, () => contas.listar(db)],
  ['POST', /^\/api\/contas$/, async (p) => contas.salvar(db, cofre, await lerCorpo(p.req))],
  ['DELETE', /^\/api\/contas\/([a-z0-9-]+)$/, (p) => { contas.apagar(db, p.m[1]); return { ok: true }; }],
  ['POST', /^\/api\/contas\/([a-z0-9-]+)\/ler$/, async (p) => lerConta(db, cofre, p.m[1]).catch((e: Error) => { throw new ErroDeEntrada(e.message, 502); })],
  ['POST', /^\/api\/contas\/([a-z0-9-]+)\/whatsapp$/, async (p) => whatsapp.pedir(db, p.m[1], await lerCorpo(p.req))],

  ['GET', /^\/api\/conectores$/, () => cfg.conectores.map(({ id, nome, espaco, tipo }) => ({ id, nome, espaco, tipo }))],
  ['GET', /^\/api\/tokens$/, () => acesso.listarTokens(db)],
  ['POST', /^\/api\/tokens$/, async (p) => { const b = await lerCorpo(p.req); return acesso.criarToken(db, b.nome, b.escopo); }],
  ['DELETE', /^\/api\/tokens\/(\d+)$/, (p) => { acesso.revogarToken(db, id(p)); return { ok: true }; }],
];

function casar<T extends [string, RegExp, ...unknown[]]>(lista: T[], metodo: string, caminho: string): [T, RegExpMatchArray] | null {
  for (const r of lista) {
    const m = caminho.match(r[1]);
    if (m && r[0] === metodo) return [r, m];
  }
  return null;
}

const portador = (req: IncomingMessage): string => String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';

async function atender(req: IncomingMessage, res: ServerResponse) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!HOSTS.has(host)) return json(res, 421, { erro: 'host não permitido' });
  const url = new URL(req.url ?? '/', 'http://localhost');
  const metodo = req.method || 'GET';
  const ip = ipDe(req);

  if (metodo === 'GET' && url.pathname === '/') return pagina(res);
  const f = url.pathname.match(FONTES);
  if (metodo === 'GET' && f) return fonte(res, f[1]);
  seguranca(res, CSP_API);

  const pub = casar(PUBLICAS, metodo, url.pathname);
  if (pub) {
    if (metodo !== 'GET' && req.headers['x-central'] !== '1') return json(res, 403, { erro: 'sem cabeçalho X-Central' });
    return json(res, 200, await pub[0][2]({ req, res, url, ip, m: pub[1] }));
  }

  const ing = casar(INGESTAO, metodo, url.pathname);
  if (ing) {
    const p = { req, res, url, ip, m: ing[1] };
    if (acesso.travado(db, ip)) return json(res, 429, { erro: 'muitas tentativas erradas; espere 15 minutos' });
    const t = acesso.conferirToken(db, portador(req));
    if (!t) { acesso.anotarFalha(db, ip); return json(res, 401, { erro: 'token inválido' }); }
    if (t.escopo !== ing[0][2](p)) return json(res, 403, { erro: 'este token não vale para esta fonte' });
    return json(res, 200, await ing[0][3](p));
  }

  const r = casar(DO_DONO, metodo, url.pathname);
  if (!r) return json(res, 404, { erro: 'não encontrado' });
  const [[, , fn, aceitaLeitura], m] = r;
  const logado = acesso.sessaoValida(db, cookie(req));
  if (!logado) {
    if (portador(req) && acesso.travado(db, ip)) return json(res, 429, { erro: 'muitas tentativas erradas; espere 15 minutos' });
    const t = portador(req) ? acesso.conferirToken(db, portador(req)) : null;
    if (!(t && t.escopo === 'leitura' && aceitaLeitura && metodo === 'GET')) {
      if (portador(req) && !t) acesso.anotarFalha(db, ip);
      return json(res, 401, { erro: 'entre na Central' });
    }
  }
  if (metodo !== 'GET' && req.headers['x-central'] !== '1') return json(res, 403, { erro: 'sem cabeçalho X-Central' });
  return json(res, 200, await fn({ req, res, url, ip, m }));
}

const servidor = createServer(async (req, res) => {
  try {
    await atender(req, res);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof ErroDeEntrada) return json(res, e.status, { erro: e.message });
    const msg = (e as Error).message;
    // Restrição do SQLite (CHECK/UNIQUE/FK) também é erro de entrada.
    if (/constraint/i.test(msg)) return json(res, 400, { erro: msg });
    console.error(e);
    json(res, 500, { erro: 'erro interno' });
  }
});
servidor.headersTimeout = 15e3;
servidor.requestTimeout = 30e3;

servidor.listen(cfg.porta, cfg.escuta, () => {
  console.log(`central em http://localhost:${cfg.porta}  (${espacos.listar(db).length} espaços, ${cfg.conectores.length} fontes, `
    + `${contas.listar(db).length} contas${acesso.configurado(db) ? '' : ', AINDA SEM DONO: rode "node src/admin.ts convite"'})`);
});

const desligar = () => { coletor?.parar(); servidor.close(); db.close(); process.exit(0); };
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
