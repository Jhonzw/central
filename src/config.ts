// De onde vêm as configurações: config/local.json (fora do git) e variáveis
// de ambiente, que ganham do arquivo. Servidor e linha de comando leem igual.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigConector } from './conectores/index.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Config = {
  nome: string;
  porta: number;
  escuta: string;            // 127.0.0.1 na máquina; 0.0.0.0 só dentro do contêiner
  hosts: string[];           // nomes aceitos no cabeçalho Host, além de localhost
  proxy: boolean;            // atrás do nginx: o IP de verdade vem em X-Real-IP
  https: boolean;            // servido por HTTPS: manda HSTS
  banco: string;
  chave: string;             // arquivo da chave do cofre (fora da pasta do banco)
  backups: string;
  retencaoDias: number;      // texto de mensagem mais velho que isto é apagado
  emailMinutos: number;
  espacos: Array<Record<string, unknown>>;
  conectores: ConfigConector[];
};

export function lerConfig(env = process.env): Config {
  const arq = env.CENTRAL_CONFIG || join(RAIZ, 'config/local.json');
  const f = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : { espacos: [{ id: 'pessoal', nome: 'Pessoal' }] };
  const banco = env.CENTRAL_BANCO || f.banco || join(RAIZ, 'data/central.sqlite3');
  const sim = (v: unknown) => v === true || v === '1' || v === 'true';
  const lista = (v: unknown) => String(v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    nome: String(f.nome || ''),
    porta: Number(env.CENTRAL_PORTA || f.porta || 7800),
    escuta: env.CENTRAL_ESCUTA || f.escuta || '127.0.0.1',
    hosts: [...lista(env.CENTRAL_HOSTS), ...(Array.isArray(f.hosts) ? f.hosts.map((h: string) => h.toLowerCase()) : [])],
    proxy: sim(env.CENTRAL_PROXY ?? f.proxy),
    https: sim(env.CENTRAL_HTTPS ?? f.https),
    banco,
    chave: env.CENTRAL_CHAVE_ARQ || f.chave || join(RAIZ, 'config/chave'),
    backups: env.CENTRAL_BACKUPS || f.backups || join(dirname(banco), 'backup'),
    retencaoDias: Number(f.retencaoDias || 90),
    emailMinutos: Number(env.CENTRAL_EMAIL_MINUTOS ?? f.emailMinutos ?? 5),
    espacos: f.espacos || [],
    conectores: f.conectores || [],
  };
}
