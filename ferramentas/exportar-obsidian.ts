#!/usr/bin/env node
// Gera notas Markdown (Obsidian) a partir da Central: uma por espaço, com as
// projetos e tarefas abertas, conversas pedindo resposta e pessoas. O banco é a
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
const TOKEN = (
  process.env.CENTRAL_TOKEN ||
  (process.env.CENTRAL_TOKEN_ARQ ? readFileSync(process.env.CENTRAL_TOKEN_ARQ, 'utf8') : '')
).trim();
const destino = process.argv[2];
if (!destino || !TOKEN) {
  console.error(
    'uso: CENTRAL_TOKEN_ARQ=<token de leitura> node ferramentas/exportar-obsidian.ts <pasta do vault>',
  );
  process.exit(1);
}

const ler = async (c: string) => {
  const r = await fetch(URL_CENTRAL + c, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${c}: HTTP ${r.status}`);
  return r.json();
};

// Apenas campos permitidos entram nas notas. Nenhum corpo, descrição,
// nota de conversa, canal de contato ou dado do gateway local é exportado.
const md = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 200)
    .replace(/([\\`*_[\]{}()#+.!|<>~=^$-])/g, '\\$1');
const dia = (iso: string | null) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  return m ? `${m[3]}/${m[2]}` : 'sem data';
};
const nomeArq = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|#^[\]]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100) || 'espaco';

type Espaco = { id: string; nome: string };
type Projeto = { id: number; nome: string; status: string; prazo: string | null; proxima_acao: string };
type Tarefa = {
  id: number;
  projeto_id: number | null;
  titulo: string;
  status: string;
  proxima: string | null;
  prazo: string | null;
  pessoa_nome: string | null;
};
type Conversa = { id: number; titulo: string; pessoa_nome: string | null; canal: string; ultima_em: string };
type Pessoa = { nome: string; espacos: Array<{ id: string; papel: string }> };
const tarefa = (t: Tarefa) =>
  `- [ ] ${md(t.titulo)} · planejado: ${dia(t.proxima)} · prazo: ${dia(t.prazo)} · ${md(t.status)}${t.pessoa_nome ? ` · com ${md(t.pessoa_nome)}` : ''}`;
const espacos = (await ler('/api/espacos')) as Espaco[];
mkdirSync(destino, { recursive: true });
const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

for (const e of espacos) {
  const q = `espaco=${encodeURIComponent(e.id)}`;
  const [tarefas, conversas, pessoas, projetos] = (await Promise.all([
    ler(`/api/tarefas?${q}`),
    ler(`/api/conversas?${q}&estado=responder`),
    ler(`/api/pessoas?${q}`),
    ler(`/api/projetos?${q}&todos=1`),
  ])) as [Tarefa[], Conversa[], Pessoa[], Projeto[]];
  const avulsas = tarefas.filter((t) => t.projeto_id === null || t.projeto_id === undefined);
  const indisponiveis = tarefas.filter(
    (t) =>
      t.projeto_id !== null && t.projeto_id !== undefined && !projetos.some((p) => p.id === t.projeto_id),
  );
  const linhas = [
    '---',
    `espaco: ${JSON.stringify(e.id)}`,
    `gerado: ${new Date().toISOString()}`,
    'fonte: central',
    '---',
    '',
    `# ${md(e.nome)}`,
    '',
    `> Gerado pela Central em ${agora}. Não edite aqui: muda na Central e gere de novo.`,
    '',
    `## Projetos (${projetos.length})`,
    '',
    ...projetos.flatMap((p) => [
      `### ${md(p.nome)}`,
      '',
      `Estado: ${md(p.status)} · prazo: ${dia(p.prazo)}`,
      ...(p.proxima_acao ? [`Próxima ação: ${md(p.proxima_acao)}`] : []),
      '',
      ...tarefas.filter((t) => t.projeto_id === p.id).map(tarefa),
      '',
    ]),
    `## Tarefas sem projeto (${avulsas.length})`,
    '',
    ...avulsas.map(tarefa),
    ...(indisponiveis.length
      ? ['', '## Tarefas com projeto indisponível', '', ...indisponiveis.map(tarefa)]
      : []),
    '',
    `## Conversas pedindo resposta (${conversas.length})`,
    '',
    ...conversas.map(
      (c) =>
        `- ${c.canal === 'email' ? 'E-mail' : 'WhatsApp'} · ${md(c.pessoa_nome || c.titulo)} · desde ${dia(c.ultima_em)}`,
    ),
    '',
    `## Pessoas (${pessoas.length})`,
    '',
    ...pessoas.map(
      (p) =>
        `- ${md(p.nome)}${p.espacos.find((x) => x.id === e.id)?.papel ? ` · ${md(p.espacos.find((x) => x.id === e.id)!.papel)}` : ''}`,
    ),
    '',
  ];
  writeFileSync(join(destino, `${nomeArq(e.id)} - ${nomeArq(e.nome)}.md`), linhas.join('\n'));
  console.log(
    `Exportado: ${projetos.length} projetos, ${tarefas.length} tarefas, ${conversas.length} conversas, ${pessoas.length} pessoas`,
  );
}
