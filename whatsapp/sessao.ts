// Sessão do WhatsApp em disco, cifrada. A sessão é a chave do aparelho
// vinculado: quem a copia lê o WhatsApp. Por isso cada arquivo é cifrado com
// AES-256-GCM (o mesmo cofre da Central) e a chave mora fora da pasta.
//
// Mesmo formato de pastas do useMultiFileAuthState do Baileys, só que cifrado.

import { mkdir, readFile, writeFile, unlink, rm, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type { Cofre } from '../src/cofre.ts';

const nomeArq = (f: string) => f.replace(/\//g, '__').replace(/:/g, '-');

export async function sessaoCifrada(pasta: string, cofre: Cofre) {
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  // Uma fila por arquivo: escrita e leitura do mesmo arquivo não se cruzam.
  const filas = new Map<string, Promise<unknown>>();
  const naFila = <T>(arq: string, fn: () => Promise<T>): Promise<T> => {
    const p = (filas.get(arq) ?? Promise.resolve()).then(fn, fn);
    filas.set(arq, p.catch(() => {}));
    return p;
  };
  const gravar = (dado: unknown, f: string) => {
    const arq = join(pasta, nomeArq(f) + '.cifrado');
    return naFila(arq, async () => {
      const tmp = `${arq}.${randomBytes(4).toString('hex')}`;
      await writeFile(tmp, cofre.cifrar(JSON.stringify(dado, BufferJSON.replacer), `wa:${f}`), { mode: 0o600 });
      await rename(tmp, arq);
    });
  };
  const ler = (f: string) => {
    const arq = join(pasta, nomeArq(f) + '.cifrado');
    return naFila(arq, async () => {
      try { return JSON.parse(cofre.decifrar(await readFile(arq, 'utf8'), `wa:${f}`), BufferJSON.reviver); } catch { return null; }
    });
  };
  const apagar = (f: string) => {
    const arq = join(pasta, nomeArq(f) + '.cifrado');
    return naFila(arq, () => unlink(arq).catch(() => {}));
  };

  const creds = (await ler('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (tipo: string, ids: string[]) => {
          const out: Record<string, unknown> = {};
          await Promise.all(ids.map(async (id) => {
            let v = await ler(`${tipo}-${id}`);
            if (tipo === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (dados: Record<string, Record<string, unknown>>) => {
          const t: Promise<unknown>[] = [];
          for (const tipo in dados) for (const id in dados[tipo]) t.push(dados[tipo][id] ? gravar(dados[tipo][id], `${tipo}-${id}`) : apagar(`${tipo}-${id}`));
          await Promise.all(t);
        },
      },
    },
    salvarCreds: () => gravar(creds, 'creds'),
    // Apaga o conteúdo, não a pasta: no servidor ela é um volume montado.
    apagarTudo: async () => {
      for (const f of await readdir(pasta).catch(() => [] as string[])) await rm(join(pasta, f), { recursive: true, force: true });
    },
  };
}
