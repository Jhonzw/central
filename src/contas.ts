// Contas ligadas: caixas de e-mail (IMAP) e números de WhatsApp. Cada uma
// pertence a um espaço. A senha entra pela tela, vai cifrada para o banco e
// nunca mais volta para o navegador.

import { type Banco, agora, emTransacao, registrar, texto, ErroDeEntrada } from './db.ts';
import { obter as obterEspaco } from './espacos.ts';
import type { Cofre } from './cofre.ts';

export type ConfigEmail = { host: string; porta: number; usuario: string; pasta: string };
export type Conta = {
  id: string; espaco_id: string; tipo: 'email' | 'whatsapp'; nome: string; endereco: string;
  config: Partial<ConfigEmail>; ativa: number; estado: Record<string, unknown>; lida_em: string | null; erro: string | null; tem_senha: boolean;
};

function montar(l: Record<string, unknown>): Conta {
  return {
    id: String(l.id), espaco_id: String(l.espaco_id), tipo: l.tipo as Conta['tipo'], nome: String(l.nome), endereco: String(l.endereco),
    config: JSON.parse(String(l.config)), ativa: Number(l.ativa), estado: JSON.parse(String(l.estado)),
    lida_em: (l.lida_em as string) ?? null, erro: (l.erro as string) ?? null, tem_senha: !!l.segredo,
  };
}

const SELECT = 'SELECT id, espaco_id, tipo, nome, endereco, config, segredo, ativa, estado, lida_em, erro FROM contas';

export const listar = (db: Banco, { tipo }: { tipo?: string } = {}): Conta[] =>
  (tipo ? db.prepare(`${SELECT} WHERE tipo = ? ORDER BY nome`).all(tipo) : db.prepare(`${SELECT} ORDER BY tipo, nome`).all()).map(montar);

export function obter(db: Banco, id: string): Conta {
  const l = db.prepare(`${SELECT} WHERE id = ?`).get(id);
  if (!l) throw new ErroDeEntrada(`conta ${id} não existe`, 404);
  return montar(l);
}

// Host de e-mail: nome DNS comum, sem IP interno nem localhost (a Central não
// pode virar ponte para a rede de dentro da VPS).
function validarHost(v: unknown): string {
  const h = String(v ?? '').trim().toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) throw new ErroDeEntrada('servidor IMAP: use o nome, ex.: imap.gmail.com');
  if (/(^|\.)(localhost|local|internal|lan)$/.test(h)) throw new ErroDeEntrada('servidor IMAP não pode ser interno');
  return h;
}

export function salvar(db: Banco, cofre: Cofre, dados: Record<string, unknown>): Conta {
  const id = String(dados.id ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(id)) throw new ErroDeEntrada('id da conta: 2 a 30 letras minúsculas, números ou hífen');
  return emTransacao(db, () => {
    const atual = db.prepare('SELECT tipo, segredo, config, endereco FROM contas WHERE id = ?').get(id) as { tipo: string; segredo: string | null; config: string; endereco: string } | undefined;
    const tipo = String(atual?.tipo ?? dados.tipo);
    if (!['email', 'whatsapp'].includes(tipo)) throw new ErroDeEntrada('tipo: email ou whatsapp');
    const espaco = obterEspaco(db, String(dados.espaco_id ?? '')).id;
    const nome = texto(dados.nome, 'nome', 60);
    const ativa = dados.ativa === false ? 0 : 1;
    let config = '{}';
    let endereco = atual?.endereco ?? '';
    let segredo = atual?.segredo ?? null;
    if (tipo === 'email') {
      const usuario = texto(dados.usuario, 'usuário', 200);
      const porta = Number(dados.porta || 993);
      // Só IMAP com TLS desde o começo da conexão. Porta 143 (texto aberto/STARTTLS) não entra.
      if (porta !== 993) throw new ErroDeEntrada('só IMAP com TLS (porta 993)');
      config = JSON.stringify({ host: validarHost(dados.host), porta, usuario, pasta: texto(dados.pasta || 'INBOX', 'pasta', 100) });
      endereco = texto(dados.endereco || usuario, 'endereço', 200).toLowerCase();
      if (dados.senha) segredo = cofre.cifrar(texto(dados.senha, 'senha', 500), `conta:${id}`);
      if (!segredo) throw new ErroDeEntrada('informe a senha (de app) da caixa');
    }
    const mudouOrigem = atual && tipo === 'email' && atual.config !== config;
    if (atual) {
      db.prepare(`UPDATE contas SET espaco_id = ?, nome = ?, endereco = ?, config = ?, segredo = ?, ativa = ?, erro = NULL${mudouOrigem ? ", estado = '{}'" : ''} WHERE id = ?`)
        .run(espaco, nome, endereco, config, segredo, ativa, id);
    } else {
      db.prepare('INSERT INTO contas (id, espaco_id, tipo, nome, endereco, config, segredo, ativa, criado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, espaco, tipo, nome, endereco, config, segredo, ativa, agora());
    }
    // Nunca anota a senha no histórico.
    registrar(db, 'contas', id, atual ? 'alterou' : 'criou', { espaco, tipo, nome, endereco, config: JSON.parse(config), ativa, senhaTrocada: !!dados.senha });
    return obter(db, id);
  });
}

export function apagar(db: Banco, id: string): void {
  emTransacao(db, () => {
    const c = obter(db, id);
    db.prepare('DELETE FROM contas WHERE id = ?').run(id);
    registrar(db, 'contas', id, 'apagou', { nome: c.nome, tipo: c.tipo });
  });
}

export function senha(db: Banco, cofre: Cofre, id: string): string {
  const l = db.prepare('SELECT segredo FROM contas WHERE id = ?').get(id) as { segredo: string | null } | undefined;
  if (!l?.segredo) throw new Error(`conta ${id} sem senha`);
  return cofre.decifrar(l.segredo, `conta:${id}`);
}

export function anotarLeitura(db: Banco, id: string, { estado, erro }: { estado?: Record<string, unknown>; erro?: string | null }): void {
  if (estado) db.prepare('UPDATE contas SET estado = ?, lida_em = ?, erro = ? WHERE id = ?').run(JSON.stringify(estado), agora(), erro ?? null, id);
  else db.prepare('UPDATE contas SET erro = ? WHERE id = ?').run(erro ?? null, id);
}

// Mescla no estado (o WhatsApp manda pedaços: conectado, código de pareamento...).
export function mesclarEstado(db: Banco, id: string, parte: Record<string, unknown>): Conta {
  const c = obter(db, id);
  db.prepare('UPDATE contas SET estado = ? WHERE id = ?').run(JSON.stringify({ ...c.estado, ...parte }), id);
  return obter(db, id);
}
