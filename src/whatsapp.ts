// O lado da Central do WhatsApp. Quem fala com o WhatsApp é o processo
// separado em whatsapp/ (Baileys); ele só ENTREGA mensagens aqui, com um token
// que vale para uma conta só, e busca os pedidos do dono (parear, desligar).
// A Central não tem como mandar mensagem: não existe rota para isso.

import { type Banco, agora, ErroDeEntrada } from './db.ts';
import * as contas from './contas.ts';
import { receber } from './caixa.ts';

const JID = /^[\w.:-]{3,80}@(s\.whatsapp\.net|lid|g\.us)$/;

export function receberLote(db: Banco, conta: string, corpo: Record<string, unknown>): { novas: number; ignoradas: number } {
  const c = contas.obter(db, conta);
  if (c.tipo !== 'whatsapp') throw new ErroDeEntrada('conta não é de WhatsApp');
  const lista = corpo.mensagens;
  if (!Array.isArray(lista) || lista.length > 200) throw new ErroDeEntrada('mensagens: lista de até 200');
  let novas = 0, ignoradas = 0;
  for (const m of lista as Array<Record<string, unknown>>) {
    // Uma mensagem ruim não trava o lote (nem a fila do processo): fica de fora.
    const chave = String(m.chave ?? '');
    const em = Date.parse(String(m.em));
    if (!JID.test(chave) || !Number.isFinite(em) || !m.externo) { ignoradas++; continue; }
    const r = receber(db, {
      conta, chave, em: new Date(em).toISOString(),
      externo: String(m.externo ?? '').slice(0, 120),
      titulo: String(m.titulo ?? ''), endereco: String(m.endereco ?? ''), autor: String(m.autor ?? ''),
      de_mim: m.de_mim === true, texto: String(m.texto ?? ''),
      historico: m.historico === true,
    });
    if (r.nova) novas++;
  }
  return { novas, ignoradas };
}

// Estado que o processo do WhatsApp informa (conectado, código de pareamento,
// restrição do WhatsApp...). Só os campos conhecidos entram.
export function anotarEstado(db: Banco, conta: string, corpo: Record<string, unknown>) {
  const c = contas.obter(db, conta);
  if (c.tipo !== 'whatsapp') throw new ErroDeEntrada('conta não é de WhatsApp');
  const parte: Record<string, unknown> = { visto: agora() };
  if ('conectado' in corpo) parte.conectado = corpo.conectado === true;
  if ('codigo' in corpo) parte.codigo = corpo.codigo ? String(corpo.codigo).replace(/[^A-Z0-9-]/gi, '').slice(0, 12) : null;
  if ('erro' in corpo) parte.erro = corpo.erro ? String(corpo.erro).slice(0, 300) : null;
  if (typeof corpo.historico === 'number' && Number.isFinite(corpo.historico)) parte.historico = Math.max(0, Math.floor(corpo.historico));
  if ('restricao' in corpo) parte.restricao = corpo.restricao ? String(corpo.restricao).slice(0, 300) : null;
  if (typeof corpo.numero === 'string' && /^\d{10,15}$/.test(corpo.numero)) {
    db.prepare('UPDATE contas SET endereco = ? WHERE id = ?').run(corpo.numero, conta);
  }
  contas.mesclarEstado(db, conta, parte);
  return { ok: true };
}

// Pedido do dono, pela tela: parear (com o número) ou desligar.
export function pedir(db: Banco, conta: string, corpo: Record<string, unknown>) {
  const c = contas.obter(db, conta);
  if (c.tipo !== 'whatsapp') throw new ErroDeEntrada('conta não é de WhatsApp');
  const acao = String(corpo.acao);
  if (acao === 'parear') {
    const numero = String(corpo.numero ?? '').replace(/\D/g, '');
    if (!/^\d{12,15}$/.test(numero)) throw new ErroDeEntrada('número com DDI e DDD, ex.: 5562999990000');
    return contas.mesclarEstado(db, conta, { pedido: { acao, numero, em: agora() }, codigo: null });
  }
  if (acao === 'desligar') return contas.mesclarEstado(db, conta, { pedido: { acao, em: agora() }, codigo: null });
  throw new ErroDeEntrada('ação: parear ou desligar');
}

// O processo do WhatsApp busca o pedido; quem buscou, levou (só vale uma vez).
export function retirarPedido(db: Banco, conta: string) {
  const c = contas.obter(db, conta);
  const pedido = (c.estado.pedido as Record<string, unknown> | undefined) ?? null;
  if (pedido) contas.mesclarEstado(db, conta, { pedido: null });
  // Pedido esquecido por mais de 10 minutos não vale mais.
  if (pedido && Date.parse(String(pedido.em)) + 10 * 60e3 < Date.now()) return { pedido: null };
  return { pedido };
}
