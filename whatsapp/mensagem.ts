// O que entra na Central de cada mensagem do WhatsApp. Puro (sem Baileys),
// para dar para testar.
//
// Fica de fora: status, canais (newsletter), bots, reação, mensagem de
// sistema, mensagem velha (histórico) e, salvo GRUPOS=1, grupos.

export type ChaveWa = { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: string | null };
export type MensagemWa = { key: ChaveWa; message?: Record<string, any> | null; messageTimestamp?: number | string | { toNumber(): number } | null; pushName?: string | null };
export type ParaCentral = { chave: string; externo: string; de_mim: boolean; autor: string; titulo: string; endereco: string; texto: string; em: string; historico?: true };

const MAX_IDADE = 48 * 36e5;
// Histórico que o celular manda ao conectar: só os últimos 7 dias.
export const MAX_IDADE_HISTORICO = 7 * 24 * 36e5;

// Tira os envelopes (temporária, ver uma vez, documento com legenda, editada).
function desembrulhar(m: Record<string, any> | null | undefined): Record<string, any> | null {
  let atual = m ?? null;
  for (let i = 0; i < 5 && atual; i++) {
    const dentro = atual.ephemeralMessage?.message ?? atual.viewOnceMessage?.message ?? atual.viewOnceMessageV2?.message
      ?? atual.documentWithCaptionMessage?.message ?? atual.editedMessage?.message;
    if (!dentro) break;
    atual = dentro;
  }
  return atual;
}

export function textoDe(m: Record<string, any> | null | undefined): string | null {
  const x = desembrulhar(m);
  if (!x) return null;
  if (x.protocolMessage || x.reactionMessage || x.senderKeyDistributionMessage && Object.keys(x).length === 1) return null;
  if (typeof x.conversation === 'string') return x.conversation;
  if (x.extendedTextMessage?.text) return x.extendedTextMessage.text;
  const comLegenda = (rotulo: string, legenda?: string) => `[${rotulo}]${legenda ? ' ' + legenda : ''}`;
  if (x.imageMessage) return comLegenda('imagem', x.imageMessage.caption);
  if (x.videoMessage) return comLegenda('vídeo', x.videoMessage.caption);
  if (x.documentMessage) return comLegenda('documento', x.documentMessage.caption || x.documentMessage.fileName);
  if (x.audioMessage) return '[áudio]';
  if (x.stickerMessage) return '[figurinha]';
  if (x.locationMessage || x.liveLocationMessage) return '[localização]';
  if (x.contactMessage || x.contactsArrayMessage) return '[contato]';
  if (x.pollCreationMessage || x.pollCreationMessageV3) return comLegenda('enquete', (x.pollCreationMessage || x.pollCreationMessageV3).name);
  return null;
}

const numero = (jid: string | null | undefined): string => (jid && /@s\.whatsapp\.net$/.test(jid) ? jid.split('@')[0].split(':')[0] : '');

export function emSegundos(t: MensagemWa['messageTimestamp']): number {
  if (t == null) return 0;
  if (typeof t === 'object' && 'toNumber' in t) return t.toNumber();
  return Number(t);
}

// pn: o número (JID @s.whatsapp.net) do contato quando o WhatsApp manda só o LID.
// nomes: nome que o celular tem na agenda, por JID.
export function paraCentral(m: MensagemWa, { pn, nomes, grupos = false, agora = Date.now(), historico = false }: { pn?: string | null; nomes?: Map<string, string>; grupos?: boolean; agora?: number; historico?: boolean } = {}): ParaCentral | null {
  const jid = m.key?.remoteJid;
  if (!jid || !m.key.id) return null;
  if (jid === 'status@broadcast' || /@(newsletter|broadcast|bot)$/.test(jid)) return null;
  const grupo = jid.endsWith('@g.us');
  if (grupo && !grupos) return null;
  const segundos = emSegundos(m.messageTimestamp);
  if (!segundos || agora - segundos * 1000 > (historico ? MAX_IDADE_HISTORICO : MAX_IDADE)) return null;
  const texto = textoDe(m.message);
  if (texto === null) return null;
  // A conversa fica no número quando ele é conhecido; o LID só quando não tem jeito.
  const alt = m.key.remoteJidAlt && /@s\.whatsapp\.net$/.test(m.key.remoteJidAlt) ? m.key.remoteJidAlt : null;
  const chave = grupo ? jid : (pn || alt || jid).replace(/:\d+@/, '@');
  const deMim = !!m.key.fromMe;
  const nome = nomes?.get(chave) || nomes?.get(jid) || '';
  return {
    chave,
    externo: m.key.id,
    de_mim: deMim,
    autor: deMim ? 'Você' : (m.pushName || nome || numero(chave) || 'Contato').slice(0, 120),
    titulo: (nome || (!deMim && m.pushName) || '').slice(0, 120),
    endereco: grupo ? '' : numero(chave),
    texto: texto.slice(0, 4000),
    em: new Date(segundos * 1000).toISOString(),
    ...(historico ? { historico: true as const } : {}),
  };
}
