// O mínimo de MIME para a caixa: cabeçalhos (com =?utf-8?...?=), endereços e
// um trecho do texto da mensagem. HTML vira texto puro; anexo é ignorado.

export type Cabecalhos = Record<string, string>;

const utf8Estrito = new TextDecoder('utf-8', { fatal: true });

function decodificar(bytes: Uint8Array, charset = 'utf-8'): string {
  const cs = charset.toLowerCase().replace(/^"|"$/g, '');
  if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii') {
    try { return utf8Estrito.decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
  }
  try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

// Cabeçalho cru costuma vir em UTF-8 mesmo sem codificar; se não for, Latin-1.
const textoCru = (b: Buffer): string => decodificar(b, 'utf-8');

export function palavras(s: string): string {
  // Palavras codificadas vizinhas se juntam sem o espaço entre elas (RFC 2047).
  return s.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_t, cs: string, enc: string, dado: string) => {
    const bytes = enc.toUpperCase() === 'B'
      ? Buffer.from(dado, 'base64')
      : Buffer.from(dado.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return decodificar(bytes, cs.split('*')[0]);
  });
}

export function cabecalhos(b: Buffer): Cabecalhos {
  const out: Cabecalhos = {};
  const linhas = textoCru(b).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const l of linhas) {
    const m = l.match(/^([!-9;-~]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export type Endereco = { nome: string; endereco: string };

export function enderecos(v: string | undefined): Endereco[] {
  if (!v) return [];
  const partes: string[] = [];
  let atual = '', aspas = false, angulo = false;
  for (const c of v) {
    if (c === '"') aspas = !aspas;
    if (!aspas && c === '<') angulo = true;
    if (!aspas && c === '>') angulo = false;
    if (c === ',' && !aspas && !angulo) { partes.push(atual); atual = ''; } else atual += c;
  }
  partes.push(atual);
  return partes.map((p) => {
    const m = p.match(/<([^>]+)>/);
    const endereco = (m ? m[1] : p).trim().toLowerCase();
    const nome = palavras(m ? p.slice(0, m.index).trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1') : '').trim();
    return { nome, endereco };
  }).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e.endereco));
}

function parametros(v: string | undefined): { tipo: string; p: Record<string, string> } {
  const [tipo, ...resto] = (v || 'text/plain').split(';');
  const p: Record<string, string> = {};
  for (const r of resto) {
    const m = r.match(/^\s*([\w*-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) p[m[1].toLowerCase().replace(/\*$/, '')] = m[2];
  }
  return { tipo: tipo.trim().toLowerCase(), p };
}

function semTransferencia(b: Buffer, cte: string | undefined): Buffer {
  const t = (cte || '').toLowerCase().trim();
  if (t === 'base64') {
    const s = b.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '');
    return Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64');
  }
  if (t === 'quoted-printable') {
    const s = b.toString('latin1').replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(s, 'latin1');
  }
  return b;
}

const ENTIDADES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function htmlParaTexto(h: string): string {
  return h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (t, e: string) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
      return ENTIDADES[e.toLowerCase()] ?? t;
    });
}

// Procura a parte de texto: text/plain antes de text/html; anexo fica de fora.
function partes(cab: Cabecalhos, corpo: Buffer, fundo = 0): { tipo: string; texto: string } | null {
  const { tipo, p } = parametros(cab['content-type']);
  if (/^attachment/i.test(cab['content-disposition'] || '')) return null;
  if (tipo.startsWith('multipart/') && p.boundary && fundo < 5) {
    const sep = '--' + p.boundary;
    const blocos = corpo.toString('latin1').split(sep).slice(1).filter((x) => !x.startsWith('--'));
    let html: { tipo: string; texto: string } | null = null;
    for (const bloco of blocos) {
      const b = Buffer.from(bloco.replace(/^\r?\n/, ''), 'latin1');
      const fim = b.indexOf('\r\n\r\n') >= 0 ? b.indexOf('\r\n\r\n') : b.indexOf('\n\n');
      if (fim < 0) continue;
      const achou = partes(cabecalhos(b.subarray(0, fim)), b.subarray(fim + (b[fim] === 13 ? 4 : 2)), fundo + 1);
      if (achou?.tipo === 'text/plain') return achou;
      if (achou && !html) html = achou;
    }
    return html;
  }
  if (tipo !== 'text/plain' && tipo !== 'text/html') return null;
  const t = decodificar(semTransferencia(corpo, cab['content-transfer-encoding']), p.charset || 'utf-8');
  return { tipo, texto: tipo === 'text/html' ? htmlParaTexto(t) : t };
}

// Tira a citação da resposta anterior e as linhas em branco repetidas.
export function limparTexto(t: string, max = 2000): string {
  const linhas: string[] = [];
  for (const l of t.replace(/\r/g, '').split('\n')) {
    if (/^\s*>/.test(l)) continue;
    if (/^(Em .{4,120}escreveu:|On .{4,120}wrote:|-{2,}\s*(Original Message|Mensagem original)\s*-{2,})\s*$/i.test(l.trim())) break;
    linhas.push(l.replace(/[ \t ]+/g, ' ').trimEnd());
  }
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export function trecho(cab: Cabecalhos, corpo: Buffer): string {
  const p = partes(cab, corpo);
  return p ? limparTexto(p.texto) : '';
}

export function semPrefixo(assunto: string): string {
  return assunto.replace(/^\s*((re|res|fw|fwd|enc|encaminhada?)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
}

// A conversa é a troca inteira: a 1ª Message-ID das referências, senão a
// que esta mensagem responde, senão a dela mesma.
export function chaveDaConversa(cab: Cabecalhos): string | null {
  const ids = (v: string | undefined) => (v || '').match(/<[^<>\s]+>/g) || [];
  return ids(cab.references)[0] || ids(cab['in-reply-to'])[0] || ids(cab['message-id'])[0] || null;
}
