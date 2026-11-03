// Quem entra na Central. Um dono só, com senha (scrypt) e código do
// autenticador (TOTP). O primeiro acesso é por convite de uso único: quem
// escolhe a senha é o dono, no navegador dele, e ninguém mais a vê.
//
// Sessão, convite e token ficam só como hash (SHA-256) no banco: quem ler o
// arquivo não consegue se passar pelo dono.

import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { type Banco, agora, emTransacao, registrar, ErroDeEntrada } from './db.ts';
import type { Cofre } from './cofre.ts';
import * as totp from './totp.ts';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSAO_OCIOSA = 7 * 864e5;
const SESSAO_MAXIMA = 30 * 864e5;
const JANELA_TRAVA = 15 * 60e3;
const TRAVA_IP = 5;
const TRAVA_GERAL = 30;

const hash = (t: string): string => createHash('sha256').update(t).digest('hex');
const aleatorio = (prefixo: string): string => prefixo + randomBytes(32).toString('base64url');
const depois = (ms: number): string => new Date(Date.now() + ms).toISOString();

function derivar(senha: string, sal: Buffer): Promise<Buffer> {
  return new Promise((ok, falha) => scrypt(senha.normalize('NFC'), sal, 32, SCRYPT, (e, k) => (e ? falha(e) : ok(k))));
}

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${(await derivar(senha, sal)).toString('base64')}`;
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, , , , sal, h] = guardado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(h, 'base64');
  const k = await derivar(senha, Buffer.from(sal, 'base64'));
  return k.length === esperado.length && timingSafeEqual(k, esperado);
}

function validarSenha(senha: unknown): string {
  const s = String(senha ?? '');
  if (s.length < 12) throw new ErroDeEntrada('a senha precisa de pelo menos 12 caracteres');
  if (s.length > 200) throw new ErroDeEntrada('senha longa demais');
  return s;
}

// ---------- Travas contra tentativa e erro ----------

export function travado(db: Banco, ip: string): boolean {
  const desde = new Date(Date.now() - JANELA_TRAVA).toISOString();
  const porIp = db.prepare('SELECT count(*) n FROM tentativas WHERE ip = ? AND em > ?').get(ip, desde) as { n: number };
  const geral = db.prepare('SELECT count(*) n FROM tentativas WHERE em > ?').get(desde) as { n: number };
  return porIp.n >= TRAVA_IP || geral.n >= TRAVA_GERAL;
}

export function anotarFalha(db: Banco, ip: string): void {
  db.prepare('INSERT INTO tentativas (ip, em) VALUES (?, ?)').run(ip, agora());
}

function barrarSeTravado(db: Banco, ip: string): void {
  if (travado(db, ip)) throw new ErroDeEntrada('muitas tentativas erradas; espere 15 minutos', 429);
}

// ---------- Convite (primeiro acesso, ou trocar senha e autenticador) ----------

export function criarConvite(db: Banco, horas = 24): string {
  const convite = aleatorio('cvt_');
  emTransacao(db, () => {
    db.prepare('DELETE FROM convites').run();
    db.prepare('INSERT INTO convites (hash, expira, criado) VALUES (?, ?, ?)').run(hash(convite), depois(horas * 36e5), agora());
    registrar(db, 'convites', '-', 'criou', { horas });
  });
  return convite;
}

function convitePendente(db: Banco, convite: unknown, ip: string) {
  barrarSeTravado(db, ip);
  const c = db.prepare('SELECT hash, expira, senha, totp FROM convites WHERE hash = ?').get(hash(String(convite ?? ''))) as
    { hash: string; expira: string; senha: string | null; totp: string | null } | undefined;
  if (!c || c.expira < agora()) {
    anotarFalha(db, ip);
    throw new ErroDeEntrada('convite inválido ou vencido', 401);
  }
  return c;
}

// Passo 1: o dono escolhe a senha e recebe o segredo para o autenticador.
export async function abrirConvite(db: Banco, cofre: Cofre, { convite, senha, ip }: { convite: unknown; senha: unknown; ip: string }) {
  const c = convitePendente(db, convite, ip);
  const s = validarSenha(senha);
  const segredo = totp.novoSegredo();
  db.prepare('UPDATE convites SET senha = ?, totp = ? WHERE hash = ?').run(await hashSenha(s), cofre.cifrar(segredo, 'dono:totp'), c.hash);
  return { segredo, uri: totp.uri(segredo, 'dono') };
}

// Passo 2: confirma com um código do autenticador. Só aí a senha vale, e
// todas as sessões antigas caem.
export function ativarConvite(db: Banco, cofre: Cofre, { convite, codigo, ip }: { convite: unknown; codigo: unknown; ip: string }): void {
  const c = convitePendente(db, convite, ip);
  if (!c.senha || !c.totp) throw new ErroDeEntrada('escolha a senha primeiro');
  const passo = totp.verificar(cofre.decifrar(c.totp, 'dono:totp'), String(codigo ?? ''));
  if (passo === null) {
    anotarFalha(db, ip);
    throw new ErroDeEntrada('código do autenticador não confere', 401);
  }
  emTransacao(db, () => {
    db.prepare(`INSERT INTO dono (id, senha, totp, ultimo_passo, criado, atualizado) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET senha = excluded.senha, totp = excluded.totp, ultimo_passo = excluded.ultimo_passo, atualizado = excluded.atualizado`)
      .run(c.senha, c.totp, passo, agora(), agora());
    db.prepare('DELETE FROM convites').run();
    db.prepare('DELETE FROM sessoes').run();
    registrar(db, 'dono', 1, 'alterou', { por: 'convite' });
  });
}

// ---------- Entrar e sessão ----------

export const configurado = (db: Banco): boolean => !!db.prepare('SELECT 1 FROM dono WHERE id = 1').get();

export async function entrar(db: Banco, cofre: Cofre, { senha, codigo, ip, agente }: { senha: unknown; codigo: unknown; ip: string; agente: string }): Promise<string> {
  barrarSeTravado(db, ip);
  const d = db.prepare('SELECT senha, totp, ultimo_passo FROM dono WHERE id = 1').get() as { senha: string; totp: string; ultimo_passo: number } | undefined;
  if (!d) throw new ErroDeEntrada('a Central ainda não foi configurada', 409);
  const senhaOk = await conferirSenha(String(senha ?? '').slice(0, 200), d.senha);
  const passo = senhaOk ? totp.verificar(cofre.decifrar(d.totp, 'dono:totp'), String(codigo ?? '')) : null;
  // Código já usado não vale de novo (quem viu o código por cima do ombro não entra).
  if (!senhaOk || passo === null || passo <= d.ultimo_passo) {
    anotarFalha(db, ip);
    throw new ErroDeEntrada('senha ou código errado', 401);
  }
  const token = aleatorio('ses_');
  emTransacao(db, () => {
    db.prepare('UPDATE dono SET ultimo_passo = ? WHERE id = 1').run(passo);
    db.prepare('INSERT INTO sessoes (hash, criado, visto, expira, ip, agente) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hash(token), agora(), agora(), depois(SESSAO_MAXIMA), ip.slice(0, 64), agente.slice(0, 200));
  });
  return token;
}

export function sessaoValida(db: Banco, token: string | undefined): boolean {
  if (!token) return false;
  const s = db.prepare('SELECT visto, expira FROM sessoes WHERE hash = ?').get(hash(token)) as { visto: string; expira: string } | undefined;
  if (!s) return false;
  const t = Date.now();
  if (s.expira < new Date(t).toISOString() || Date.parse(s.visto) + SESSAO_OCIOSA < t) {
    db.prepare('DELETE FROM sessoes WHERE hash = ?').run(hash(token));
    return false;
  }
  // Atualiza o "visto" no máximo a cada 5 minutos, para não escrever a cada pedido.
  if (Date.parse(s.visto) + 5 * 60e3 < t) db.prepare('UPDATE sessoes SET visto = ? WHERE hash = ?').run(agora(), hash(token));
  return true;
}

export const sair = (db: Banco, token: string | undefined): void => { if (token) db.prepare('DELETE FROM sessoes WHERE hash = ?').run(hash(token)); };

export function sairDeTodas(db: Banco): number {
  return emTransacao(db, () => {
    const n = Number(db.prepare('DELETE FROM sessoes').run().changes);
    registrar(db, 'sessoes', '*', 'apagou', { n });
    return n;
  });
}

export const listarSessoes = (db: Banco) =>
  db.prepare('SELECT substr(hash, 1, 8) id, criado, visto, expira, ip, agente FROM sessoes ORDER BY visto DESC').all();

// ---------- Tokens de máquina ----------

export type Token = { id: number; nome: string; escopo: string; criado: string; usado: string | null; revogado: string | null };

export function criarToken(db: Banco, nome: unknown, escopo: unknown): { token: string; registro: Token } {
  const n = String(nome ?? '').trim().slice(0, 60);
  const e = String(escopo ?? '');
  if (!n) throw new ErroDeEntrada('dê um nome ao token');
  if (!/^(leitura|fonte:[a-z0-9-]{2,30}|whatsapp:[a-z0-9-]{2,30})$/.test(e)) throw new ErroDeEntrada('escopo inválido');
  const token = aleatorio('cen_');
  return emTransacao(db, () => {
    const r = db.prepare('INSERT INTO tokens (nome, escopo, hash, criado) VALUES (?, ?, ?, ?)').run(n, e, hash(token), agora());
    registrar(db, 'tokens', r.lastInsertRowid, 'criou', { nome: n, escopo: e });
    return { token, registro: db.prepare('SELECT id, nome, escopo, criado, usado, revogado FROM tokens WHERE id = ?').get(r.lastInsertRowid) as Token };
  });
}

export function conferirToken(db: Banco, token: string): Token | null {
  if (!token.startsWith('cen_')) return null;
  const t = db.prepare('SELECT id, nome, escopo, criado, usado, revogado FROM tokens WHERE hash = ?').get(hash(token)) as Token | undefined;
  if (!t || t.revogado) return null;
  if (!t.usado || Date.parse(t.usado) + 5 * 60e3 < Date.now()) db.prepare('UPDATE tokens SET usado = ? WHERE id = ?').run(agora(), t.id);
  return t;
}

export const listarTokens = (db: Banco): Token[] =>
  db.prepare('SELECT id, nome, escopo, criado, usado, revogado FROM tokens ORDER BY revogado IS NOT NULL, id DESC').all() as Token[];

export function revogarToken(db: Banco, id: number): void {
  emTransacao(db, () => {
    const r = db.prepare('UPDATE tokens SET revogado = ? WHERE id = ? AND revogado IS NULL').run(agora(), id);
    if (!r.changes) throw new ErroDeEntrada(`token ${id} não existe ou já foi revogado`, 404);
    registrar(db, 'tokens', id, 'alterou', { revogado: true });
  });
}

// Faxina: tentativa velha, sessão e convite vencidos.
export function limpar(db: Banco): void {
  db.prepare('DELETE FROM tentativas WHERE em < ?').run(new Date(Date.now() - 864e5).toISOString());
  db.prepare('DELETE FROM sessoes WHERE expira < ?').run(agora());
  db.prepare('DELETE FROM convites WHERE expira < ?').run(agora());
}
