import { test, expect } from '@playwright/test';

test('formulário de captura cabe no seu quadro em desktop, tablet e celular', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-rapida]').waitFor();
  for (const width of [1440, 1280, 1100, 1024, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const bounds = await page.locator('[data-rapida]').evaluate((f) => {
      const r = f.getBoundingClientRect();
      return {
        viewport: innerWidth,
        container: r.width,
        scroll: f.scrollWidth,
        vazamentos: [...f.querySelectorAll('input,select,button')]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width < 1 || b.left < r.left - 1 || b.right > r.right + 1;
          })
          .map((el) => el.getAttribute('aria-label') || el.tagName),
        pagina: document.documentElement.scrollWidth,
      };
    });
    expect(bounds.vazamentos, JSON.stringify(bounds)).toEqual([]);
    expect(bounds.scroll).toBeLessThanOrEqual(Math.ceil(bounds.container) + 1);
    expect(bounds.pagina).toBeLessThanOrEqual(width + 1);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: '.e2e/hoje-depois-' + width + '.png', fullPage: true });
  }
});

test('captura na agenda planeja para hoje e aparece na lista com espaço e projeto escolhidos', async ({
  page,
}) => {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const p = await (
    await page.request.post('/api/projetos', {
      headers: { 'X-Central': '1' },
      data: { espaco_id: 'pessoal', nome: 'Organização do dia' },
    })
  ).json();
  await page.goto('/');
  await page.locator('[data-rapida] [name=espaco]').selectOption('pessoal');
  await page.locator('[data-rapida] [name=projeto_id]').selectOption(String(p.id));
  await expect(page.locator('[data-rapida] [name=proxima]')).toHaveValue(hoje);
  await page.locator('[data-rapida] [name=titulo]').fill('Revisar a agenda de hoje');
  await page.locator('[data-rapida] [name=titulo]').press('Enter');
  await expect(page.locator('[data-tarefa]').filter({ hasText: 'Revisar a agenda de hoje' })).toHaveCount(1);
  const tarefas = await (await page.request.get('/api/tarefas?espaco=pessoal')).json();
  const criada = tarefas.find((t: { titulo: string }) => t.titulo === 'Revisar a agenda de hoje');
  expect(criada).toMatchObject({ espaco_id: 'pessoal', projeto_id: p.id, proxima: hoje });
});

test('agenda agrupa atrasadas, hoje e lembretes sem repetir a mesma tarefa', async ({ page }) => {
  const ontem = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  for (const data of [
    {
      titulo: 'Pendência com prazo vencido',
      prazo: ontem,
      lembrete: new Date(Date.now() - 60000).toISOString(),
    },
    { titulo: 'Entrega planejada para hoje', proxima: hoje },
    { titulo: 'Lembrete para conferir retorno', lembrete: new Date(Date.now() - 60000).toISOString() },
  ])
    expect(
      (
        await page.request.post('/api/tarefas', {
          headers: { 'X-Central': '1' },
          data: { espaco_id: 'loja', ...data },
        })
      ).ok(),
    ).toBe(true);
  await page.goto('/');
  const agenda = page.locator('[data-agenda]');
  await expect(agenda.getByRole('heading', { name: 'Atrasadas', exact: true })).toBeVisible();
  await expect(agenda.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
  await expect(agenda.getByRole('heading', { name: 'Lembretes', exact: true })).toBeVisible();
  await expect(
    agenda.locator('[data-tarefa]').filter({ hasText: 'Pendência com prazo vencido' }),
  ).toHaveCount(1);
  await page.locator('.hoje-tabs [data-hoje-filtro=atrasadas]').click();
  await expect(
    agenda.locator('[data-tarefa]').filter({ hasText: 'Pendência com prazo vencido' }),
  ).toBeVisible();
  await expect(
    agenda.locator('[data-tarefa]').filter({ hasText: 'Entrega planejada para hoje' }),
  ).toHaveCount(0);
  await page.locator('.hoje-tabs [data-hoje-filtro=hoje]').click();
  await expect(
    agenda.locator('[data-tarefa]').filter({ hasText: 'Entrega planejada para hoje' }),
  ).toBeVisible();
  await page.locator('.hoje-tabs [data-hoje-filtro=todas]').click();
  await page.screenshot({ path: '.e2e/hoje-preenchido-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.e2e/hoje-preenchido-celular.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('títulos e projetos longos continuam dentro dos quadros no celular', async ({ page }) => {
  const cab = { 'X-Central': '1' };
  const espaco = await page.request.post('/api/espacos', {
    headers: cab,
    data: { id: 'frente-longa', nome: 'Frente de trabalho com nome extenso para testar organização' },
  });
  expect(espaco.ok()).toBe(true);
  const p = await (
    await page.request.post('/api/projetos', {
      headers: cab,
      data: {
        espaco_id: 'frente-longa',
        nome: 'Projeto de demonstração com um título bastante extenso para conferir a leitura no celular',
        proxima_acao: 'Conferir os campos e manter as informações organizadas mesmo em uma tela pequena.',
      },
    })
  ).json();
  expect(p.id).toBeGreaterThan(0);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/#hoje?espaco=frente-longa');
  await page.locator('[data-rapida] [name=projeto_id]').selectOption(String(p.id));
  await page
    .locator('[data-rapida] [name=titulo]')
    .fill('ConferirDocumentoComUmIdentificadorMuitoLongo'.repeat(4));
  await page.locator('[data-rapida]').getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.locator('[data-agenda] [data-tarefa]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const vazamento = await page.locator('[data-agenda]').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(vazamento).toBe(false);
});
