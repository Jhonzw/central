// Lê um painel local que expõe GET .../resumo -> { itens: [{ titulo, desc, qtd, urgente, link }] }.
// Só aceita URL de loopback: o conector não sai para a internet.

import type { ConfigConector, Item } from './index.ts';
import { limparItens } from './itens.ts';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function resumoHttp(c: ConfigConector): Promise<Item[]> {
  const url = new URL(String(c.url));
  if (!['http:', 'https:'].includes(url.protocol) || !LOCAL.has(url.hostname)) throw new Error('resumo-http só lê endereço local');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const corpo = await res.json() as { itens?: unknown };
  return limparItens(corpo.itens);
}
