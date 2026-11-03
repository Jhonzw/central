// Lê um painel local que expõe GET .../resumo -> { itens: [{ titulo, desc, qtd, urgente, link }] }.
// Só aceita URL de loopback: o conector não sai para a internet.

import type { ConfigConector, Item } from './index.ts';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function resumoHttp(c: ConfigConector): Promise<Item[]> {
  const url = new URL(String(c.url));
  if (!['http:', 'https:'].includes(url.protocol) || !LOCAL.has(url.hostname)) throw new Error('resumo-http só lê endereço local');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const corpo = await res.json() as { itens?: unknown };
  if (!Array.isArray(corpo.itens)) throw new Error('resposta sem itens');
  return corpo.itens.slice(0, 50).map((x: Record<string, unknown>) => ({
    titulo: String(x.titulo ?? '').slice(0, 200),
    desc: String(x.desc ?? '').slice(0, 400),
    qtd: Number.isFinite(Number(x.qtd)) ? Number(x.qtd) : null,
    urgente: x.urgente === true,
    link: linkSeguro(x.link),
  })).filter((x) => x.titulo);
}

// Link só http(s); qualquer outra coisa (javascript:, data:) vira vazio.
function linkSeguro(v: unknown): string {
  try {
    const u = new URL(String(v));
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
