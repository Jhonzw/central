#!/usr/bin/env node
// Gera notas Markdown (Obsidian) a partir da Central: uma por espaço, com as
// tarefas abertas, as conversas pedindo resposta e as pessoas. O banco é a
// verdade; estas notas são só a saída (editar aqui não volta para a Central).
//
// Leva o mínimo: título das conversas, sem o texto das mensagens, e pessoas
// sem telefone/e-mail. Um vault costuma ir para sincronização e backup.
//
//   CENTRAL_URL=http://localhost:7800 CENTRAL_TOKEN_ARQ=~/.central-token \
//     node ferramentas/exportar-obsidian.ts "/caminho/do/Vault/Central"

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_CENTRAL = (process.env.CENTRAL_URL || 'http://localhost:7800').replace(/\/$/, '');
const TOKEN = (process.env.CENTRAL_TOKEN || (process.env.CENTRAL_TOKEN_ARQ ? readFileSync(process.env.CENTRAL_TOKEN_ARQ, 'utf8') : '')).trim();
const destino = process.argv[2];
if (!destino || !TOKEN) {
  console.error('uso: CENTRAL_TOKEN_ARQ=<token de leitura> node ferramentas/exportar-obsidian.ts <pasta do vault>');
  process.exit(1);
}

const ler = async (c: string) => {
  const r = await fetch(URL_CENTRAL + c, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${c}: HTTP ${r.status}`);
  return r.json();
};

// Texto de fora não vira link, embed nem comando do Obsidian.
const md = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]#|<>!])/g, '\\$1').slice(0, 200);
const dia = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : 'sem data');
const nomeArq = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim();

type Espaco = { id: string; nome: string };
const espacos = await ler('/api/espacos') as Espaco[];
mkdirSync(destino, { recursive: true });
const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

for (const e of espacos) {
  const q = `espaco=${encodeURIComponent(e.id)}`;
  const [tarefas, conversas, pessoas] = await Promise.all([ler(`/api/tarefas?${q}`), ler(`/api/conversas?${q}&estado=responder`), ler(`/api/pessoas?${q}`)]) as
    [Array<{ id: number; titulo: string; status: string; proxima: string | null; pessoa_nome: string | null }>,
     Array<{ id: number; titulo: string; pessoa_nome: string | null; canal: string; ultima_em: string }>,
     Array<{ nome: string; espacos: Array<{ id: string; papel: string }> }>];
  const linhas = [
    '---', `espaco: ${e.id}`, `gerado: ${new Date().toISOString()}`, 'fonte: central', '---', '',
    `# ${md(e.nome)}`, '', `> Gerado pela Central em ${agora}. Não edite aqui: muda na Central e gere de novo.`, '',
    `## Tarefas abertas (${tarefas.length})`, '',
    ...tarefas.map((t) => `- [ ] ${md(t.titulo)} · ${dia(t.proxima)} · ${t.status}${t.pessoa_nome ? ` · com ${md(t.pessoa_nome)}` : ''}`),
    '', `## Conversas pedindo resposta (${conversas.length})`, '',
    ...conversas.map((c) => `- ${c.canal === 'email' ? 'E-mail' : 'WhatsApp'} · ${md(c.pessoa_nome || c.titulo)} · desde ${dia(c.ultima_em)}`),
    '', `## Pessoas (${pessoas.length})`, '',
    ...pessoas.map((p) => `- ${md(p.nome)}${p.espacos.find((x) => x.id === e.id)?.papel ? ` · ${md(p.espacos.find((x) => x.id === e.id)!.papel)}` : ''}`),
    '',
  ];
  writeFileSync(join(destino, `${nomeArq(e.nome)}.md`), linhas.join('\n'));
  console.log(`${e.nome}: ${tarefas.length} tarefas, ${conversas.length} conversas, ${pessoas.length} pessoas`);
}
