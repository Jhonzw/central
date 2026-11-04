// Ambiente descartável: nenhuma conta, conexão ou chave de produção é usada.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { abrir, agora } from '../src/db.ts';
import { criarCofre } from '../src/cofre.ts';
import { hashSenha, entrar } from '../src/acesso.ts';
import { novoSegredo, codigo } from '../src/totp.ts';
import * as espacos from '../src/espacos.ts';
import * as contas from '../src/contas.ts';
import * as pessoas from '../src/pessoas.ts';
import * as caixa from '../src/caixa.ts';
import { criarGateway, hashSegredo } from '../src/operacao-local.ts';
import { createServer } from 'node:http';

const pasta = mkdtempSync(join(tmpdir(), 'central-e2e-'));
const chave = randomBytes(32);
const cofre = criarCofre(chave);
const db = abrir(join(pasta, 'banco.sqlite3'));
espacos.semear(db, [
  { id: 'loja', nome: 'Loja exemplo', cor: '#5eead4' },
  { id: 'pessoal', nome: 'Pessoal', cor: '#a78bfa' },
]);
contas.salvar(db, cofre, { id: 'wa', tipo: 'whatsapp', nome: 'WhatsApp fictício', espaco_id: 'loja' });
contas.salvar(db, cofre, {
  id: 'email',
  tipo: 'email',
  nome: 'E-mail fictício',
  espaco_id: 'loja',
  host: 'imap.example.com',
  usuario: 'eu@example.com',
  senha: 'ficticia-sem-conexao',
});
pessoas.salvar(db, {
  nome: 'Cliente exemplo',
  espacos: ['loja'],
  canais: [
    { tipo: 'email', valor: 'cliente@example.com' },
    { tipo: 'whatsapp', valor: '5511999990000' },
  ],
});
caixa.receber(db, {
  conta: 'wa',
  chave: '5511999990000@s.whatsapp.net',
  endereco: '5511999990000',
  titulo: 'Cliente exemplo',
  autor: 'Cliente exemplo',
  externo: 'wa-1',
  de_mim: false,
  texto: 'Pode ajustar o checkout da loja?',
  em: agora(),
});
caixa.receber(db, {
  conta: 'email',
  chave: '<email-1@example.com>',
  endereco: 'cliente@example.com',
  titulo: 'Detalhe por e-mail',
  autor: 'Cliente exemplo',
  externo: '<email-1@example.com>',
  de_mim: false,
  assunto: 'Detalhe por e-mail',
  texto: 'O campo de endereço deve ser opcional. <script>alert(1)</script>',
  em: new Date(Date.now() - 60000).toISOString(),
});
const segredo = novoSegredo();
db.prepare('INSERT INTO dono (id,senha,totp,ultimo_passo,criado,atualizado) VALUES (1,?,?,0,?,?)').run(
  await hashSenha('senha apenas de teste'),
  cofre.cifrar(segredo, 'dono:totp'),
  agora(),
  agora(),
);
const token = await entrar(db, cofre, {
  senha: 'senha apenas de teste',
  codigo: codigo(segredo),
  ip: '127.0.0.1',
  agente: 'E2E',
});
db.close();
writeFileSync(join(pasta, 'chave'), chave.toString('base64'), { mode: 0o600 });
writeFileSync(join(pasta, 'config.json'), JSON.stringify({ espacos: [], conectores: [] }));
mkdirSync('.e2e', { recursive: true });
writeFileSync(
  '.e2e/session.json',
  JSON.stringify({
    cookies: [
      {
        name: '__Host-central',
        value: token,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ],
    origins: [],
  }),
  { mode: 0o600 },
);
const proc = spawn(process.execPath, ['src/server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CENTRAL_PORTA: '17880',
    CENTRAL_CONFIG: join(pasta, 'config.json'),
    CENTRAL_BANCO: join(pasta, 'banco.sqlite3'),
    CENTRAL_CHAVE_ARQ: join(pasta, 'chave'),
    CENTRAL_BACKUPS: join(pasta, 'backup'),
    CENTRAL_EMAIL_MINUTOS: '0',
  },
});
const fonte = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ linhas: [{ id: 42, titulo: 'Chamado fictício local', situacao: 'Pendente' }] }));
});
await new Promise<void>((ok) => fonte.listen(17882, '127.0.0.1', ok));
process.env.CENTRAL_E2E_FONTE = randomBytes(32).toString('hex');
const gateway = criarGateway({
  habilitado: true,
  central: 'http://127.0.0.1:17880',
  segredoHash: hashSegredo('segredo local somente teste'),
  bancoLocal: join(pasta, 'local.sqlite3'),
  espacosLocais: [{ id: 'trabalho', nome: 'Trabalho exemplo', cor: '#60a5fa' }],
  fontes: [
    {
      id: 'ops',
      nome: 'Operação fictícia',
      url: 'http://127.0.0.1:17882',
      tokenEnv: 'CENTRAL_E2E_FONTE',
      categorias: ['chamados'],
    },
  ],
});
await new Promise<void>((ok) => gateway.listen(17881, '127.0.0.1', ok));
for (const sinal of ['SIGTERM', 'SIGINT'] as const)
  process.on(sinal, () => {
    gateway.closeAllConnections();
    gateway.close();
    fonte.closeAllConnections();
    fonte.close();
    proc.kill(sinal);
  });
proc.on('exit', (code) => {
  rmSync(pasta, { recursive: true, force: true });
  process.exit(code || 0);
});
