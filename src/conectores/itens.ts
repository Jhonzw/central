// Item que uma fonte diz que pede ação. Venha lido ou empurrado, passa por
// aqui: corta tamanho, e link só http(s).

import type { Item } from './index.ts';

export function limparItens(v: unknown): Item[] {
  if (!Array.isArray(v)) throw new Error('resposta sem itens');
  return v.slice(0, 50).map((x: Record<string, unknown>) => ({
    titulo: String(x?.titulo ?? '').slice(0, 200),
    desc: String(x?.desc ?? '').slice(0, 400),
    qtd: x?.qtd !== null && x?.qtd !== '' && Number.isFinite(Number(x?.qtd)) ? Number(x.qtd) : null,
    urgente: x?.urgente === true,
    link: linkSeguro(x?.link),
  })).filter((x) => x.titulo);
}

// Link só http(s); qualquer outra coisa (javascript:, data:) vira vazio.
export function linkSeguro(v: unknown): string {
  try {
    const u = new URL(String(v));
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
