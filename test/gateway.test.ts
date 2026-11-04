import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { scryptSync, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function carregar() {
  return import('../src/operacao-local.ts');
}
async function fixture(t: any, modo = 'normal', bancoLocal = ':memory:') {
  const eventos: { destino: string; url: string; headers: any; corpo: string }[] = [];
  const subir = async (destino: string) => {
    const s = createServer(async (req, res) => {
      let corpo = '';
      for await (const p of req) corpo += p;
      eventos.push({ destino, url: req.url!, headers: req.headers, corpo });
      if (destino === 'ops' && modo === 'redirect') {
        res.writeHead(302, { Location: remoto });
        res.end();
        return;
      }
      if (destino === 'ops' && modo === 'lento') {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (destino === 'ops' && modo === 'erro') {
        res.writeHead(500);
        res.end('SEGREDO-CORPORATIVO');
        return;
      }
      if (destino === 'ops' && modo === 'grande') {
        res.end(JSON.stringify('X'.repeat(2048)));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/entrar')
        res.setHeader('Set-Cookie', '__Host-central=UPSTREAM; Path=/; HttpOnly; Secure');
      res.end(
        JSON.stringify(destino === 'ops' ? { itens: [{ titulo: 'SENTINELA-CORPORATIVA' }] } : { ok: true }),
      );
    });
    s.listen(0, '127.0.0.1');
    await once(s, 'listening');
    t.after(() => {
      s.closeAllConnections();
      s.close();
    });
    return `http://127.0.0.1:${(s.address() as any).port}`;
  };
  let remoto = await subir('central');
  const ops = await subir('ops');
  process.env.CENTRAL_TEST_OPS_READ = 'OPS-LEITURA';
  const { criarGateway } = await carregar();
  const servidor = criarGateway({
    habilitado: true,
    central: remoto,
    bancoLocal,
    espacosLocais: [{ id: 'trabalho', nome: 'Trabalho local' }],
    segredoHash: `salt:${scryptSync('senha-local-longa', 'salt', 32).toString('hex')}`,
    timeoutMs: modo === 'lento' ? 30 : 1000,
    limiteBytes: 1024,
    fontes: [
      {
        id: 'ops',
        nome: 'Ops teste',
        url: ops,
        tokenEnv: 'CENTRAL_TEST_OPS_READ',
        categorias: ['notas', 'chamados'],
      },
    ],
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => {
    servidor.closeAllConnections();
    servidor.close();
  });
  const base = `http://127.0.0.1:${(servidor.address() as any).port}`;
  const entrar = async () => {
    const r = await fetch(base + '/gateway/entrar', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', 'X-Central': '1' },
      body: JSON.stringify({ segredo: 'senha-local-longa' }),
    });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie')!.split(';')[0];
  };
  return { eventos, base, entrar, ops };
}

test('gateway desativado e destinos fora da allowlist não iniciam', async () => {
  const { criarGateway } = await carregar();
  assert.throws(() => criarGateway({ habilitado: false } as any));
  assert.throws(() =>
    criarGateway({
      habilitado: true,
      central: 'http://evil.example',
      segredoHash: 'salt:aa',
      fontes: [],
    } as any),
  );
});

test('loopback exige login próprio, Host e origem exatos e CSRF nas escritas', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/api/operacao')).status, 401);
  assert.equal(
    (
      await fetch(f.base + '/gateway/entrar', {
        method: 'POST',
        headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json', 'X-Central': '1' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(f.base + '/gateway/entrar', {
        method: 'POST',
        headers: { Origin: f.base, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  const cookie = await f.entrar();
  assert.equal(
    (await fetch(f.base + '/api/operacao', { headers: { Cookie: cookie, Origin: 'http://evil.example' } }))
      .status,
    403,
  );
  const status = await new Promise<number>((resolve) => {
    const r = request(
      f.base + '/api/operacao',
      { headers: { Host: 'evil.example', Cookie: cookie } },
      (s) => {
        resolve(s.statusCode!);
        s.resume();
      },
    );
    r.end();
  });
  assert.equal(status, 421);
  assert.equal(f.eventos.length, 0);
});

test('rota local normaliza JSON sem enviar detalhes, cookies ou token Ops à Central', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const fontes = await (await fetch(f.base + '/api/operacao', { headers: { Cookie: cookie } })).json();
  assert.equal(fontes.local, true);
  assert.deepEqual(fontes.fontes[0].categorias, ['notas', 'chamados']);
  const r = await fetch(f.base + '/api/operacao/ops/notas', {
    headers: { Cookie: cookie + ';OUTRO=SEGREDO', Authorization: 'Bearer CLIENTE', 'X-Real-IP': '8.8.8.8' },
  });
  const dados = await r.json();
  assert.deepEqual(dados.dados, { itens: [{ titulo: 'SENTINELA-CORPORATIVA' }] });
  assert.equal(dados.erro, null);
  assert.ok(dados.em);
  assert.equal(f.eventos.length, 1);
  assert.equal(f.eventos[0].destino, 'ops');
  assert.equal(f.eventos[0].url, '/api/notas');
  assert.equal(f.eventos[0].headers.authorization, 'Bearer OPS-LEITURA');
  assert.equal(f.eventos[0].headers.cookie, undefined);
  assert.equal(f.eventos[0].headers['x-real-ip'], undefined);
  for (const path of [
    '/api/operacao/ops/pedidos',
    '/api/operacao/invasor/notas',
    '/api/operacao/ops/notas?url=http://evil.example',
  ])
    assert.equal((await fetch(f.base + path, { headers: { Cookie: cookie } })).status, 404);
  assert.equal(
    (
      await fetch(f.base + '/api/operacao/ops/notas', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: f.base, 'X-Central': '1' },
      })
    ).status,
    405,
  );
  assert.equal(f.eventos.length, 1);
});

test('login Central tem cookie isolado por sessão e escrita exige origem/CSRF', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const headers = { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  const login = await fetch(f.base + '/api/entrar', {
    method: 'POST',
    headers,
    body: '{"senha":"SENHA-CENTRAL","codigo":"123456"}',
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.equal(
    (
      await fetch(f.base + '/api/tarefas', {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Central': '1', 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  const r = await fetch(f.base + '/api/tarefas', {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer CLIENTE' },
    body: '{"titulo":"PESSOAL"}',
  });
  assert.equal(r.status, 200);
  assert.equal(f.eventos[1].headers.cookie, '__Host-central=UPSTREAM');
  assert.equal(f.eventos[1].headers.authorization, undefined);
  assert.equal(f.eventos[1].headers['x-central'], '1');
  assert.equal(
    (
      await fetch(f.base + '/api/pessoas/1', {
        method: 'PUT',
        headers,
        body: '{"nome":"Pessoal atualizado"}',
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(f.base + '/api/conversas/1/vinculos/2', { method: 'DELETE', headers })).status,
    200,
  );
  const outra = await f.entrar();
  await fetch(f.base + '/api/sessao', { headers: { Cookie: outra } });
  assert.equal(f.eventos.at(-1)!.headers.cookie, undefined);
  assert.ok(
    !JSON.stringify(f.eventos.filter((e) => e.destino === 'central')).includes('SENTINELA-CORPORATIVA'),
  );
});

for (const modo of ['redirect', 'erro', 'grande', 'lento'])
  test(`upstream ${modo} retorna erro opaco e não segue redirecionamento`, async (t) => {
    const f = await fixture(t, modo);
    const cookie = await f.entrar();
    const r = await fetch(f.base + '/api/operacao/ops/notas', { headers: { Cookie: cookie } });
    assert.equal(r.status, 502);
    const b = await r.json();
    assert.equal(b.dados, null);
    assert.equal(b.erro, 'Fonte indisponível');
    assert.ok(!JSON.stringify(b).includes('SEGREDO'));
    assert.ok(f.eventos.every((e) => e.destino === 'ops'));
  });

test('limite de corpo impede envio remoto e gateway serve o frontend da Central', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const r = await fetch(f.base + '/api/entrar', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha: 'X'.repeat(2048) }),
  });
  assert.equal(r.status, 413);
  assert.equal(f.eventos.length, 0);
  const page = await fetch(f.base + '/', { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<!doctype html>/i);
  assert.match(page.headers.get('content-security-policy')!, /connect-src 'self'/);
});

test('escrita pessoal sem login Central não envia nem corpo ao upstream; sair local revoga sessão', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const headers = { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  const r = await fetch(f.base + '/api/tarefas', {
    method: 'POST',
    headers,
    body: '{"titulo":"NÃO-TRANSMITIR"}',
  });
  assert.equal(r.status, 401);
  assert.equal(f.eventos.length, 0);
  assert.equal((await fetch(f.base + '/gateway/sair', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(f.base + '/api/local/tarefas', { headers })).status, 401);
});

test('tarefas e projetos corporativos persistem somente no banco local, inclusive erro sem fallback', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const headers = { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  const fontes = await (await fetch(f.base + '/api/operacao', { headers })).json();
  assert.equal(fontes.espaco_local, true);
  const p = await (
    await fetch(f.base + '/api/local/projetos', {
      method: 'POST',
      headers,
      body: JSON.stringify({ espaco_id: 'trabalho', nome: 'PROJETO-CORPORATIVO' }),
    })
  ).json();
  assert.equal(p.nome, 'PROJETO-CORPORATIVO');
  const r = await fetch(f.base + '/api/local/tarefas', {
    method: 'POST',
    headers,
    body: JSON.stringify({ espaco_id: 'trabalho', titulo: 'SENTINELA-CORPORATIVA', projeto_id: p.id }),
  });
  assert.equal(r.status, 200);
  const lista = await (await fetch(f.base + '/api/local/tarefas', { headers })).json();
  assert.equal(lista[0].titulo, 'SENTINELA-CORPORATIVA');
  assert.equal(lista[0].projeto_id, p.id);
  assert.equal((await fetch(f.base + '/api/local/desconhecido', { headers })).status, 404);
  assert.equal(f.eventos.length, 0);
});

test('timeline e filtros locais preservam vínculos e não exportam ao remoto', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const headers = { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  const post = async (rota: string, b: unknown) =>
    (await fetch(f.base + '/api/local/' + rota, { method: 'POST', headers, body: JSON.stringify(b) })).json();
  const pessoa = await post('pessoas', { nome: 'Contato fictício', espacos: ['trabalho'] });
  const editada = await fetch(f.base + `/api/local/pessoas/${pessoa.id}`, {
    method: 'PUT',
    headers,
    body: '{"nome":"Contato atualizado","espacos":["trabalho"]}',
  });
  assert.equal(editada.status, 200);
  const p = await post('projetos', { espaco_id: 'trabalho', nome: 'Projeto fictício' });
  await post('tarefas', {
    espaco_id: 'trabalho',
    titulo: 'Com projeto',
    projeto_id: p.id,
    pessoa_id: pessoa.id,
  });
  await post('tarefas', { espaco_id: 'trabalho', titulo: 'Sem projeto' });
  const sem = await (await fetch(f.base + '/api/local/tarefas?sem_projeto=1', { headers })).json();
  assert.deepEqual(
    sem.map((r: any) => r.titulo),
    ['Sem projeto'],
  );
  const timeline = await fetch(f.base + `/api/local/pessoas/${pessoa.id}/linha-do-tempo`, { headers });
  assert.equal(timeline.status, 200);
  const body = await timeline.json();
  assert.equal(body.pessoa.nome, 'Contato atualizado');
  assert.ok(body.eventos.some((e: any) => e.titulo === 'Com projeto'));
  const detalhe = await (await fetch(f.base + `/api/local/projetos/${p.id}`, { headers })).json();
  assert.equal(detalhe.tarefas.length, 1);
  for (const path of ['/api/local/exportar', '/api/local/contas/fonte/ler', '/api/ingest/resumo/fonte'])
    assert.equal((await fetch(f.base + path, { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal(f.eventos.length, 0);
});

test('reabrir gateway conserva SQLite corporativo sem depender da sessão Central', async (t) => {
  const pasta = await mkdtemp(join(tmpdir(), 'central-gateway-'));
  t.after(() => rm(pasta, { recursive: true, force: true }));
  const banco = join(pasta, 'local.sqlite3');
  const a = await fixture(t, 'normal', banco);
  const cookie = await a.entrar();
  const headers = { Cookie: cookie, Origin: a.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  assert.equal(
    (
      await fetch(a.base + '/api/local/tarefas', {
        method: 'POST',
        headers,
        body: '{"espaco_id":"trabalho","titulo":"PERSISTENCIA-LOCAL"}',
      })
    ).status,
    200,
  );
  const b = await fixture(t, 'normal', banco);
  const outroCookie = await b.entrar();
  const r = await (await fetch(b.base + '/api/local/tarefas', { headers: { Cookie: outroCookie } })).json();
  assert.equal(r[0].titulo, 'PERSISTENCIA-LOCAL');
  assert.equal(a.eventos.length + b.eventos.length, 0);
});

test('CLI gera hash por stdin e configuração exemplo não habilita servidor', () => {
  const hash = spawnSync(process.execPath, ['ferramentas/gateway-local.ts', '--hash'], {
    input: 'segredo-local-ficticio-123',
    encoding: 'utf8',
  });
  assert.equal(hash.status, 0);
  assert.match(hash.stdout.trim(), /^[a-f0-9]{48}:[a-f0-9]{64}$/);
  assert.ok(!hash.stdout.includes('segredo-local-ficticio'));
  const desligado = spawnSync(process.execPath, ['ferramentas/gateway-local.ts'], {
    env: {
      ...process.env,
      CENTRAL_GATEWAY_CONFIG: new URL('../config/gateway.example.json', import.meta.url).pathname,
    },
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(desligado.status, 1);
  assert.match(desligado.stderr, /desativado/);
});

test('frontend entregue contém aplicação e estilos completos com CSP somente por hash', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const page = await fetch(f.base + '/', { headers: { Cookie: cookie } });
  const html = await page.text();
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const fluxo = await readFile(new URL('../src/web/fluxo.js', import.meta.url), 'utf8');
  const estilos = await readFile(new URL('../src/web/estilos.css', import.meta.url), 'utf8');
  assert.ok(html.includes(app));
  assert.ok(html.includes(fluxo));
  assert.ok(html.includes(estilos));
  assert.ok(!html.includes('/*CENTRAL_APP*/'));
  assert.ok(!html.includes('/*CENTRAL_STYLES*/'));
  const csp = page.headers.get('content-security-policy')!;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert.ok(!/script-src[^;]*'self'/.test(csp));
  for (const path of ['/app.js', '/fluxo.js', '/estilos.css'])
    assert.equal((await fetch(f.base + path, { headers: { Cookie: cookie } })).status, 404);
});

test('espaços e busca locais funcionam sem consultar upstream', async (t) => {
  const f = await fixture(t);
  const cookie = await f.entrar();
  const headers = { Cookie: cookie, Origin: f.base, 'X-Central': '1', 'Content-Type': 'application/json' };
  const salvar = async (b: unknown) =>
    fetch(f.base + '/api/local/espacos', { method: 'POST', headers, body: JSON.stringify(b) });
  assert.equal((await salvar({ id: 'extra', nome: 'Espaço fictício', cor: '#345678' })).status, 200);
  assert.equal(
    (
      await fetch(f.base + '/api/local/tarefas', {
        method: 'POST',
        headers,
        body: '{"espaco_id":"extra","titulo":"BUSCA-SENTINELA"}',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(f.base + '/api/local/pessoas', {
        method: 'POST',
        headers,
        body: '{"nome":"BUSCA-CONTATO","espacos":["extra"]}',
      })
    ).status,
    200,
  );
  const busca = await (await fetch(f.base + '/api/local/busca?q=BUSCA&espaco=extra', { headers })).json();
  assert.deepEqual(busca.conversas, []);
  assert.equal(busca.tarefas[0].titulo, 'BUSCA-SENTINELA');
  assert.equal(busca.pessoas[0].nome, 'BUSCA-CONTATO');
  assert.equal(
    (await salvar({ id: 'extra', nome: 'Espaço fictício', cor: '#345678', arquivado: 1 })).status,
    200,
  );
  const ativos = await (await fetch(f.base + '/api/local/espacos', { headers })).json();
  assert.ok(!ativos.some((e: any) => e.id === 'extra'));
  assert.equal(f.eventos.length, 0);
});
