// Lê as caixas de e-mail de tempos em tempos e põe as mensagens novas na
// caixa da Central. Na primeira leitura de uma caixa vêm só os últimos dias,
// não o arquivo inteiro.

import type { Banco } from '../db.ts';
import type { Cofre } from '../cofre.ts';
import * as contas from '../contas.ts';
import { receber } from '../caixa.ts';
import { Imap, type Valor, type Rede } from './imap.ts';
import { cabecalhos, enderecos, palavras, trecho, semPrefixo, chaveDaConversa } from './mime.ts';

const CAMPOS =
  'FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE CONTENT-TRANSFER-ENCODING CONTENT-DISPOSITION';
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pegar = (obj: Record<string, Valor>, prefixo: string): Buffer => {
  const k = Object.keys(obj).find((x) => x.startsWith(prefixo));
  const v = k ? obj[k] : null;
  return Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : '', 'latin1');
};

export async function lerConta(
  db: Banco,
  cofre: Cofre,
  id: string,
  { diasNaPrimeira = 14, maximo = 200, rede }: { diasNaPrimeira?: number; maximo?: number; rede?: Rede } = {},
): Promise<{ novas: number }> {
  const conta = contas.obter(db, id);
  if (conta.tipo !== 'email') throw new Error('conta não é de e-mail');
  const cfg = conta.config as contas.ConfigEmail;
  type Cursor = { uidvalidity?: number; ultimo_uid?: number };
  const estado = conta.estado as Cursor & { pastas?: Record<string, Cursor> };
  const entrada = cfg.pasta || 'INBOX';
  const pastas = [...new Set([entrada, cfg.pasta_enviados].filter((p): p is string => !!p))];
  const cursores = { ...estado.pastas };
  let imap: Imap | null = null;
  let novas = 0;
  const anotar = () =>
    contas.anotarLeitura(db, id, { estado: { ...estado, ...cursores[entrada], pastas: cursores } });
  try {
    imap = await Imap.abrir({ host: cfg.host, porta: cfg.porta, rede });
    await imap.entrar(cfg.usuario, contas.senha(db, cofre, id));
    for (const pasta of pastas) {
      const { uidvalidity } = await imap.examinar(pasta);
      const cursor = cursores[pasta] ?? (pasta === entrada ? estado : {});
      let ultimo = cursor.uidvalidity === uidvalidity ? (cursor.ultimo_uid ?? 0) : 0;
      let uids: number[];
      if (ultimo) uids = (await imap.buscar(`UID ${ultimo + 1}:*`)).filter((u) => u > ultimo);
      else {
        const d = new Date(Date.now() - diasNaPrimeira * 864e5);
        uids = await imap.buscar(`SINCE ${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}`);
      }
      // Processa os mais antigos primeiro: o cursor nunca ultrapassa o backlog.
      uids = [...new Set(uids)]
        .filter((u) => Number.isSafeInteger(u) && u > 0)
        .sort((a, b) => a - b)
        .slice(0, maximo);
      for (let i = 0; i < uids.length; i += 25) {
        const pedidos = uids.slice(i, i + 25);
        const lote = await imap.trazer(
          pedidos,
          `UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (${CAMPOS})] BODY.PEEK[TEXT]<0.16000>`,
        );
        // FETCH pode responder fora de ordem; não avança por uma resposta inesperada.
        const porUid = new Map(lote.map((m) => [Number(m.UID), m]));
        for (const uid of pedidos) {
          const m = porUid.get(uid);
          if (!m) throw new Error('resposta IMAP incompleta');
          const cab = cabecalhos(pegar(m, 'BODY[HEADER'));
          const de = enderecos(cab.from)[0];
          const para = enderecos(cab.to)[0];
          const deMim = !!de && de.endereco === conta.endereco;
          const outro = deMim ? para : de;
          const assunto = palavras(cab.subject || '').slice(0, 300);
          const data = Date.parse(cab.date || '') || Date.parse(String(m.INTERNALDATE || '')) || Date.now();
          const externo =
            (cab['message-id'] || '').match(/<[^<>\s]+>/)?.[0] ||
            (pasta === entrada
              ? `uid:${uidvalidity}:${uid}`
              : `uid:${encodeURIComponent(pasta)}:${uidvalidity}:${uid}`);
          // A mesma mensagem pode estar em Entrada e Enviados. Reutiliza a chave
          // existente antes de receber, inclusive quando faltam referências antigas.
          const referencias = [
            externo,
            ...((cab.references || '').match(/<[^<>\s]+>/g) || []),
            ...((cab['in-reply-to'] || '').match(/<[^<>\s]+>/g) || []),
          ];
          let existente: { chave: string } | undefined;
          for (const ref of referencias) {
            existente = db
              .prepare(
                `SELECT c.chave FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE c.conta_id = ? AND m.externo = ? ORDER BY m.id LIMIT 1`,
              )
              .get(id, ref) as { chave: string } | undefined;
            if (existente) break;
          }
          const r = receber(db, {
            conta: id,
            chave: existente?.chave || chaveDaConversa(cab) || externo,
            externo,
            titulo: semPrefixo(assunto) || '(sem assunto)',
            endereco: outro?.endereco ?? '',
            autor: de ? de.nome || de.endereco : '',
            de_mim: deMim,
            assunto,
            texto: trecho(cab, pegar(m, 'BODY[TEXT]')),
            em: new Date(data).toISOString(),
          });
          if (r.nova) novas++;
          ultimo = uid;
        }
        cursores[pasta] = { uidvalidity, ultimo_uid: ultimo };
        anotar();
      }
      cursores[pasta] = { uidvalidity, ultimo_uid: ultimo };
      anotar();
    }
    return { novas };
  } catch (e) {
    // Nunca persiste nem devolve texto arbitrário recebido do provedor.
    const erro = new Error(
      (e as Error).message.includes('AUTHENTICATIONFAILED')
        ? 'IMAP: AUTHENTICATIONFAILED — confira as credenciais'
        : 'Não foi possível ler a caixa de e-mail',
    );
    contas.anotarLeitura(db, id, { erro: erro.message });
    throw erro;
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
        try {
          await lerConta(db, cofre, c.id);
        } catch (e) {
          console.error(`e-mail ${c.id}: ${(e as Error).message}`);
        }
      }
    })().finally(() => {
      rodando = null;
    });
    return rodando;
  };
  const t = setInterval(volta, minutos * 60e3);
  t.unref();
  setTimeout(volta, 5000).unref();
  return { volta, parar: () => clearInterval(t) };
}
