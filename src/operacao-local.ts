// Fronteira local: /api/local e /api/operacao nunca alcançam o upstream Central.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { abrir, ErroDeEntrada } from './db.ts';
import * as espacos from './espacos.ts';
import * as tarefas from './tarefas.ts';
import * as pessoas from './pessoas.ts';
import { montarHoje } from './hoje.ts';
import { ESTADOS, buscar as buscarCaixa } from './caixa.ts';

const CATEGORIAS = new Set(['notas', 'chamados', 'transmissoes', 'pedidos', 'acompanhamento']);
type Fonte = { id: string; nome: string; url: string; tokenEnv: string; categorias: string[] };
export type ConfigGateway = {
  habilitado: boolean;
  porta?: number;
  central: string;
  segredoHash: string;
  bancoLocal: string;
  espacosLocais: Array<Record<string, unknown>>;
  fontes: Fonte[];
  timeoutMs?: number;
  limiteBytes?: number;
};
type Sessao = { vence: number; cookieCentral?: string };
const WEB = new URL('./web/', import.meta.url);

export function hashSegredo(segredo: string): string {
  if (segredo.length < 16) throw new Error('Use um segredo com pelo menos 16 caracteres');
  const sal = randomBytes(24).toString('hex');
  return `${sal}:${scryptSync(segredo, sal, 32).toString('hex')}`;
}
function destino(v: string, local: boolean): URL {
  const u = new URL(v);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (!local && !/^\/(?:[a-z0-9-]+\/?)?$/.test(u.pathname))
  )
    throw new Error('Destino inválido');
  const loop = u.hostname === '127.0.0.1';
  if (
    local
      ? !loop || u.protocol !== 'http:' || u.pathname !== '/'
      : u.protocol !== 'https:' && !(loop && u.protocol === 'http:')
  )
    throw new Error('Destino não autorizado');
  return u;
}
function json(res: ServerResponse, status: number, dados: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}
async function corpo(req: IncomingMessage, limite: number): Promise<string> {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? '')))
    throw new ErroDeEntrada('Use JSON', 415);
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > limite) throw new ErroDeEntrada('Corpo muito grande', 413);
    partes.push(parte);
  }
  const s = Buffer.concat(partes).toString('utf8');
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error();
  } catch {
    throw new ErroDeEntrada('JSON inválido');
  }
  return s;
}
async function buscar(
  url: URL,
  headers: Record<string, string>,
  timeout: number,
  limite: number,
  method = 'GET',
  body?: string,
) {
  const r = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.headers.get('content-type')?.includes('application/json')) {
    await r.body?.cancel();
    throw Error('Formato');
  }
  let bytes = 0;
  const partes: Uint8Array[] = [];
  if (r.body)
    for await (const parte of r.body) {
      bytes += parte.length;
      if (bytes > limite) throw Error('Limite');
      partes.push(parte);
    }
  const dados = JSON.parse(Buffer.concat(partes).toString('utf8'));
  return { status: r.status, dados, cookies: r.headers.getSetCookie() };
}
// Métodos e caminhos exatos: não há proxy de URL, ingestão, exportação ou MCP.
const REMOTAS: Array<[string, RegExp]> = [
  [
    'GET',
    /^\/api\/(sessao|hoje|vocabulario|espacos|pessoas|tarefas|projetos|conversas|busca|contas|conectores|sessoes|tokens)$/,
  ],
  ['GET', /^\/api\/(pessoas|tarefas|projetos|conversas)\/\d+$/],
  ['GET', /^\/api\/pessoas\/\d+\/linha-do-tempo$/],
  ['POST', /^\/api\/(entrar|sair|pessoas|tarefas|projetos|espacos|contas|tokens)$/],
  ['POST', /^\/api\/conversas\/\d+\/(tarefa|vinculos)$/],
  ['POST', /^\/api\/contas\/[a-z0-9-]+\/(ler|whatsapp)$/],
  ['POST', /^\/api\/sessoes\/sair-de-todas$/],
  ['PATCH', /^\/api\/(pessoas|tarefas|projetos|conversas)\/\d+$/],
  ['PUT', /^\/api\/pessoas\/\d+$/],
  ['DELETE', /^\/api\/(pessoas|tokens)\/\d+$/],
  ['DELETE', /^\/api\/contas\/[a-z0-9-]+$/],
  ['DELETE', /^\/api\/conversas\/\d+\/vinculos\/\d+$/],
];

export function criarGateway(cfg: ConfigGateway) {
  if (cfg.habilitado !== true) throw new Error('Gateway desativado; configure antes de iniciar');
  if (!/^[a-zA-Z0-9-]{4,128}:[0-9a-f]{64}$/.test(cfg.segredoHash ?? ''))
    throw new Error('Hash local inválido');
  const central = destino(cfg.central, false);
  const centralBase = central.pathname.replace(/\/$/, '');
  const fontes = new Map<string, Fonte>();
  for (const f of cfg.fontes ?? []) {
    if (
      !/^[a-z0-9-]{1,40}$/.test(f.id) ||
      fontes.has(f.id) ||
      !f.nome ||
      !Array.isArray(f.categorias) ||
      !f.categorias.length ||
      f.categorias.some((c) => !CATEGORIAS.has(c)) ||
      !/^[_A-Z][_A-Z0-9]*$/.test(f.tokenEnv) ||
      !process.env[f.tokenEnv] ||
      /[\r\n]/.test(process.env[f.tokenEnv]!)
    )
      throw new Error('Fonte inválida ou token de leitura ausente');
    destino(f.url, true);
    fontes.set(f.id, f);
  }
  if (!cfg.bancoLocal || !Array.isArray(cfg.espacosLocais) || !cfg.espacosLocais.length)
    throw new Error('Configure banco e espaços locais');
  const limite = cfg.limiteBytes ?? 2_000_000;
  const timeout = cfg.timeoutMs ?? 8000;
  if (
    !Number.isInteger(limite) ||
    limite < 256 ||
    limite > 4_000_000 ||
    !Number.isInteger(timeout) ||
    timeout < 20 ||
    timeout > 30000
  )
    throw new Error('Limites inválidos');
  const db = abrir(cfg.bancoLocal);
  espacos.semear(db, cfg.espacosLocais);
  const sessoes = new Map<string, Sessao>();
  const falhas: number[] = [];
  const estadoFontes = new Map<string, { estado: string; em: string | null; erro?: string }>();
  const servidor = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      const host = `127.0.0.1:${req.socket.localPort}`;
      const origem = `http://${host}`;
      const nomeCookie = `central_local_${req.socket.localPort}`;
      if (req.headers.host !== host) {
        json(res, 421, { erro: 'Host não autorizado' });
        return;
      }
      if (
        (req.headers.origin && req.headers.origin !== origem) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        json(res, 403, { erro: 'Origem não autorizada' });
        return;
      }
      const url = new URL(req.url ?? '/', origem);
      const path = url.pathname;
      const metodo = req.method ?? 'GET';
      if (!['GET', 'HEAD'].includes(metodo) && (req.headers.origin !== origem || !req.headers['x-central'])) {
        json(res, 403, { erro: 'Origem e X-Central obrigatórios' });
        return;
      }
      const sid = String(req.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(nomeCookie + '='))
        ?.slice(nomeCookie.length + 1);
      let sessao = sid ? sessoes.get(sid) : undefined;
      if (sessao && sessao.vence < Date.now()) {
        sessoes.delete(sid!);
        sessao = undefined;
      }
      if (path === '/gateway/entrar' && metodo === 'POST') {
        while (falhas.length && falhas[0] < Date.now() - 60000) falhas.shift();
        if (falhas.length >= 5) {
          json(res, 429, { erro: 'Aguarde antes de tentar novamente' });
          return;
        }
        const b = JSON.parse(await corpo(req, limite));
        const [sal, hash] = cfg.segredoHash.split(':');
        const valido =
          typeof b.segredo === 'string' &&
          b.segredo.length <= 1024 &&
          timingSafeEqual(scryptSync(b.segredo, sal, 32), Buffer.from(hash, 'hex'));
        if (!valido) {
          falhas.push(Date.now());
          json(res, 401, { erro: 'Acesso local inválido' });
          return;
        }
        for (const [k, s] of sessoes) if (s.vence < Date.now()) sessoes.delete(k);
        if (sessoes.size >= 32) {
          json(res, 429, { erro: 'Limite de sessões locais' });
          return;
        }
        if (sid) sessoes.delete(sid);
        const token = randomBytes(32).toString('hex');
        sessoes.set(token, { vence: Date.now() + 8 * 3600000 });
        res.setHeader(
          'Set-Cookie',
          `${nomeCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`,
        );
        json(res, 200, { ok: true });
        return;
      }
      if (path === '/gateway/entrar' && metodo === 'GET') {
        const script =
          "document.querySelector('form').onsubmit=async e=>{e.preventDefault();const segredo=document.querySelector('input').value;document.querySelector('input').value='';const r=await fetch('/gateway/entrar',{method:'POST',headers:{'Content-Type':'application/json','X-Central':'1'},body:JSON.stringify({segredo})});if(r.ok)location.replace('/');else document.querySelector('p').textContent='Acesso recusado. Confira o segredo ou aguarde.'}";
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(
          `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Acesso local · Central</title><h1>Central nesta máquina</h1><form><label>Segredo local <input type="password" autocomplete="current-password" required maxlength="1024"></label><button>Entrar</button></form><p>Este acesso é independente da sua conta Central pessoal.</p><script>${script}</script></html>`,
        );
        return;
      }
      if (!sessao) {
        if (path.startsWith('/api/') || path.startsWith('/gateway/'))
          json(res, 401, { erro: 'Entre no gateway local' });
        else {
          res.writeHead(303, { Location: '/gateway/entrar', 'Cache-Control': 'no-store' });
          res.end();
        }
        return;
      }
      if (path === '/gateway/sair' && metodo === 'POST') {
        sessoes.delete(sid!);
        res.setHeader('Set-Cookie', `${nomeCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
        json(res, 200, { ok: true });
        return;
      }
      // Reservar ambos os prefixos antes de qualquer regra remota, inclusive erros.
      const operacao = path.startsWith('/api/local/operacao') ? path.slice(10) : path.slice(4);
      if (path.startsWith('/api/operacao') || path.startsWith('/api/local/operacao')) {
        if (metodo !== 'GET') {
          json(res, 405, { erro: 'Fonte somente leitura' });
          return;
        }
        if (url.search) {
          json(res, 404, { erro: 'Categoria não autorizada' });
          return;
        }
        if (operacao === '/operacao') {
          json(res, 200, {
            local: true,
            espaco_local: true,
            fontes: [...fontes.values()].map((f) => ({
              id: f.id,
              nome: f.nome,
              ...(estadoFontes.get(f.id) ?? { estado: 'configurada', em: null }),
              categorias: f.categorias,
            })),
          });
          return;
        }
        const m = operacao.match(/^\/operacao\/([a-z0-9-]+)\/([a-z]+)$/);
        const f = m ? fontes.get(m[1]) : undefined;
        if (!m || !f || !f.categorias.includes(m[2])) {
          json(res, 404, { erro: 'Categoria não autorizada' });
          return;
        }
        const em = new Date().toISOString();
        try {
          const r = await buscar(
            new URL(`/api/${m[2]}`, f.url),
            { Accept: 'application/json', Authorization: `Bearer ${process.env[f.tokenEnv]}` },
            timeout,
            limite,
          );
          if (r.status !== 200) throw Error();
          estadoFontes.set(f.id, { estado: 'ok', em });
          json(res, 200, { dados: r.dados, em, erro: null });
        } catch {
          estadoFontes.set(f.id, { estado: 'indisponivel', em, erro: 'Fonte indisponível' });
          json(res, 502, { dados: null, em, erro: 'Fonte indisponível' });
        }
        return;
      }
      if (path === '/api/local' || path.startsWith('/api/local/')) {
        const rota = path.slice(10);
        const b = ['POST', 'PATCH', 'PUT'].includes(metodo) ? JSON.parse(await corpo(req, limite)) : {};
        const q = (k: string) => url.searchParams.get(k) || undefined;
        let dados: unknown;
        const m = rota.match(/^\/(tarefas|projetos|pessoas)\/(\d+)(\/linha-do-tempo)?$/);
        if (metodo === 'GET' && rota === '/sessao') dados = { logado: true, configurado: true };
        else if (metodo === 'GET' && rota === '/espacos')
          dados = espacos.listar(db, { comArquivados: url.searchParams.has('todos') });
        else if (metodo === 'POST' && rota === '/espacos') dados = espacos.salvar(db, b);
        else if (metodo === 'GET' && rota === '/vocabulario')
          dados = {
            status: tarefas.STATUS,
            abertos: tarefas.ABERTOS,
            estados: ESTADOS,
            nome: 'Trabalho local',
          };
        else if (metodo === 'GET' && rota === '/hoje') dados = await montarHoje(db, []);
        else if (metodo === 'GET' && rota === '/busca')
          dados = buscarCaixa(db, q('q') ?? '', { espaco: q('espaco') });
        else if (
          metodo === 'GET' &&
          ['/conversas', '/conectores', '/contas', '/sessoes', '/tokens'].includes(rota)
        )
          dados = [];
        else if (rota === '/tarefas' && metodo === 'GET')
          dados = tarefas.listar(db, {
            espaco: q('espaco'),
            abertas: !url.searchParams.has('todas'),
            pessoa: Number(q('pessoa')) || undefined,
            projeto: Number(q('projeto')) || undefined,
            sem_projeto: url.searchParams.has('sem_projeto'),
          });
        else if (rota === '/tarefas' && metodo === 'POST') dados = tarefas.criar(db, b);
        else if (rota === '/pessoas' && metodo === 'GET')
          dados = pessoas.listar(db, { espaco: q('espaco'), q: q('q') });
        else if (rota === '/pessoas' && metodo === 'POST')
          dados = pessoas.salvar(db, b, b.id ? Number(b.id) : undefined);
        else if (rota === '/projetos') {
          const projetos = await import('./projetos.ts');
          if (metodo === 'GET')
            dados = projetos.listar(db, { espaco: q('espaco'), todos: url.searchParams.has('todos') });
          else if (metodo === 'POST') dados = projetos.criar(db, b);
          else throw new ErroDeEntrada('Rota local não encontrada', 404);
        } else if (m) {
          const id = Number(m[2]);
          if (m[1] === 'tarefas' && !m[3] && metodo === 'GET') dados = tarefas.obter(db, id);
          else if (m[1] === 'tarefas' && !m[3] && metodo === 'PATCH') dados = tarefas.alterar(db, id, b);
          else if (m[1] === 'pessoas' && !m[3] && metodo === 'GET') dados = pessoas.obter(db, id);
          else if (m[1] === 'pessoas' && !m[3] && ['PATCH', 'PUT'].includes(metodo))
            dados = pessoas.salvar(db, b, id);
          else if (m[1] === 'pessoas' && !m[3] && metodo === 'DELETE') {
            pessoas.apagar(db, id);
            dados = { ok: true };
          } else if (m[1] === 'pessoas' && m[3] && metodo === 'GET')
            dados = pessoas.linhaDoTempo(db, id, { espaco: q('espaco') });
          else if (m[1] === 'projetos' && !m[3]) {
            const projetos = await import('./projetos.ts');
            if (metodo === 'GET')
              dados = {
                ...projetos.obter(db, id),
                tarefas: tarefas.listar(db, { abertas: false, projeto: id } as any),
                conversas: [],
              };
            else if (metodo === 'PATCH') dados = projetos.alterar(db, id, b);
            else throw new ErroDeEntrada('Rota local não encontrada', 404);
          } else throw new ErroDeEntrada('Rota local não encontrada', 404);
        } else throw new ErroDeEntrada('Rota local não encontrada', 404);
        json(res, 200, dados);
        return;
      }
      if (path.startsWith('/api/')) {
        if (!REMOTAS.some(([v, r]) => v === metodo && r.test(path))) {
          json(res, 404, { erro: 'Rota não autorizada' });
          return;
        }
        if (metodo !== 'GET' && path !== '/api/entrar' && !sessao.cookieCentral) {
          json(res, 401, { erro: 'Entre na Central pessoal antes de escrever' });
          return;
        }
        const body = ['POST', 'PATCH', 'PUT'].includes(metodo) ? await corpo(req, limite) : undefined;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (path === '/api/entrar') delete sessao.cookieCentral;
        if (sessao.cookieCentral) headers.Cookie = sessao.cookieCentral;
        if (!['GET', 'HEAD'].includes(metodo)) {
          headers['X-Central'] = '1';
          headers.Origin = central.origin;
        }
        if (body) headers['Content-Type'] = 'application/json';
        try {
          const u = new URL(central.toString());
          u.pathname = centralBase + path;
          u.search = url.search;
          const r = await buscar(u, headers, timeout, limite, metodo, body);
          if (path === '/api/entrar' && r.status === 200) {
            const permitidos = new Set(['__Host-central', '__Secure-central']);
            const cookies = r.cookies
              .map((c) => c.split(';')[0])
              .filter((c) => permitidos.has(c.split('=')[0]) && /^[^\r\n;]+=[^\r\n;]+$/.test(c));
            if (cookies.length !== 1) throw Error();
            sessao.cookieCentral = cookies[0];
          }
          if (path === '/api/sair' || path === '/api/sessoes/sair-de-todas' || r.status === 401)
            delete sessao.cookieCentral;
          if (r.status >= 500) {
            json(res, 502, { erro: 'Central pessoal indisponível' });
            return;
          }
          json(res, r.status, r.dados);
        } catch {
          json(res, 502, { erro: 'Central pessoal indisponível' });
        }
        return;
      }
      if (metodo !== 'GET') {
        json(res, 405, { erro: 'Método não autorizado' });
        return;
      }
      if (path === '/' || path === '/index.html') {
        let html = await readFile(new URL('index.html', WEB), 'utf8');
        if (html.includes('/*CENTRAL_STYLES*/')) {
          const estilos = await readFile(new URL('estilos.css', WEB), 'utf8');
          html = html.replace('/*CENTRAL_STYLES*/', () => estilos);
        }
        if (html.includes('/*CENTRAL_APP*/')) {
          const partes = await Promise.all(
            ['fluxo.js', 'notas.js', 'app.js'].map((nome) => readFile(new URL(nome, WEB), 'utf8')),
          );
          html = html.replace('/*CENTRAL_APP*/', () => partes.join('\n'));
        }
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        );
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      // Fontes locais em caminhos fixos; código/estilos são incorporados no HTML.
      if (/^\/fontes\/[a-z0-9-]+\.woff2$/.test(path)) {
        try {
          const dados = await readFile(new URL(path.slice(1), WEB));
          res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'no-store' });
          res.end(dados);
        } catch {
          json(res, 404, { erro: 'Arquivo não encontrado' });
        }
        return;
      }
      json(res, 404, { erro: 'Rota não encontrada' });
    } catch (e) {
      if (e instanceof ErroDeEntrada) json(res, e.status, { erro: e.message });
      else json(res, 500, { erro: 'Falha local' });
    }
  });
  servidor.requestTimeout = 15000;
  servidor.headersTimeout = 10000;
  servidor.maxHeadersCount = 64;
  servidor.on('close', () => {
    sessoes.clear();
    db.close();
  });
  return servidor;
}
