import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// O teste faz o papel do processo do WhatsApp: pega o pedido e devolve o código.
test.setTimeout(60000);
test('Gerar código: o código aparece na tela sozinho, sem recarregar', async ({ page, request }) => {
  const token = readFileSync('.e2e/wa-token', 'utf8').trim();
  const proc = { Authorization: `Bearer ${token}` };
  // Processo vivo e desconectado, como no servidor.
  await request.post('/api/ingest/whatsapp/wa/estado', { headers: proc, data: { conectado: false } });
  await page.goto('/#conexoes');
  const form = page.locator('[data-parear="wa"]');
  await form.locator('[name=numero]').fill('5511999990000');
  await form.getByRole('button', { name: 'Gerar código' }).click();
  await expect(page.locator('.conta').filter({ hasText: 'WhatsApp fictício' })).toContainText('pedindo o código');
  const { pedido } = await (await request.get('/api/ingest/whatsapp/wa/pedido', { headers: proc })).json();
  expect(pedido).toMatchObject({ acao: 'parear', numero: '5511999990000' });
  // Como no servidor de verdade: o código demora alguns segundos para sair.
  await page.waitForTimeout(12000);
  await expect(page.locator('.passo-wa')).toContainText('Pedindo o código');
  await request.post('/api/ingest/whatsapp/wa/estado', { headers: proc, data: { conectado: false, codigo: 'ABCD-EFGH', erro: null } });
  await expect(page.locator('.codigo-par')).toHaveText('ABCD-EFGH', { timeout: 12000 });
});
