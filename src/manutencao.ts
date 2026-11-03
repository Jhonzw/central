// Faxina e backup, uma vez por dia (e na subida):
//   - tentativa de login velha, sessão e convite vencidos saem;
//   - texto de mensagem mais velho que a retenção é apagado;
//   - cópia do banco em backups/, guardando as 7 últimas.
// O backup tem os segredos só cifrados; a chave do cofre fica em outro lugar.

import { mkdirSync, readdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from './db.ts';
import { limpar } from './acesso.ts';
import { reter } from './caixa.ts';

const MANTER = 7;

export function backup(db: Banco, pasta: string): string {
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const arq = join(pasta, `central-${dia}.sqlite3`);
  if (existsSync(arq)) rmSync(arq);
  db.prepare('VACUUM INTO ?').run(arq);
  chmodSync(arq, 0o600);
  const antigos = readdirSync(pasta).filter((f) => /^central-\d{4}-\d{2}-\d{2}\.sqlite3$/.test(f)).sort().reverse().slice(MANTER);
  for (const f of antigos) rmSync(join(pasta, f));
  return arq;
}

export function faxina(db: Banco, { retencaoDias, backups }: { retencaoDias: number; backups: string }) {
  limpar(db);
  const apagados = reter(db, retencaoDias);
  const arq = backup(db, backups);
  return { apagados, backup: arq };
}

export function agendar(db: Banco, cfg: { retencaoDias: number; backups: string }) {
  const rodar = () => {
    try {
      const r = faxina(db, cfg);
      console.log(`faxina: ${r.apagados} textos vencidos apagados; backup em ${r.backup}`);
    } catch (e) { console.error('faxina falhou:', (e as Error).message); }
  };
  setTimeout(rodar, 60e3).unref();
  setInterval(rodar, 24 * 36e5).unref();
  setInterval(() => limpar(db), 36e5).unref();
}
