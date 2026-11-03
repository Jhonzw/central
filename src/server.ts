#!/usr/bin/env node
// Central: espaços por empresa, pessoas, tarefas e o dia juntando tudo.
// Escuta só em 127.0.0.1. Escrita exige o cabeçalho X-Central (outra página
// aberta no navegador não manda sem passar pelo preflight de CORS, que este
// servidor não libera) e Host local (contra DNS rebinding).
//
//   node src/server.ts   ->  http://localhost:7800

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { abrir, ErroDeEntrada } from './db.ts';
import * as espacos from './espacos.ts';
import * as pessoas from './pessoas.ts';
import * as tarefas from './tarefas.ts';
import { montarHoje } from './hoje.ts';
import { validarConfig, type ConfigConector } from './conectores/index.ts';

const ARQ_CONFIG = process.env.CENTRAL_CONFIG ? new URL(`file://${process.env.CENTRAL_CONFIG}`) : new URL('../config/local.json', import.meta.url);
const config = existsSync(ARQ_CONFIG) ? JSON.parse(readFileSync(ARQ_CONFIG, 'utf8')) : { espacos: [{ id: 'pessoal', nome: 'Pessoal' }], conectores: [] };
const PORTA = Number(process.env.CENTRAL_PORTA || config.porta || 7800);
const db = abrir(process.env.CENTRAL_BANCO || new URL('../data/central.sqlite3', import.meta.url).pathname);

espacos.semear(db, config.espacos || []);
const conectores: ConfigConector[] = config.conectores || [];
validarConfig(conectores, espacos.listar(db, { comArquivados: true }).map((e) => e.id));

const json = (res: ServerResponse, codigo: number, corpo: unknown) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
};

async function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let corpo = '';
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 64000) throw new ErroDeEntrada('corpo grande demais', 413);
  }
  try {
    const v = JSON.parse(corpo || '{}');
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ErroDeEntrada('JSON inválido');
  }
}

const HOSTS = new Set([`localhost:${PORTA}`, `127.0.0.1:${PORTA}`]);

type Rota = [string, RegExp, (m: RegExpMatchArray, url: URL, req: IncomingMessage) => Promise<unknown> | unknown];
const ROTAS: Rota[] = [
  ['GET', /^\/api\/hoje$/, (_m, url) => montarHoje(db, conectores, { forcar: url.searchParams.has('forcar') })],
  ['GET', /^\/api\/espacos$/, (_m, url) => espacos.listar(db, { comArquivados: url.searchParams.has('todos') })],
  ['POST', /^\/api\/espacos$/, async (_m, _u, req) => espacos.salvar(db, await lerCorpo(req))],
  ['GET', /^\/api\/pessoas$/, (_m, url) => pessoas.listar(db, { espaco: url.searchParams.get('espaco') || undefined, q: url.searchParams.get('q') || undefined })],
  ['POST', /^\/api\/pessoas$/, async (_m, _u, req) => pessoas.salvar(db, await lerCorpo(req))],
  ['GET', /^\/api\/pessoas\/(\d+)$/, (m) => pessoas.obter(db, Number(m[1]))],
  ['PUT', /^\/api\/pessoas\/(\d+)$/, async (m, _u, req) => pessoas.salvar(db, await lerCorpo(req), Number(m[1]))],
  ['DELETE', /^\/api\/pessoas\/(\d+)$/, (m) => { pessoas.apagar(db, Number(m[1])); return { ok: true }; }],
  ['GET', /^\/api\/tarefas$/, (_m, url) => tarefas.listar(db, {
    espaco: url.searchParams.get('espaco') || undefined, abertas: url.searchParams.get('todas') === null,
    pessoa: Number(url.searchParams.get('pessoa')) || undefined,
  })],
  ['POST', /^\/api\/tarefas$/, async (_m, _u, req) => tarefas.criar(db, await lerCorpo(req))],
  ['GET', /^\/api\/tarefas\/(\d+)$/, (m) => tarefas.obter(db, Number(m[1]))],
  ['PATCH', /^\/api\/tarefas\/(\d+)$/, async (m, _u, req) => tarefas.alterar(db, Number(m[1]), await lerCorpo(req))],
  ['GET', /^\/api\/vocabulario$/, () => ({ status: tarefas.STATUS, abertos: tarefas.ABERTOS, nome: String(config.nome || '') })],
];

const servidor = createServer(async (req, res) => {
  try {
    if (!HOSTS.has(String(req.headers.host))) return json(res, 421, { erro: 'host não permitido' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(await readFile(new URL('./web/index.html', import.meta.url)));
    }
    if (req.method !== 'GET' && req.headers['x-central'] !== '1') return json(res, 403, { erro: 'sem cabeçalho X-Central' });
    for (const [metodo, padrao, fn] of ROTAS) {
      const m = url.pathname.match(padrao);
      if (m && req.method === metodo) return json(res, 200, await fn(m, url, req));
    }
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    if (e instanceof ErroDeEntrada) return json(res, e.status, { erro: e.message });
    const msg = (e as Error).message;
    // Restrição do SQLite (CHECK/UNIQUE/FK) também é erro de entrada.
    if (/constraint/i.test(msg)) return json(res, 400, { erro: msg });
    console.error(e);
    json(res, 500, { erro: 'erro interno' });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`central em http://localhost:${PORTA}  (${espacos.listar(db).length} espaços, ${conectores.length} conectores)`);
});
