// Banco local em SQLite (node:sqlite, sem dependência). Um arquivo só em
// data/, com permissão só do usuário. As migrações de migrations/ entram em
// ordem, cada uma numa transação, e ficam anotadas em migracoes.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Banco = DatabaseSync;

const PASTA_MIGRACOES = new URL('../migrations/', import.meta.url);

export function abrir(caminho: string): Banco {
  if (caminho !== ':memory:') {
    mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
    const novo = !existsSync(caminho);
    const db = new DatabaseSync(caminho);
    if (novo) chmodSync(caminho, 0o600);
    return preparar(db);
  }
  return preparar(new DatabaseSync(':memory:'));
}

function preparar(db: Banco): Banco {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, em TEXT NOT NULL)');
  const feitas = new Set(db.prepare('SELECT nome FROM migracoes').all().map((r) => String(r.nome)));
  for (const nome of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith('.sql')).sort()) {
    if (feitas.has(nome)) continue;
    emTransacao(db, () => {
      db.exec(readFileSync(join(PASTA_MIGRACOES.pathname, nome), 'utf8'));
      db.prepare('INSERT INTO migracoes (nome, em) VALUES (?, ?)').run(nome, agora());
    });
  }
  return db;
}

export const agora = (): string => new Date().toISOString();

export function emTransacao<T>(db: Banco, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function registrar(db: Banco, tabela: string, registro: string | number | bigint, acao: 'criou' | 'alterou' | 'apagou', dados: unknown): void {
  db.prepare('INSERT INTO alteracoes (tabela, registro, acao, dados, em) VALUES (?, ?, ?, ?, ?)')
    .run(tabela, String(registro), acao, JSON.stringify(dados), agora());
}

// Erro de quem chamou (dado inválido, registro que não existe): vira 4xx, não 500.
export class ErroDeEntrada extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

export function texto(v: unknown, campo: string, max: number, obrigatorio = true): string {
  const t = String(v ?? '').trim();
  if (obrigatorio && !t) throw new ErroDeEntrada(`${campo} é obrigatório`);
  if (t.length > max) throw new ErroDeEntrada(`${campo} passa de ${max} caracteres`);
  return t;
}
