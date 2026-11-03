// QR code sem dependência, só para o cadastro do autenticador (otpauth://).
// Modo byte, correção M, versões 1 a 10, máscara escolhida pela penalidade da
// norma (ISO/IEC 18004). Baseado no algoritmo de referência de Project Nayuki.

const ECC_M_POR_BLOCO = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const tamanho = (v: number) => v * 4 + 17;

function modulosDeDados(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}
const bytesDeDados = (v: number) => Math.floor(modulosDeDados(v) / 8) - ECC_M_POR_BLOCO[v] * BLOCOS_M[v];

// Reed-Solomon em GF(256), polinômio 0x11D.
function mult(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(grau: number): number[] {
  const r = new Array(grau - 1).fill(0).concat([1]);
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mult(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mult(raiz, 0x02);
  }
  return r;
}
function resto(dados: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of dados) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= mult(c, f); });
  }
  return r;
}

function posicoesDeAlinhamento(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const passo = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let p = tamanho(v) - 7; r.length < n; p -= passo) r.splice(1, 0, p);
  return r;
}

export type Qr = { lado: number; escuro: (x: number, y: number) => boolean };

export function gerarQr(texto: string): Qr {
  const dados = [...new TextEncoder().encode(texto)];
  let v = 1;
  for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + dados.length * 8 <= bytesDeDados(v) * 8) break;
  if (v > 10) throw new Error('texto grande demais para o QR');

  // Bits: modo byte (0100), tamanho, dados, terminador, preenchimento.
  const bits: number[] = [];
  const por = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  por(4, 4);
  por(dados.length, v < 10 ? 8 : 16);
  for (const b of dados) por(b, 8);
  const cap = bytesDeDados(v) * 8;
  por(0, Math.min(4, cap - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) por(p, 8);
  const palavras: number[] = [];
  for (let i = 0; i < bits.length; i += 8) palavras.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Blocos com correção, intercalados.
  const nBlocos = BLOCOS_M[v], eccLen = ECC_M_POR_BLOCO[v];
  const total = Math.floor(modulosDeDados(v) / 8);
  const curtos = nBlocos - (total % nBlocos), lenCurto = Math.floor(total / nBlocos);
  const div = divisor(eccLen);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const d = palavras.slice(k, k + lenCurto - eccLen + (i < curtos ? 0 : 1));
    k += d.length;
    const ecc = resto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(ecc));
  }
  const final: number[] = [];
  for (let i = 0; i < blocos[0].length; i++)
    blocos.forEach((b, j) => { if (i !== lenCurto - eccLen || j >= curtos) final.push(b[i]); });

  const n = tamanho(v);
  const mod = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixo = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const pinta = (x: number, y: number, e: boolean) => { mod[y][x] = e; fixo[y][x] = true; };

  for (let i = 0; i < n; i++) { pinta(6, i, i % 2 === 0); pinta(i, 6, i % 2 === 0); }
  const localizador = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < n && yy >= 0 && yy < n) pinta(xx, yy, d !== 2 && d !== 4);
    }
  };
  localizador(3, 3); localizador(n - 4, 3); localizador(3, n - 4);
  const al = posicoesDeAlinhamento(v);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) pinta(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const formato = (mascara: number) => {
    const d = (0 << 3) | mascara; // correção M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) pinta(8, i, bit(i));
    pinta(8, 7, bit(6)); pinta(8, 8, bit(7)); pinta(7, 8, bit(8));
    for (let i = 9; i < 15; i++) pinta(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) pinta(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) pinta(8, n - 15 + i, bit(i));
    pinta(8, n - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const e = ((b >>> i) & 1) !== 0, a = n - 11 + (i % 3), c = Math.floor(i / 3);
      pinta(a, c, e); pinta(c, a, e);
    }
  }

  // Dados em zigue-zague, de baixo para cima, de duas em duas colunas.
  let i = 0;
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, subindo = ((dir + 1) & 2) === 0, y = subindo ? n - 1 - vert : vert;
      if (!fixo[y][x] && i < final.length * 8) { mod[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }

  const mascaras: Array<(x: number, y: number) => boolean> = [
    (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const aplicar = (m: number) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixo[y][x] && mascaras[m](x, y)) mod[y][x] = !mod[y][x]; };

  let melhor = 0, menor = Infinity;
  for (let m = 0; m < 8; m++) {
    aplicar(m); formato(m);
    const p = penalidade(mod);
    if (p < menor) { menor = p; melhor = m; }
    aplicar(m);
  }
  aplicar(melhor); formato(melhor);
  return { lado: n, escuro: (x, y) => mod[y][x] };
}

function penalidade(m: boolean[][]): number {
  const n = m.length;
  let p = 0, escuros = 0;
  // Sequências de 5 ou mais da mesma cor, nas linhas e nas colunas.
  const linha = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let cor = get(a, 0), run = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === cor) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { cor = get(a, b); run = 1; }
      }
    }
  };
  linha((a, b) => m[a][b]);
  linha((a, b) => m[b][a]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) escuros++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  // Padrões de localizador dentro dos dados.
  for (let y = 0; y < n; y++) for (let x = 0; x + 10 < n; x++) {
    const h = (k: number) => m[y][x + k], vv = (k: number) => m[x + k][y];
    for (const g of [h, vv]) {
      const s = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => (g(k) ? 1 : 0)).join('');
      if (s === '10111010000' || s === '00001011101') p += 40;
    }
  }
  const total = n * n;
  p += Math.floor(Math.abs(escuros * 20 - total * 10) / total) * 10;
  return p;
}

// SVG pronto para pôr na página (escapado por construção: só números).
export function qrSvg(texto: string, margem = 4): string {
  const q = gerarQr(texto);
  const t = q.lado + margem * 2;
  let d = '';
  for (let y = 0; y < q.lado; y++) for (let x = 0; x < q.lado; x++) if (q.escuro(x, y)) d += `M${x + margem},${y + margem}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR code do autenticador"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
