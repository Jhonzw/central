#!/usr/bin/env node
// Linha de comando de quem administra a máquina (precisa acesso ao banco).
//
//   node src/admin.ts convite [horas]          link de uso único para criar/trocar senha e autenticador
//   node src/admin.ts token <nome> <escopo>    token de máquina: leitura | fonte:<conector> | whatsapp:<conta>
//   node src/admin.ts tokens                   lista os tokens
//   node src/admin.ts revogar <id>             revoga um token
//   node src/admin.ts sair-de-todas            derruba todas as sessões
//   node src/admin.ts backup                   faz o backup agora
//   node src/admin.ts whatsapp <id> <espaço> <arquivo>
//                                              cria a conta de WhatsApp e grava o token do processo no arquivo (600)
//
// CENTRAL_URL muda o endereço impresso no convite (padrão http://localhost:<porta>).

import { abrir } from './db.ts';
import { lerConfig } from './config.ts';
import * as acesso from './acesso.ts';
import { backup } from './manutencao.ts';
import { lerOuCriarChave, criarCofre } from './cofre.ts';
import * as contas from './contas.ts';
import { writeFileSync } from 'node:fs';

const cfg = lerConfig();
const db = abrir(cfg.banco);
const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'convite': {
    const horas = Number(args[0] || 24);
    const c = acesso.criarConvite(db, horas);
    const base = process.env.CENTRAL_URL || `http://localhost:${cfg.porta}`;
    console.log(`Convite de uso único (vale ${horas} h). Abra no navegador:\n\n  ${base}/#convite=${c}\n`);
    console.log('Ao concluir, a senha e o autenticador antigos deixam de valer e todas as sessões caem.');
    break;
  }
  case 'token': {
    const { token, registro } = acesso.criarToken(db, args[0], args[1]);
    console.log(`Token #${registro.id} (${registro.escopo}). Aparece só agora; guarde no lugar onde ele vai ser usado:\n\n  ${token}\n`);
    break;
  }
  case 'tokens':
    console.table(acesso.listarTokens(db));
    break;
  case 'revogar':
    acesso.revogarToken(db, Number(args[0]));
    console.log('revogado');
    break;
  case 'sair-de-todas':
    console.log(`${acesso.sairDeTodas(db)} sessões encerradas`);
    break;
  case 'backup':
    console.log(backup(db, cfg.backups));
    break;
  case 'whatsapp': {
    const [id, espaco, arquivo] = args;
    if (!arquivo) throw new Error('uso: whatsapp <id> <espaço> <arquivo do token>');
    contas.salvar(db, criarCofre(lerOuCriarChave(cfg.chave)), { id, tipo: 'whatsapp', nome: 'WhatsApp', espaco_id: espaco });
    const { token } = acesso.criarToken(db, `processo do WhatsApp ${id}`, `whatsapp:${id}`);
    writeFileSync(arquivo, token + '\n', { mode: 0o600 });
    console.log(`conta ${id} criada; token gravado em ${arquivo}`);
    break;
  }
  default:
    console.log('uso: node src/admin.ts convite [horas] | token <nome> <escopo> | tokens | revogar <id> | sair-de-todas | backup | whatsapp <id> <espaço> <arquivo>');
    process.exitCode = 1;
}
db.close();
