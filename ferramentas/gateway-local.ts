#!/usr/bin/env node
// Entrada deliberadamente separada do servidor público. Não lê .env.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { criarGateway, hashSegredo, type ConfigGateway } from '../src/operacao-local.ts';

try {
  if (process.argv.includes('--hash')) {
    let segredo = '';
    for await (const p of process.stdin) {
      segredo += p;
      if (segredo.length > 1024) throw Error('Segredo longo demais');
    }
    process.stdout.write(hashSegredo(segredo.replace(/\r?\n$/, '')) + '\n');
  } else {
    const arquivo = process.env.CENTRAL_GATEWAY_CONFIG || join(homedir(), '.config/central/gateway.json');
    let cfg: ConfigGateway;
    try {
      cfg = JSON.parse(await readFile(arquivo, 'utf8'));
    } catch {
      throw Error('Configuração local ausente ou inválida; gateway desativado');
    }
    const porta = cfg.porta ?? 7801;
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw Error('Porta local inválida');
    const servidor = criarGateway(cfg);
    servidor.on('error', () => {
      process.stderr.write('Não foi possível iniciar o gateway local\n');
      process.exitCode = 1;
      servidor.close();
    });
    servidor.listen(porta, '127.0.0.1', () =>
      process.stdout.write(`Central local: http://127.0.0.1:${porta}\n`),
    );
    for (const sinal of ['SIGINT', 'SIGTERM'] as const)
      process.on(sinal, () => {
        servidor.close();
        servidor.closeAllConnections();
      });
  }
} catch (e) {
  process.stderr.write((e instanceof Error ? e.message : 'Falha local') + '\n');
  process.exitCode = 1;
}
