import { test, expect } from '@playwright/test';

test('mensagens viram trabalho de projeto e mantêm origem, contexto e espaço', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('#nav').getByRole('button', { name: 'Projetos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  await page.locator('[data-form-projeto] [name=nome]').fill('Checkout');
  await page.locator('[data-form-projeto] [name=espaco_id]').selectOption('loja');
  await page.locator('[data-form-projeto] [name=objetivo]').fill('Facilitar a compra');
  await page.locator('[data-form-projeto]').getByRole('button', { name: 'Salvar projeto' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await page
    .locator('#nav')
    .getByRole('button', { name: /^Caixa/ })
    .click();
  await page.locator('[data-abrir-conversa]').filter({ hasText: 'Pode ajustar' }).click();
  await page.locator('.bolha').getByRole('button', { name: 'Criar tarefa' }).click();
  await page.locator('[data-converter] [name=titulo]').fill('Ajustar checkout');
  await page.locator('[data-converter] [name=projeto_id]').selectOption({ label: 'Checkout' });
  await page.locator('[data-converter]').getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await expect(page.locator('.contexto-conversa')).toContainText('Ajustar checkout');
  await page.locator('.contexto-conversa [data-tarefa]').click();
  await expect(page.locator('[data-form-tarefa]')).toContainText('Checkout');
  await page.locator('[data-form-tarefa] [name=descricao]').fill('Validar no celular e no desktop');
  await page.locator('[data-form-tarefa] [name=checklist]').fill('[ ] Ajustar campo\n[ ] Conferir pagamento');
  await page.locator('[data-form-tarefa]').getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.locator('[data-abrir-conversa]').filter({ hasText: 'Detalhe por e-mail' }).click();
  await expect(page.locator('.bolha .texto')).toContainText('<script>alert(1)</script>');
  await page.locator('.bolha').getByRole('button', { name: 'Vincular tarefa' }).click();
  await page.locator('[data-vincular] [name=tarefa_id]').selectOption({ label: 'Ajustar checkout' });
  await page.locator('[data-vincular]').getByRole('button', { name: 'Vincular', exact: true }).click();
  await page.locator('.contexto-conversa [data-tarefa]').click();
  await expect(page.locator('[data-form-tarefa] [data-origem]')).toHaveCount(2);
  await page.locator('[data-form-tarefa] [data-origem]').first().click();
  await expect(page.locator('.bolha.destacada')).toBeVisible();
  await page.screenshot({ path: '.e2e/caixa-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.e2e/caixa-celular.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Adiar', exact: true }).click();
  await page.locator('[data-agendar] [name=quando]').fill('2030-01-02T10:00');
  await page.locator('[data-agendar]').getByRole('button', { name: 'Salvar' }).click();
  await page.locator('[data-estado=adiadas]').click();
  await expect(page.locator('[data-abrir-conversa]')).toHaveCount(1);
  await page.locator('#nav').getByRole('button', { name: 'Projetos', exact: true }).click();
  await page.locator('[data-projeto]').filter({ hasText: 'Checkout' }).click();
  await expect(page.locator('[data-tarefa]').filter({ hasText: 'Ajustar checkout' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.e2e/projeto-celular.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('no celular os espaços mantêm contexto, captura, quadro e histórico', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#abas-movel').getByRole('button', { name: 'Mais', exact: true }).click();
  await page.locator('#conteudo [data-espaco=loja]').click();
  await expect(page.getByRole('heading', { name: 'Loja exemplo', exact: true })).toBeVisible();
  await page.locator('[data-rapida] [name=titulo]').fill('Conferir entrega móvel');
  await page.locator('[data-rapida] [name=titulo]').press('Enter');
  await expect(page.locator('[data-tarefa]').filter({ hasText: 'Conferir entrega móvel' })).toBeVisible();
  await page.locator('#abas-movel').getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.locator('[data-vista-tarefas=quadro]').click();
  await page
    .locator('.tarefa-quadro')
    .filter({ hasText: 'Conferir entrega móvel' })
    .getByRole('combobox')
    .selectOption('fazendo');
  await expect(
    page.locator('.coluna-quadro').filter({ has: page.locator('.grupo-tit').filter({ hasText: 'Fazendo' }) }),
  ).toContainText('Conferir entrega móvel');
  await page.locator('[data-vista-tarefas=lista]').click();
  await page.locator('[data-tarefa]').filter({ hasText: 'Conferir entrega móvel' }).click();
  await expect(page.locator('[data-form-tarefa] [name=status]')).toHaveValue('fazendo');
  await page.locator('[data-form-tarefa] [name=pessoa]').selectOption({ label: 'Cliente exemplo' });
  await page.locator('[data-form-tarefa]').getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-tarefa]').filter({ hasText: 'Conferir entrega móvel' })).toBeVisible();
  await page.locator('#abas-movel').getByRole('button', { name: 'Mais', exact: true }).click();
  await page.locator('#conteudo').getByRole('button', { name: 'Pessoas', exact: true }).click();
  await page.locator('[data-pessoa]').filter({ hasText: 'Cliente exemplo' }).click();
  await expect(page.locator('.timeline')).toContainText('Conferir entrega móvel');
  await page.locator('[data-fechar]').last().click();
  await page.locator('#abas-movel').getByRole('button', { name: 'Mais', exact: true }).click();
  await page.locator('#conteudo').getByRole('button', { name: 'Operação', exact: true }).click();
  await expect(page.locator('#conteudo')).toContainText('Detalhes disponíveis na entrada local');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('gateway exibe operação e salva projetos corporativos apenas na base local', async ({ page }) => {
  const base = 'http://127.0.0.1:17881';
  const r = await page.request.post(base + '/gateway/entrar', {
    headers: { Origin: base, 'X-Central': '1' },
    data: { segredo: 'segredo local somente teste' },
  });
  expect(r.status()).toBe(200);
  await page.goto(base + '/');
  await expect(page.locator('#contexto-origem')).toContainText('Trabalho local');
  await page.locator('#nav').getByRole('button', { name: 'Projetos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  await page.locator('[data-form-projeto] [name=nome]').fill('Projeto apenas local');
  await page.locator('[data-form-projeto]').getByRole('button', { name: 'Salvar projeto' }).click();
  await page.locator('[data-rapida] [name=titulo]').fill('Acompanhar chamado interno');
  await page.locator('[data-rapida] [name=titulo]').press('Enter');
  await expect(page.locator('[data-tarefa]').filter({ hasText: 'Acompanhar chamado interno' })).toBeVisible();
  await page.locator('.pe-lado').getByRole('button', { name: 'Operação', exact: true }).click();
  await page.getByRole('button', { name: 'chamados', exact: true }).click();
  await expect(page.locator('.dados-operacao').first()).toContainText('Chamado fictício local');
  await page.screenshot({ path: '.e2e/operacao-local.png', fullPage: true });
  // A mesma sessão pública autenticada continua sem receber dados locais.
  const projetos = await (await page.request.get('http://localhost:17880/api/projetos?todos=1')).json();
  expect(projetos.map((p: { nome: string }) => p.nome)).not.toContain('Projeto apenas local');
  await page.reload();
  await expect(page.locator('#contexto-origem')).toContainText('Trabalho local');
  await page.locator('#nav').getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page
    .locator('.tarefa')
    .filter({ hasText: 'Acompanhar chamado interno' })
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  await expect(page.locator('#avisos').getByRole('button', { name: 'Desfazer' })).toBeVisible();
  await page.locator('[data-trocar-contexto]').click();
  await expect(page.locator('#avisos').getByRole('button', { name: 'Desfazer' })).toHaveCount(0);
});

test('Desfazer não sobrescreve uma tarefa alterada em outra tela', async ({ page }) => {
  await page.goto('/');
  const t = await (
    await page.request.post('/api/tarefas', {
      headers: { 'X-Central': '1' },
      data: { espaco_id: 'loja', titulo: 'Concorrência navegador', status: 'fazendo' },
    })
  ).json();
  await page.locator('#nav').getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page
    .locator('.tarefa')
    .filter({ hasText: 'Concorrência navegador' })
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  const nova = await (await page.request.get('/api/tarefas/' + t.id)).json();
  await page.request.patch('/api/tarefas/' + t.id, {
    headers: { 'X-Central': '1' },
    data: { titulo: 'Alterada em outra tela', versao: nova.versao },
  });
  await page.locator('#avisos').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('#avisos')).toContainText(/alterad|atualiz|recarreg/i);
  const atual = await (await page.request.get('/api/tarefas/' + t.id)).json();
  expect(atual.status).toBe('feito');
  expect(atual.titulo).toBe('Alterada em outra tela');
});

test('resposta atrasada não troca a conversa que está selecionada', async ({ page }) => {
  await page.goto('/#caixa?estado=todos&espaco=loja');
  await expect(page.locator('.lista [data-abrir-conversa]')).toHaveCount(2);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const r = await original(...args);
      if (String(args[0]).endsWith('api/conversas/1')) {
        const json = r.json.bind(r);
        r.json = async () => {
          const d = await json();
          queueMicrotask(() => {
            (window as any).__respostaUmTerminou = true;
          });
          return d;
        };
      }
      return r;
    };
  });
  let liberar: () => void = () => {};
  const aguardar = new Promise<void>((r) => {
    liberar = r;
  });
  await page.route('**/api/conversas/1', async (route) => {
    const resposta = await route.fetch();
    await aguardar;
    await route.fulfill({ response: resposta });
  });
  await page.locator('.lista [data-abrir-conversa="1"]').click();
  await page.locator('.lista [data-abrir-conversa="2"]').click();
  await expect(page.locator('.bolha .texto')).toContainText('campo de endereço');
  const entregue = page.waitForResponse((r) => r.url().endsWith('/api/conversas/1'));
  liberar();
  await entregue;
  await page.waitForFunction(() => (window as any).__respostaUmTerminou === true);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await page.locator('.bolha .texto').textContent()).toContain('campo de endereço');
  await expect(page.locator('.lista [aria-current=true]')).toHaveAttribute('data-abrir-conversa', '2');
});

test('nota digitada numa conversa nunca é salva na próxima conversa', async ({ page }) => {
  await page.goto('/#caixa?estado=todos&espaco=loja');
  await page.locator('.lista [data-abrir-conversa="1"]').click();
  await expect(page.locator('[data-nota]')).toBeVisible();
  await page.clock.install();
  const escritasEmOutraConversa: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().endsWith('/api/conversas/2'))
      escritasEmOutraConversa.push(r.postData() || '');
  });
  await page.locator('[data-nota]').fill('Nota exclusiva da conversa A');
  await page.locator('.lista [data-abrir-conversa="2"]').click();
  await expect(page.locator('.bolha .texto')).toContainText('campo de endereço');
  await page.clock.runFor(1400);
  expect(escritasEmOutraConversa).toEqual([]);
  const c = await (await page.request.get('/api/conversas/2')).json();
  expect(c.nota).not.toBe('Nota exclusiva da conversa A');
});

test('trocar infraestrutura remove imediatamente formulários do contexto anterior', async ({ page }) => {
  const base = 'http://127.0.0.1:17881';
  await page.request.post(base + '/gateway/entrar', {
    headers: { Origin: base, 'X-Central': '1' },
    data: { segredo: 'segredo local somente teste' },
  });
  await page.goto(base + '/');
  await expect(page.locator('[data-rapida]')).toBeVisible();
  await page.locator('[data-rapida] [name=titulo]').fill('Detalhe corporativo que não pode sair');
  let liberar: () => void = () => {};
  const aguardar = new Promise<void>((r) => {
    liberar = r;
  });
  await page.route('**/api/espacos', async (route) => {
    await aguardar;
    await route.continue();
  });
  await page.locator('[data-trocar-contexto]').click();
  try {
    expect(await page.locator('[data-rapida]').count()).toBe(0);
    expect(await page.locator('#gaveta').isHidden()).toBe(true);
  } finally {
    liberar();
  }
});
