// Um painel de mentira que fala o protocolo do conector resumo-http. Serve
// de modelo para ligar qualquer sistema seu à Central: basta expor isto.
//
//   node exemplos/painel-exemplo.ts      ->  http://localhost:7899/api/resumo

import { createServer } from 'node:http';

const PORTA = Number(process.env.PORTA || 7899);

const itens = [
  { titulo: '3 pedidos aguardando aprovação', desc: 'O mais antigo é de ontem.', qtd: 3, urgente: true, link: `http://localhost:${PORTA}/pedidos` },
  { titulo: 'Conferir estoque baixo', desc: '', qtd: 12, urgente: false, link: `http://localhost:${PORTA}/estoque` },
];

createServer((req, res) => {
  if (req.url !== '/api/resumo') return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ itens }));
}).listen(PORTA, '127.0.0.1', () => console.log(`painel de exemplo em http://localhost:${PORTA}/api/resumo`));
