// Lê as caixas de e-mail de tempos em tempos e põe as mensagens novas na
// caixa da Central. Na primeira leitura de uma caixa vêm só os últimos dias,
// não o arquivo inteiro.

import type { Banco } from '../db.ts';
import type { Cofre } from '../cofre.ts';
import * as contas from '../contas.ts';
import { receber } from '../caixa.ts';
import { Imap, type Valor, type Rede } from './imap.ts';
import { cabecalhos, enderecos, palavras, trecho, semPrefixo, chaveDaConversa } from './mime.ts';

const CAMPOS = 'FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE CONTENT-TRANSFER-ENCODING CONTENT-DISPOSITION';
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pegar = (obj: Record<string, Valor>, prefixo: string): Buffer => {
  const k = Object.keys(obj).find((x) => x.startsWith(prefixo));
  const v = k ? obj[k] : null;
  return Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : '', 'latin1');
};

export async function lerConta(db: Banco, cofre: Cofre, id: string, { diasNaPrimeira = 14, maximo = 200, rede }: { diasNaPrimeira?: number; maximo?: number; rede?: Rede } = {}): Promise<{ novas: number }> {
  const conta = contas.obter(db, id);
  if (conta.tipo !== 'email') throw new Error('conta não é de e-mail');
  const cfg = conta.config as contas.ConfigEmail;
  const estado = conta.estado as { uidvalidity?: number; ultimo_uid?: number };
  let imap: Imap | null = null;
  try {
    imap = await Imap.abrir({ host: cfg.host, porta: cfg.porta, rede });
    await imap.entrar(cfg.usuario, contas.senha(db, cofre, id));
    const { uidvalidity } = await imap.examinar(cfg.pasta || 'INBOX');
    // UIDVALIDITY mudou: os números antigos não valem mais, lê de novo pelos dias.
    let ultimo = estado.uidvalidity === uidvalidity ? estado.ultimo_uid ?? 0 : 0;
    let uids: number[];
    if (ultimo) uids = (await imap.buscar(`UID ${ultimo + 1}:*`)).filter((u) => u > ultimo);
    else {
      const d = new Date(Date.now() - diasNaPrimeira * 864e5);
      uids = await imap.buscar(`SINCE ${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}`);
    }
    uids = uids.sort((a, b) => a - b).slice(-maximo);
    let novas = 0;
    for (let i = 0; i < uids.length; i += 25) {
      const lote = await imap.trazer(uids.slice(i, i + 25), `UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (${CAMPOS})] BODY.PEEK[TEXT]<0.16000>`);
      for (const m of lote) {
        const uid = Number(m.UID);
        const cab = cabecalhos(pegar(m, 'BODY[HEADER'));
        const de = enderecos(cab.from)[0];
        const para = enderecos(cab.to)[0];
        const deMim = !!de && de.endereco === conta.endereco;
        const outro = deMim ? para : de;
        const assunto = palavras(cab.subject || '').slice(0, 300);
        const data = Date.parse(cab.date || '') || Date.parse(String(m.INTERNALDATE || '')) || Date.now();
        const r = receber(db, {
          conta: id,
          chave: chaveDaConversa(cab) || `uid:${uidvalidity}:${uid}`,
          externo: (cab['message-id'] || '').match(/<[^<>\s]+>/)?.[0] || `uid:${uidvalidity}:${uid}`,
          titulo: semPrefixo(assunto) || '(sem assunto)',
          endereco: outro?.endereco ?? '',
          autor: de ? (de.nome || de.endereco) : '',
          de_mim: deMim,
          assunto,
          texto: trecho(cab, pegar(m, 'BODY[TEXT]')),
          em: new Date(data).toISOString(),
        });
        if (r.nova) novas++;
        ultimo = Math.max(ultimo, uid);
      }
      // Anota o progresso a cada lote: se cair no meio, não relê o que já veio.
      contas.anotarLeitura(db, id, { estado: { uidvalidity, ultimo_uid: ultimo } });
    }
    contas.anotarLeitura(db, id, { estado: { uidvalidity, ultimo_uid: ultimo } });
    return { novas };
  } catch (e) {
    contas.anotarLeitura(db, id, { erro: (e as Error).message.slice(0, 300) });
    throw e;
  } finally {
    await imap?.sair();
  }
}

// Uma volta por todas as caixas ativas, uma de cada vez.
export function iniciarColetor(db: Banco, cofre: Cofre, { minutos = 5 } = {}) {
  let rodando: Promise<void> | null = null;
  const volta = () => {
    if (rodando) return rodando;
    rodando = (async () => {
      for (const c of contas.listar(db, { tipo: 'email' }).filter((c) => c.ativa)) {
        try { await lerConta(db, cofre, c.id); } catch (e) { console.error(`e-mail ${c.id}: ${(e as Error).message}`); }
      }
    })().finally(() => { rodando = null; });
    return rodando;
  };
  const t = setInterval(volta, minutos * 60e3);
  t.unref();
  setTimeout(volta, 5000).unref();
  return { volta, parar: () => clearInterval(t) };
}
