// Cliente IMAP mínimo, só para LER. Sem dependência.
//
// Só leitura pelo próprio protocolo:
//   - a pasta é aberta com EXAMINE (o servidor não aceita mudança nela);
//   - o conteúdo vem com BODY.PEEK, que não marca a mensagem como lida.
// Só TLS desde o primeiro byte (porta 993), com certificado conferido, e nunca
// para endereço interno (loopback, rede privada): a Central não pode virar
// ponte para dentro da VPS.

import { connect, type TLSSocket } from 'node:tls';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';

export type Valor = string | Buffer | null | Valor[];
export type Rede = { ca?: string; permitirInterno?: boolean };
type Unidade = { texto: string; literais: Buffer[] };

const MARCA = '\u0000';

export function enderecoInterno(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80'))
      return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? enderecoInterno(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

// Resolve o nome e recusa se cair em endereço interno.
function lookupSeguro(
  host: string,
  opcoes: object,
  cb: (e: Error | null, end: string | Array<{ address: string; family: number }>, fam?: number) => void,
) {
  lookup(host, { ...opcoes, all: true }, (e, lista) => {
    if (e) return cb(e, '');
    const ok = (lista as Array<{ address: string; family: number }>).filter(
      (x) => !enderecoInterno(x.address),
    );
    if (!ok.length) return cb(new Error(`${host} aponta para endereço interno`), '');
    if ((opcoes as { all?: boolean }).all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

// "x" com \ e " escapados. Texto que não cabe em aspas (quebra de linha) não é aceito.
export function aspas(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error('texto inválido para IMAP');
  return `"${s.replace(/[\\"]/g, (c) => '\\' + c)}"`;
}

// IMAP4rev1 identifica pastas em modified UTF-7, inclusive acentos e &.
function nomeDaPasta(pasta: string): string {
  aspas(pasta); // Rejeita controles antes da codificação.
  return pasta.replace(/&|[^\x20-\x7e]+/g, (trecho) => {
    if (trecho === '&') return '&-';
    const bytes = Buffer.from(trecho, 'utf16le');
    bytes.swap16();
    return '&' + bytes.toString('base64').replace(/=/g, '').replace(/\//g, ',') + '-';
  });
}

// ---------- Leitura das respostas ----------

// Quebra a resposta em itens: átomo, "texto", {n} literal, NIL e listas ( ).
// Átomo como BODY[HEADER.FIELDS (FROM)]<0> fica inteiro, colchete e tudo.
export function analisar(u: Unidade): Valor[] {
  const s = u.texto;
  let i = 0;
  const lista = (): Valor[] => {
    const out: Valor[] = [];
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') {
        i++;
        continue;
      }
      if (c === ')') {
        i++;
        return out;
      }
      if (c === '(') {
        i++;
        out.push(lista());
        continue;
      }
      if (c === '"') {
        let v = '';
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\') i++;
          v += s[i++];
        }
        i++;
        out.push(v);
        continue;
      }
      if (c === MARCA) {
        const fim = s.indexOf(MARCA, i + 1);
        out.push(u.literais[Number(s.slice(i + 1, fim))]);
        i = fim + 1;
        continue;
      }
      let v = '';
      let fundo = 0;
      while (i < s.length) {
        const d = s[i];
        if (d === '[') fundo++;
        else if (d === ']') fundo--;
        else if (fundo === 0 && (d === ' ' || d === ')' || d === '(')) break;
        v += d;
        i++;
      }
      out.push(v === 'NIL' ? null : v);
    }
    return out;
  };
  return lista();
}

export class Imap {
  private sock!: TLSSocket;
  private buf = Buffer.alloc(0);
  private esperando: ((u: Unidade) => void) | null = null;
  private fila: Unidade[] = [];
  private erro: Error | null = null;
  private n = 0;

  // `rede` só existe para os testes (servidor falso em 127.0.0.1 com certificado próprio).
  static async abrir({
    host,
    porta = 993,
    timeout = 30000,
    rede,
  }: {
    host: string;
    porta?: number;
    timeout?: number;
    rede?: Rede;
  }): Promise<Imap> {
    const c = new Imap();
    await new Promise<void>((ok, falha) => {
      c.sock = connect(
        {
          host,
          port: porta,
          servername: host,
          minVersion: 'TLSv1.2',
          timeout,
          ...(rede?.permitirInterno ? {} : { lookup: lookupSeguro as never }),
          ...(rede?.ca ? { ca: rede.ca } : {}),
        },
        ok,
      );
      c.sock.once('error', falha);
    });
    c.sock.on('data', (d: Buffer) => {
      c.buf = Buffer.concat([c.buf, d]);
      c.cortar();
    });
    c.sock.on('error', (e) => c.falhar(e));
    c.sock.on('timeout', () => c.falhar(new Error('o servidor IMAP parou de responder')));
    c.sock.on('close', () => c.falhar(new Error('conexão IMAP fechada')));
    const saudacao = await c.proxima();
    if (!/^\* (OK|PREAUTH)/i.test(saudacao.texto)) throw new Error('servidor IMAP recusou a conexão');
    return c;
  }

  private falhar(e: Error) {
    if (this.erro) return;
    this.erro = e;
    const w = this.esperando;
    this.esperando = null;
    w?.({ texto: '', literais: [] });
  }

  // Junta linha + literais {n} numa unidade só.
  private parcial: Unidade = { texto: '', literais: [] };
  private faltaLiteral = -1;
  private cortar() {
    for (;;) {
      if (this.faltaLiteral >= 0) {
        if (this.buf.length < this.faltaLiteral) return;
        this.parcial.texto += MARCA + this.parcial.literais.length + MARCA;
        this.parcial.literais.push(this.buf.subarray(0, this.faltaLiteral));
        this.buf = this.buf.subarray(this.faltaLiteral);
        this.faltaLiteral = -1;
        continue;
      }
      const fim = this.buf.indexOf('\r\n');
      if (fim < 0) return;
      const linha = this.buf.subarray(0, fim).toString('latin1');
      this.buf = this.buf.subarray(fim + 2);
      const lit = linha.match(/\{(\d+)\+?\}$/);
      if (lit) {
        this.parcial.texto += linha.slice(0, lit.index);
        this.faltaLiteral = Number(lit[1]);
        if (this.faltaLiteral > 50e6) return this.falhar(new Error('resposta IMAP grande demais'));
        continue;
      }
      this.parcial.texto += linha;
      const u = this.parcial;
      this.parcial = { texto: '', literais: [] };
      if (this.esperando) {
        const w = this.esperando;
        this.esperando = null;
        w(u);
      } else this.fila.push(u);
    }
  }

  private async proxima(): Promise<Unidade> {
    if (this.fila.length) return this.fila.shift()!;
    if (this.erro) throw this.erro;
    const u = await new Promise<Unidade>((ok) => {
      this.esperando = ok;
    });
    if (this.erro) throw this.erro;
    return u;
  }

  // Manda um comando e devolve as respostas "*" até a linha marcada.
  // continuar: o que mandar quando o servidor pedir "+".
  async comando(cmd: string, continuar?: () => string): Promise<Unidade[]> {
    const tag = `C${++this.n}`;
    this.sock.write(`${tag} ${cmd}\r\n`);
    const respostas: Unidade[] = [];
    for (;;) {
      const u = await this.proxima();
      if (u.texto.startsWith('+')) {
        if (!continuar) throw new Error('o servidor pediu continuação inesperada');
        this.sock.write(continuar() + '\r\n');
        continue;
      }
      if (u.texto.startsWith(tag + ' ')) {
        const resto = u.texto.slice(tag.length + 1);
        if (!/^OK/i.test(resto))
          throw new Error(resto.replace(/^(NO|BAD)\s*/i, '').slice(0, 200) || 'comando recusado');
        return respostas;
      }
      respostas.push(u);
    }
  }

  async entrar(usuario: string, senha: string): Promise<void> {
    // AUTHENTICATE PLAIN aceita qualquer caractere na senha (vai em base64).
    const plain = Buffer.from(`\0${usuario}\0${senha}`, 'utf8').toString('base64');
    await this.comando('AUTHENTICATE PLAIN', () => plain);
  }

  async examinar(pasta: string): Promise<{ uidvalidity: number; existe: number }> {
    const r = await this.comando(`EXAMINE ${aspas(nomeDaPasta(pasta))}`);
    let uidvalidity = 0,
      existe = 0;
    for (const u of r) {
      const v = u.texto.match(/\[UIDVALIDITY (\d+)\]/i);
      if (v) uidvalidity = Number(v[1]);
      const e = u.texto.match(/^\* (\d+) EXISTS/i);
      if (e) existe = Number(e[1]);
    }
    return { uidvalidity, existe };
  }

  async buscar(criterio: string): Promise<number[]> {
    const r = await this.comando(`UID SEARCH ${criterio}`);
    return r.flatMap((u) =>
      (u.texto.match(/^\* SEARCH(.*)$/i)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).map(Number),
    );
  }

  // Devolve, por UID, os pares do FETCH (ex.: { UID: '12', 'BODY[TEXT]<0>': Buffer }).
  async trazer(uids: number[], itens: string): Promise<Array<Record<string, Valor>>> {
    if (!uids.length) return [];
    const r = await this.comando(`UID FETCH ${uids.join(',')} (${itens})`);
    const out: Array<Record<string, Valor>> = [];
    for (const u of r) {
      if (!/^\* \d+ FETCH /i.test(u.texto)) continue;
      const v = analisar(u);
      const pares = v[3] as Valor[];
      if (!Array.isArray(pares)) continue;
      const obj: Record<string, Valor> = {};
      for (let i = 0; i + 1 < pares.length; i += 2) obj[String(pares[i]).toUpperCase()] = pares[i + 1];
      out.push(obj);
    }
    return out;
  }

  async sair(): Promise<void> {
    try {
      await Promise.race([this.comando('LOGOUT'), new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      /* já fechou */
    }
    this.sock.destroy();
  }
}
