// Código do autenticador (TOTP, RFC 6238): 6 dígitos, passo de 30 s, SHA-1,
// que é o que Google Authenticator, Aegis e 1Password esperam.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0, valor = 0, s = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { s += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) s += ALFABETO[(valor << (5 - bits)) & 31];
  return s;
}

export function deBase32(s: string): Buffer {
  const limpo = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const novoSegredo = (): string => base32(randomBytes(20));
export const passoAtual = (ms = Date.now()): number => Math.floor(ms / 30000);

export function codigo(segredo: string, passo = passoAtual()): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Aceita o passo atual e um de cada lado (relógio do celular adiantado ou
// atrasado). Devolve o passo usado, para quem chama recusar reuso do mesmo código.
export function verificar(segredo: string, digitado: string, agora = Date.now()): number | null {
  const d = String(digitado ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(d)) return null;
  const p = passoAtual(agora);
  for (const passo of [p - 1, p, p + 1]) {
    if (timingSafeEqual(Buffer.from(codigo(segredo, passo)), Buffer.from(d))) return passo;
  }
  return null;
}

export const uri = (segredo: string, conta: string): string =>
  `otpauth://totp/${encodeURIComponent('Central:' + conta)}?secret=${segredo}&issuer=Central&algorithm=SHA1&digits=6&period=30`;
