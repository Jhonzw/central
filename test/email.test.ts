// MIME e IMAP. O IMAP roda contra um servidor falso com TLS de verdade
// (certificado gerado na hora), que também confere que o cliente só leu.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cabecalhos, enderecos, palavras, trecho, semPrefixo, chaveDaConversa, limparTexto } from '../src/email/mime.ts';
import { analisar, enderecoInterno, aspas, Imap } from '../src/email/imap.ts';
import { lerConta } from '../src/email/coletor.ts';
import { abrir } from '../src/db.ts';
import { criarCofre } from '../src/cofre.ts';
import * as espacos from '../src/espacos.ts';
import * as contas from '../src/contas.ts';
import * as caixa from '../src/caixa.ts';

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

test('palavras codificadas (B e Q, vizinhas juntas)', () => {
  assert.equal(palavras('=?UTF-8?Q?Or=C3=A7amento_de_ma?= =?UTF-8?B?csOnbw==?='), 'Orçamento de março');
  assert.equal(palavras('=?iso-8859-1?Q?Jo=E3o?= <j@x.com>'), 'João <j@x.com>');
});

test('endereços com nome, aspas e vírgula', () => {
  assert.deepEqual(enderecos('"Souza, Ana" <Ana@X.com>, bruno@y.com.br'), [{ nome: 'Souza, Ana', endereco: 'ana@x.com' }, { nome: '', endereco: 'bruno@y.com.br' }]);
});

test('texto de multipart: prefere text/plain, ignora anexo, tira a citação', () => {
  const corpo = Buffer.from(crlf(`--B1
Content-Type: text/html; charset=utf-8

<p>vers&atilde;o html</p>
--B1
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Ol=C3=A1, segue o or=
=C3=A7amento.

Em seg., 2 de nov. de 2026 =C3=A0s 10:00, Fulano escreveu:
> texto antigo
--B1
Content-Type: application/pdf
Content-Disposition: attachment; filename="a.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--B1--
`), 'latin1');
  assert.equal(trecho({ 'content-type': 'multipart/alternative; boundary="B1"' }, corpo), 'Olá, segue o orçamento.');
});

test('html vira texto, base64 decodifica', () => {
  const corpo = Buffer.from(Buffer.from('<style>x{}</style><p>Pedido&nbsp;n&ordm; 12 &amp; <b>pronto</b></p>').toString('base64'));
  assert.match(trecho({ 'content-type': 'text/html', 'content-transfer-encoding': 'base64' }, corpo), /Pedido n&ordm; 12 & pronto/);
});

test('assunto sem Re/Fwd e chave da conversa pela 1ª referência', () => {
  assert.equal(semPrefixo('RE: Fwd: Res: Proposta'), 'Proposta');
  assert.equal(chaveDaConversa({ references: '<a@x> <b@x>', 'in-reply-to': '<b@x>', 'message-id': '<c@x>' }), '<a@x>');
  assert.equal(chaveDaConversa({ 'message-id': '<c@x>' }), '<c@x>');
  assert.equal(limparTexto('a\n\n\n\nb'), 'a\n\nb');
});

test('analisar entende literal, lista e átomo com colchete', () => {
  const v = analisar({ texto: '* 1 FETCH (UID 7 BODY[HEADER.FIELDS (FROM SUBJECT)] \u00000\u0000 FLAGS (\\Seen) X NIL)', literais: [Buffer.from('From: a')] });
  const pares = v[3] as unknown[];
  assert.equal(pares[0], 'UID');
  assert.equal(pares[2], 'BODY[HEADER.FIELDS (FROM SUBJECT)]');
  assert.deepEqual(pares[3], Buffer.from('From: a'));
  assert.deepEqual(pares[5], ['\\Seen']);
  assert.equal(pares[7], null);
});

test('endereço interno é recusado; aspas escapam', () => {
  for (const ip of ['127.0.0.1', '10.20.30.40', '172.17.0.1', '192.168.0.10', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', '100.64.0.1']) assert.ok(enderecoInterno(ip), ip);
  for (const ip of ['142.250.0.109', '1.1.1.1', '2a00:1450::1']) assert.equal(enderecoInterno(ip), false, ip);
  assert.equal(aspas('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => aspas('a\r\nb'));
});

test('cabeçalho dobrado em várias linhas', () => {
  const c = cabecalhos(Buffer.from('Subject: uma\r\n linha longa\r\nFrom: a@b.com\r\n'));
  assert.equal(c.subject, 'uma linha longa');
});

// ---------- IMAP de mentira ----------
let pasta: string, servidor: Server, porta: number, ca: string;
const vistos: string[] = [];
const MSGS = [
  { uid: 11, cab: 'From: "Ana Souza" <ana@x.com>\r\nTo: eu@x.com\r\nSubject: =?UTF-8?Q?Or=C3=A7amento?=\r\nDate: Mon, 02 Nov 2026 10:00:00 -0300\r\nMessage-ID: <m1@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n', corpo: 'Pode mandar o orçamento?\r\n' },
  { uid: 12, cab: 'From: Loja <loja@y.com>\r\nTo: eu@x.com\r\nSubject: Pedido 55\r\nDate: Mon, 02 Nov 2026 11:00:00 -0300\r\nMessage-ID: <m2@y>\r\n\r\n', corpo: 'Seu pedido saiu.\r\n' },
  { uid: 13, cab: 'From: Eu <eu@x.com>\r\nTo: Ana <ana@x.com>\r\nSubject: Re: =?UTF-8?Q?Or=C3=A7amento?=\r\nDate: Mon, 02 Nov 2026 12:00:00 -0300\r\nMessage-ID: <m3@x>\r\nIn-Reply-To: <m1@x>\r\nReferences: <m1@x>\r\n\r\n', corpo: 'Segue.\r\n' },
];

before(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'central-imap-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(pasta, 'k.pem'), '-out', join(pasta, 'c.pem'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  ca = readFileSync(join(pasta, 'c.pem'), 'utf8');
  servidor = createServer({ key: readFileSync(join(pasta, 'k.pem')), cert: ca }, (s) => {
    s.write('* OK IMAP falso pronto\r\n');
    let buf = '';
    let autenticando: string | null = null;
    s.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const linha = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (autenticando) {
          const [, u, p] = Buffer.from(linha, 'base64').toString().split('\0');
          s.write(u === 'eu@x.com' && p === 'senha çerta' ? `${autenticando} OK logado\r\n` : `${autenticando} NO [AUTHENTICATIONFAILED] errado\r\n`);
          autenticando = null;
          continue;
        }
        const [tag, ...resto] = linha.split(' ');
        const cmd = resto.join(' ');
        vistos.push(cmd.split(' ').slice(0, 2).join(' ').toUpperCase());
        if (/^AUTHENTICATE PLAIN$/i.test(cmd)) { autenticando = tag; s.write('+ \r\n'); }
        else if (/^EXAMINE/i.test(cmd)) s.write(`* 3 EXISTS\r\n* OK [UIDVALIDITY 77] ok\r\n${tag} OK [READ-ONLY] pronto\r\n`);
        else if (/^UID SEARCH/i.test(cmd)) {
          const m = cmd.match(/UID (\d+):\*/);
          const uids = MSGS.map((x) => x.uid).filter((u) => !m || u >= Number(m[1]));
          s.write(`* SEARCH ${(uids.length ? uids : [13]).join(' ')}\r\n${tag} OK\r\n`);
        } else if (/^UID FETCH/i.test(cmd)) {
          const pedidos = cmd.split(' ')[2].split(',').map(Number);
          MSGS.filter((x) => pedidos.includes(x.uid)).forEach((x, n) => {
            const cab = Buffer.from(x.cab, 'utf8'), corpo = Buffer.from(x.corpo, 'utf8');
            s.write(`* ${n + 1} FETCH (UID ${x.uid} INTERNALDATE "02-Nov-2026 10:00:00 -0300" BODY[HEADER.FIELDS (FROM TO)] {${cab.length}}\r\n`);
            s.write(cab);
            s.write(` BODY[TEXT]<0> {${corpo.length}}\r\n`);
            s.write(corpo);
            s.write(')\r\n');
          });
          s.write(`${tag} OK\r\n`);
        } else if (/^LOGOUT/i.test(cmd)) { s.write(`* BYE\r\n${tag} OK\r\n`); s.end(); }
        else s.write(`${tag} BAD não sei\r\n`);
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  porta = (servidor.address() as { port: number }).port;
});
after(() => { servidor.close(); rmSync(pasta, { recursive: true, force: true }); });

test('cliente recusa servidor sem certificado confiável', async () => {
  await assert.rejects(Imap.abrir({ host: 'localhost', porta, rede: { permitirInterno: true } }), /self-signed|certificate/i);
});

test('cliente recusa ir para endereço interno', async () => {
  await assert.rejects(Imap.abrir({ host: 'localhost', porta, rede: { ca } }), /interno/);
});

test('lê a caixa só com EXAMINE e PEEK, monta as conversas e continua de onde parou', async () => {
  const db = abrir(':memory:');
  const cofre = criarCofre(randomBytes(32));
  espacos.semear(db, [{ id: 'pessoal', nome: 'Pessoal' }]);
  contas.salvar(db, cofre, { id: 'teste', tipo: 'email', nome: 'Teste', espaco_id: 'pessoal', host: 'imap.example.com', usuario: 'eu@x.com', senha: 'senha çerta' });
  // O servidor falso está em localhost numa porta qualquer.
  db.prepare('UPDATE contas SET config = ? WHERE id = ?').run(JSON.stringify({ host: 'localhost', porta, usuario: 'eu@x.com', pasta: 'INBOX' }), 'teste');
  const r = await lerConta(db, cofre, 'teste', { rede: { ca, permitirInterno: true } });
  assert.equal(r.novas, 3);
  assert.ok(vistos.includes('EXAMINE "INBOX"'));
  assert.ok(!vistos.some((c) => /^(SELECT|STORE|UID STORE|COPY|EXPUNGE|APPEND)/.test(c)), vistos.join(','));
  const cs = caixa.listar(db);
  assert.equal(cs.length, 2);
  const orc = caixa.obter(db, (cs.find((c) => c.titulo === 'Orçamento') as { id: number }).id) as unknown as { estado: string; endereco: string; mensagens: Array<{ de_mim: number; texto: string }> };
  assert.equal(orc.mensagens.length, 2);
  assert.equal(orc.estado, 'esperando');
  assert.equal(orc.endereco, 'ana@x.com');
  assert.equal(orc.mensagens[0].texto, 'Pode mandar o orçamento?');
  assert.deepEqual(contas.obter(db, 'teste').estado, { uidvalidity: 77, ultimo_uid: 13 });
  // Segunda leitura: o servidor devolve o último de novo, mas nada é duplicado.
  assert.equal((await lerConta(db, cofre, 'teste', { rede: { ca, permitirInterno: true } })).novas, 0);
});

test('senha errada vira erro da conta, sem a senha no texto', async () => {
  const db = abrir(':memory:');
  const cofre = criarCofre(randomBytes(32));
  espacos.semear(db, [{ id: 'pessoal', nome: 'Pessoal' }]);
  contas.salvar(db, cofre, { id: 'teste', tipo: 'email', nome: 'Teste', espaco_id: 'pessoal', host: 'imap.example.com', usuario: 'eu@x.com', senha: 'errada123' });
  db.prepare('UPDATE contas SET config = ? WHERE id = ?').run(JSON.stringify({ host: 'localhost', porta, usuario: 'eu@x.com', pasta: 'INBOX' }), 'teste');
  await assert.rejects(lerConta(db, cofre, 'teste', { rede: { ca, permitirInterno: true } }), /AUTHENTICATIONFAILED/);
  const erro = contas.obter(db, 'teste').erro!;
  assert.match(erro, /AUTHENTICATIONFAILED/);
  assert.equal(erro.includes('errada123'), false);
});
