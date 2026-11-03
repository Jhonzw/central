// Conector = uma fonte de fora que diz o que pede ação num espaço (um painel,
// por exemplo). Cada um é configurado em config/local.json, pertence a UM
// espaço e só é lido, nunca escrito.
//
// Dois jeitos de chegar:
//   resumo-http   a Central lê um endereço local (o painel roda na mesma máquina);
//   resumo-push   o painel manda o resumo para a Central, com um token só dele
//                 (o painel está numa rede que a Central não alcança, e assim
//                 continua não alcançando).

import type { Banco } from '../db.ts';
import { resumoHttp } from './resumo-http.ts';
import { limparItens } from './itens.ts';

export type Item = { titulo: string; desc: string; qtd: number | null; urgente: boolean; link: string };
export type ConfigConector = { id: string; espaco: string; tipo: string; nome: string; [k: string]: unknown };
export type Leitura = { id: string; nome: string; espaco: string; itens: Item[]; erro: string | null; em: number | null };

const TIPOS = ['resumo-http', 'resumo-push'];
const VALIDADE = 2 * 60e3;
// Sem notícia do painel há mais que isto: avisa (continua mostrando o último).
const SILENCIO = 20 * 60e3;
const cache = new Map<string, { leitura: Leitura; carregando: Promise<Leitura> | null }>();

export function validarConfig(lista: ConfigConector[], espacos: string[]): void {
  const ids = new Set<string>();
  for (const c of lista) {
    if (!c.id || !/^[a-z0-9][a-z0-9-]{1,29}$/.test(c.id) || ids.has(c.id)) throw new Error(`conector sem id válido ou repetido: ${c.id}`);
    ids.add(c.id);
    if (!TIPOS.includes(c.tipo)) throw new Error(`conector ${c.id}: tipo desconhecido ${c.tipo}`);
    if (!espacos.includes(c.espaco)) throw new Error(`conector ${c.id}: espaço ${c.espaco} não existe`);
  }
}

// Recebe o que o painel empurrou.
export function guardarEmpurrado(db: Banco, c: ConfigConector, itens: unknown): number {
  const limpos = limparItens(itens);
  db.prepare(`INSERT INTO fontes_empurradas (conector, itens, em) VALUES (?, ?, ?)
    ON CONFLICT (conector) DO UPDATE SET itens = excluded.itens, em = excluded.em`).run(c.id, JSON.stringify(limpos), new Date().toISOString());
  return limpos.length;
}

function lerEmpurrado(db: Banco, c: ConfigConector): Leitura {
  const base = { id: c.id, nome: c.nome, espaco: c.espaco };
  const r = db.prepare('SELECT itens, em FROM fontes_empurradas WHERE conector = ?').get(c.id) as { itens: string; em: string } | undefined;
  if (!r) return { ...base, itens: [], erro: 'ainda não recebeu nada do painel', em: null };
  const em = Date.parse(r.em);
  const calado = Date.now() - em > SILENCIO;
  const hora = new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return { ...base, itens: JSON.parse(r.itens), erro: calado ? `sem notícia do painel desde ${hora}` : null, em };
}

export async function ler(c: ConfigConector, db: Banco, forcar = false): Promise<Leitura> {
  if (c.tipo === 'resumo-push') return lerEmpurrado(db, c);
  const atual = cache.get(c.id);
  if (atual?.carregando) return atual.carregando;
  if (!forcar && atual && atual.leitura.em && Date.now() - atual.leitura.em < VALIDADE) return atual.leitura;
  const anterior = atual?.leitura;
  const carregando = resumoHttp(c)
    .then((itens) => ({ id: c.id, nome: c.nome, espaco: c.espaco, itens, erro: null, em: Date.now() }))
    // Falhou: guarda o erro, mas continua mostrando o que tinha antes.
    .catch((e: Error) => ({ id: c.id, nome: c.nome, espaco: c.espaco, itens: anterior?.itens ?? [], erro: e.message, em: anterior?.em ?? null }))
    .then((leitura) => { cache.set(c.id, { leitura, carregando: null }); return leitura; });
  cache.set(c.id, { leitura: anterior ?? { id: c.id, nome: c.nome, espaco: c.espaco, itens: [], erro: null, em: null }, carregando });
  return carregando;
}
