// Conector = uma fonte de fora que diz o que pede ação num espaço (um painel,
// e mais tarde e-mail e WhatsApp). Cada um é configurado em config/local.json,
// pertence a UM espaço e só é lido, nunca escrito.

import { resumoHttp } from './resumo-http.ts';

export type Item = { titulo: string; desc: string; qtd: number | null; urgente: boolean; link: string };
export type ConfigConector = { id: string; espaco: string; tipo: string; nome: string; [k: string]: unknown };
export type Leitura = { id: string; nome: string; espaco: string; itens: Item[]; erro: string | null; em: number | null };

const TIPOS: Record<string, (c: ConfigConector) => Promise<Item[]>> = {
  'resumo-http': resumoHttp,
};

const VALIDADE = 2 * 60e3;
const cache = new Map<string, { leitura: Leitura; carregando: Promise<Leitura> | null }>();

export function validarConfig(lista: ConfigConector[], espacos: string[]): void {
  const ids = new Set<string>();
  for (const c of lista) {
    if (!c.id || ids.has(c.id)) throw new Error(`conector sem id ou repetido: ${c.id}`);
    ids.add(c.id);
    if (!TIPOS[c.tipo]) throw new Error(`conector ${c.id}: tipo desconhecido ${c.tipo}`);
    if (!espacos.includes(c.espaco)) throw new Error(`conector ${c.id}: espaço ${c.espaco} não existe`);
  }
}

export async function ler(c: ConfigConector, forcar = false): Promise<Leitura> {
  const atual = cache.get(c.id);
  if (atual?.carregando) return atual.carregando;
  if (!forcar && atual && atual.leitura.em && Date.now() - atual.leitura.em < VALIDADE) return atual.leitura;
  const anterior = atual?.leitura;
  const carregando = TIPOS[c.tipo](c)
    .then((itens) => ({ id: c.id, nome: c.nome, espaco: c.espaco, itens, erro: null, em: Date.now() }))
    // Falhou: guarda o erro, mas continua mostrando o que tinha antes.
    .catch((e: Error) => ({ id: c.id, nome: c.nome, espaco: c.espaco, itens: anterior?.itens ?? [], erro: e.message, em: anterior?.em ?? null }))
    .then((leitura) => { cache.set(c.id, { leitura, carregando: null }); return leitura; });
  cache.set(c.id, { leitura: anterior ?? { id: c.id, nome: c.nome, espaco: c.espaco, itens: [], erro: null, em: null }, carregando });
  return carregando;
}
