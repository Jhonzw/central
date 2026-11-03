# Central

Uma tela para o dia inteiro, com a vida separada em **espaços**: um para o
pessoal e um para cada empresa ou frente de trabalho. Cada espaço tem as
próprias tarefas, pessoas e fontes, e nenhum enxerga o dado do outro. A aba
**Hoje** mostra, espaço por espaço, o que venceu, o que é para hoje e o que cada
fonte diz que pede ação.

Inspirada no desenho de um "segundo cérebro": o banco é a verdade, toda
escrita fica registrada, nada é enviado para fora sem você mandar.

## Rodar

```sh
cp config/local.example.json config/local.json   # espaços e fontes (fora do git)
node src/server.ts                               # http://localhost:7800
node --test test/*.test.ts
```

Node 24, sem dependências: o SQLite é o `node:sqlite` e o TypeScript roda
direto (só sintaxe apagável, sem build).

## O que já tem (fase 1)

- **Espaços**: id, nome, cor e ordem. Um espaço não é apagado, só arquivado.
- **Pessoas**: uma pessoa com todos os canais dela (e-mail, WhatsApp,
  telefone). O canal é normalizado: e-mail em minúsculas, telefone só com
  dígitos e o DDI 55. O mesmo canal não pode ficar em duas pessoas. A pessoa
  pode estar em vários espaços.
- **Tarefas**: status, com quem está, próxima data e anotações datadas. A
  pessoa da tarefa precisa estar no mesmo espaço da tarefa.
- **Fontes (conectores)**: o tipo `resumo-http` lê um painel local que expõe
  `GET …/resumo` → `{ itens: [{ titulo, desc, qtd, urgente, link }] }`. Ele só
  aceita endereço de loopback, e o link só pode ser http(s).
- **Registro**: toda escrita gera uma linha em `alteracoes`, na mesma
  transação.

## Segurança

- Escuta só em `127.0.0.1`. Um `Host` que não seja local recebe 421 (contra DNS
  rebinding).
- Escrita sem o cabeçalho `X-Central: 1` recebe 403. Assim, outra página aberta
  no navegador não consegue escrever.
- O banco fica em `data/central.sqlite3`, com modo 600 e fora do git. As fontes
  e os nomes dos espaços ficam em `config/local.json`, também fora do git.

## Próximas fases

2. E-mail só para leitura (Gmail API com `gmail.readonly`), com triagem do que
   precisa de resposta, ligada à pessoa e ao espaço.
3. WhatsApp num número só: leitura e nota interna por conversa.
4. MCP (o Claude consulta a Central), resumos e notas do Obsidian geradas.
5. Envio manual, com confirmação.
