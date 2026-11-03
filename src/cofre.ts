// Cofre: cifra o que não pode ficar legível no banco (senha de e-mail, segredo
// do autenticador, sessão do WhatsApp). AES-256-GCM com uma chave que mora
// FORA do banco: um backup do .sqlite3 sozinho não abre nada.
//
// A chave vem de CENTRAL_CHAVE_ARQ (arquivo com 32 bytes em base64). Se o
// arquivo não existe, é criado na primeira subida com permissão 600.
// O "contexto" amarra o texto cifrado ao lugar dele (ex.: "conta:gmail"), para
// que um valor copiado de uma linha para outra não decifre.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Cofre = { cifrar: (texto: string, contexto: string) => string; decifrar: (cifrado: string, contexto: string) => string };

export function lerOuCriarChave(arquivo: string): Buffer {
  if (!existsSync(arquivo)) {
    mkdirSync(dirname(arquivo), { recursive: true, mode: 0o700 });
    writeFileSync(arquivo, randomBytes(32).toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  }
  const chave = Buffer.from(readFileSync(arquivo, 'utf8').trim(), 'base64');
  if (chave.length !== 32) throw new Error(`a chave em ${arquivo} não tem 32 bytes`);
  return chave;
}

export function criarCofre(chave: Buffer): Cofre {
  return {
    cifrar(texto, contexto) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', chave, iv);
      c.setAAD(Buffer.from(contexto));
      const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
      return 'v1:' + Buffer.concat([iv, c.getAuthTag(), corpo]).toString('base64');
    },
    decifrar(cifrado, contexto) {
      if (!cifrado.startsWith('v1:')) throw new Error('segredo em formato desconhecido');
      const b = Buffer.from(cifrado.slice(3), 'base64');
      const d = createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12));
      d.setAAD(Buffer.from(contexto));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
