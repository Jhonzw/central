#!/usr/bin/env node
// Lê UM WhatsApp como aparelho vinculado e entrega as mensagens à Central.
//
// Só leitura, de propósito:
//   - não existe chamada de envio neste arquivo (nem sendMessage, nem
//     readMessages: não marca como lida, não manda "visto");
//   - não aparece "online" (markOnlineOnConnect: false);
//   - não guarda histórico antigo, só o que chega a partir da conexão.
// Parear e desligar são pedidos do dono pela tela da Central; este processo
// busca o pedido a cada poucos segundos.
//
// Ambiente:
//   CENTRAL_URL        http://central:7800
//   CENTRAL_TOKEN_ARQ  arquivo com o token whatsapp:<conta>
//   CONTA              id da conta na Central
//   SESSAO             pasta da sessão (cifrada)
//   CHAVE_ARQ          chave do cofre desta sessão (fora da pasta da sessão)
//   GRUPOS=1           também lê grupos (padrão: não)

import { readFileSync } from 'node:fs';
import makeWASocket, { Browsers, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, type WASocket } from 'baileys';
import pino from 'pino';
import { lerOuCriarChave, criarCofre } from '../src/cofre.ts';
import { sessaoCifrada } from './sessao.ts';
import { paraCentral, type ParaCentral } from './mensagem.ts';

const CENTRAL = (process.env.CENTRAL_URL || 'http://127.0.0.1:7800').replace(/\/$/, '');
const TOKEN = readFileSync(process.env.CENTRAL_TOKEN_ARQ || '/segredos/token', 'utf8').trim();
const CONTA = process.env.CONTA || '';
const SESSAO = process.env.SESSAO || '/sessao';
const GRUPOS = process.env.GRUPOS === '1';
if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(CONTA)) throw new Error('CONTA inválida');
if (!TOKEN.startsWith('cen_')) throw new Error('token inválido');

const cofre = criarCofre(lerOuCriarChave(process.env.CHAVE_ARQ || '/segredos/chave'));
const logger = pino({ level: 'warn' });
const base = `${CENTRAL}/api/ingest/whatsapp/${CONTA}`;

async function central(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(base + caminho, {
    method: metodo, signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${TOKEN}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`Central respondeu ${r.status}`);
  return r.json();
}

// ---------- Estado e fila ----------
let sock: WASocket | null = null;
let conectado = false;
let travado = false;           // banido/restrito: não tenta de novo sozinho
let numeroParear: string | null = null;
const nomes = new Map<string, string>();
let fila: ParaCentral[] = [];

const informar = (parte: Record<string, unknown>) => central('POST', '/estado', parte).catch((e) => console.error('estado:', e.message));

async function esvaziar() {
  while (fila.length) {
    const lote = fila.slice(0, 100);
    try {
      await central('POST', '/mensagens', { mensagens: lote });
      fila = fila.slice(lote.length);
    } catch (e) {
      console.error('entregar:', (e as Error).message);
      return;
    }
  }
}
setInterval(esvaziar, 3000).unref();

// ---------- Conexão ----------
let ligando = false;
async function ligar() {
  if (ligando || travado) return;
  ligando = true;
  try {
    const sessao = await sessaoCifrada(SESSAO, cofre);
    if (!sessao.state.creds.registered && !numeroParear) { ligando = false; return informar({ conectado: false, codigo: null, erro: 'aguardando parear pela tela da Central' }); }
    const versao = await fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined);
    const s = makeWASocket({
      ...(versao ? { version: versao } : {}),
      auth: { creds: sessao.state.creds, keys: makeCacheableSignalKeyStore(sessao.state.keys as never, logger) },
      logger,
      browser: Browsers.ubuntu('Central'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    sock = s;
    s.ev.on('creds.update', sessao.salvarCreds);

    s.ev.on('connection.update', async (u) => {
      if (u.qr && numeroParear && !s.authState.creds.registered) {
        // Em vez do QR, código de pareamento: o dono digita no celular.
        const numero = numeroParear;
        numeroParear = null;
        try {
          const codigo = await s.requestPairingCode(numero);
          informar({ conectado: false, codigo: codigo.match(/.{1,4}/g)?.join('-') ?? codigo, erro: null });
        } catch (e) { informar({ erro: `pareamento: ${(e as Error).message}` }); }
      }
      if (u.connection === 'open') {
        conectado = true;
        const numero = s.user?.id?.split(':')[0].split('@')[0];
        informar({ conectado: true, codigo: null, erro: null, restricao: null, numero });
        console.log('WhatsApp conectado');
      }
      if (u.connection === 'close') {
        // Socket que nós mesmos trocamos ou desligamos: não religa.
        if (sock !== s) return;
        sock = null;
        conectado = false;
        const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        if (codigo === 402 || codigo === 403 || codigo === 406) {
          travado = true;
          return informar({ conectado: false, restricao: codigo === 406 ? 'conta banida pelo WhatsApp' : codigo === 403 ? 'conta travada pelo WhatsApp' : 'bloqueio temporário do WhatsApp' });
        }
        if (codigo === DisconnectReason.loggedOut) {
          await sessao.apagarTudo();
          return informar({ conectado: false, codigo: null, erro: 'desvinculado pelo celular; pareie de novo' });
        }
        // Queda comum: religa com espera crescente.
        tentativas++;
        setTimeout(() => { ligando = false; ligar(); }, Math.min(60e3, 2000 * tentativas));
        return informar({ conectado: false, erro: `conexão caiu (${u.lastDisconnect?.error?.message ?? codigo}); religando` });
      }
    });

    s.ev.on('contacts.upsert', (cs) => { for (const c of cs) if (c.id && (c.name || c.notify)) nomes.set(c.id, String(c.name || c.notify)); });
    s.ev.on('contacts.update', (cs) => { for (const c of cs) if (c.id && (c.name || c.notify)) nomes.set(c.id, String(c.name || c.notify)); });

    // Histórico que o WhatsApp manda ao vincular: ignorado de propósito.
    s.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        let pn: string | null = null;
        const jid = m.key?.remoteJid ?? '';
        if (jid.endsWith('@lid')) pn = await s.signalRepository.lidMapping.getPNForLID(jid).catch(() => null);
        const x = paraCentral(m as never, { pn, nomes, grupos: GRUPOS });
        if (x) fila.push(x);
      }
      if (fila.length > 5000) fila = fila.slice(-5000);
    });
    tentativas = 0;
  } catch (e) {
    informar({ conectado: false, erro: (e as Error).message.slice(0, 200) });
  } finally {
    ligando = false;
  }
}
let tentativas = 0;

// ---------- Pedidos do dono ----------
async function verPedido() {
  try {
    const { pedido } = await central('GET', '/pedido') as { pedido: { acao: string; numero?: string } | null };
    if (!pedido) return;
    if (pedido.acao === 'parear' && pedido.numero) {
      travado = false;
      numeroParear = pedido.numero;
      const velho = sock;
      sock = null;
      velho?.end(undefined);
      ligando = false;
      await ligar();
    }
    if (pedido.acao === 'desligar') {
      // logout tira o aparelho da lista de conectados do celular.
      const velho = sock;
      sock = null;
      conectado = false;
      await velho?.logout().catch(() => {});
      await (await sessaoCifrada(SESSAO, cofre)).apagarTudo();
      informar({ conectado: false, codigo: null, erro: 'desligado pelo dono' });
    }
  } catch (e) { console.error('pedido:', (e as Error).message); }
}

setInterval(verPedido, 5000);
setInterval(() => informar({ conectado }), 30e3);
ligar();
console.log(`processo do WhatsApp da conta ${CONTA} rodando (grupos: ${GRUPOS ? 'sim' : 'não'})`);

const sair = async () => { await esvaziar(); sock?.end(undefined); process.exit(0); };
process.on('SIGTERM', sair);
process.on('SIGINT', sair);
