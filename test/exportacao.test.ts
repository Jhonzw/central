import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('exportação organiza projeto e tarefa avulsa, escapa Markdown e preserva só metadados permitidos', async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'central-export-'));
  const caminhos: string[] = [];
  const servidor = createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer cen_ficticio');
    const u = new URL(req.url!, 'http://localhost');
    caminhos.push(u.pathname);
    if (u.pathname !== '/api/espacos') assert.equal(u.searchParams.get('espaco'), 'equipe');
    if (u.pathname === '/api/projetos') assert.equal(u.searchParams.get('todos'), '1');
    const dados: Record<string, unknown> = {
      '/api/espacos': [{ id: 'equipe', nome: 'Equipe / Exemplo' }],
      '/api/projetos': [
        {
          id: 7,
          espaco_id: 'equipe',
          nome: 'Entrega [[secreto]]',
          status: 'ativo',
          prazo: '2026-12-20',
          proxima_acao: 'Revisar **agora**',
          notas: 'NOTA_PROJETO_PRIVADA',
        },
      ],
      '/api/tarefas': [
        {
          id: 1,
          projeto_id: 7,
          titulo: 'Ver ![arquivo](file:///etc/passwd)',
          status: 'a-fazer',
          prazo: '2026-12-10',
          proxima: '2026-11-08',
          descricao: 'CORPO_PRIVADO',
          origens: [{ texto: 'MENSAGEM_PRIVADA' }],
        },
        {
          id: 2,
          projeto_id: null,
          titulo: 'Tarefa avulsa',
          status: 'aguardando',
          prazo: null,
          proxima: null,
        },
      ],
      '/api/conversas': [
        {
          id: 4,
          titulo: 'Assunto permitido',
          pessoa_nome: 'Ana',
          canal: 'email',
          ultima_em: '2026-11-02',
          notas: 'NOTA_CONVERSA_PRIVADA',
          mensagens: [{ texto: 'MENSAGEM_PRIVADA' }],
          endereco: 'contato-privado@example.com',
        },
      ],
      '/api/pessoas': [
        {
          nome: 'Ana',
          espacos: [{ id: 'equipe', papel: 'Parceira' }],
          canais: [{ endereco: 'contato-privado@example.com' }],
          telefone: '+5599999999999',
        },
      ],
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(dados[u.pathname] ?? {}));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  t.after(() => {
    servidor.close();
    rmSync(pasta, { recursive: true, force: true });
  });
  const porta = (servidor.address() as { port: number }).port;
  const filho = spawn(process.execPath, ['ferramentas/exportar-obsidian.ts', pasta], {
    env: { ...process.env, CENTRAL_URL: `http://127.0.0.1:${porta}`, CENTRAL_TOKEN: 'cen_ficticio' },
  });
  let erro = '';
  filho.stderr.on('data', (b) => {
    erro += b;
  });
  const codigo = await new Promise<number | null>((ok) => filho.on('close', ok));
  assert.equal(codigo, 0, erro);
  assert.equal(readdirSync(pasta).length, 1);
  const texto = readFileSync(join(pasta, readdirSync(pasta)[0]), 'utf8');
  assert.ok(caminhos.includes('/api/projetos'));
  assert.match(texto, /Entrega \\\[\\\[secreto\\\]\\\]/);
  assert.ok(texto.indexOf('Entrega') < texto.indexOf('Ver '));
  assert.ok(texto.indexOf('Tarefas sem projeto') < texto.indexOf('Tarefa avulsa'));
  assert.match(texto, /planejado: 08\/11/);
  assert.match(texto, /prazo: 10\/12/);
  assert.match(texto, /prazo: 20\/12/);
  assert.ok(texto.includes('Revisar \\*\\*agora\\*\\*'));
  assert.equal(texto.split('Tarefa avulsa').length - 1, 1);
  assert.equal(texto.includes('!['), false);
  assert.equal(texto.includes('[[secreto]]'), false);
  for (const proibido of [
    'CORPO_PRIVADO',
    'MENSAGEM_PRIVADA',
    'NOTA_CONVERSA_PRIVADA',
    'NOTA_PROJETO_PRIVADA',
    'contato-privado@example.com',
    '+5599999999999',
  ])
    assert.equal(texto.includes(proibido), false, proibido);
  assert.equal(
    caminhos.some((c) => c.includes('/operacao') || c.includes('/local')),
    false,
  );
});
