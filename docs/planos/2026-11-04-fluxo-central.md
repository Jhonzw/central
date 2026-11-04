# Evolução da Central — plano de implementação

Objetivo: ligar espaços, projetos, tarefas e mensagens em fluxos navegáveis, e disponibilizar uma entrada local para o trabalho corporativo.

Especificação: nota `06 · Diagnóstico e proposta de evolução.md` do vault. Autorização: “pode implementar tudo”, 04/11/2026.

## Restrições globais

- Node 24, TypeScript nativo, SQLite; nenhuma nova dependência de produção.
- Só leitura nos provedores e sistemas de origem; ações são internas à Central.
- Nenhum dado corporativo detalhado na VPS, no repositório, nos logs ou nas exportações pessoais.
- Novas migrações, preservando as antigas e todos os dados existentes.
- Testes com dados fictícios; navegador em desktop/celular e CI.
- Commits como Jhonzw <Jhonzw@users.noreply.github.com>, em português, sem coautoria.

## Decisões de execução

- Evoluir a base atual; módulos JavaScript locais na interface, sem React neste ciclo.
- A integração corporativa detalhada será local, desativada até configurar os endereços permitidos. Acesso remoto privado continua dependendo da definição do usuário.
- Recursos classificados como “Depois” na proposta continuam como expansões posteriores; este plano executa as etapas 0 a 6 completas.
- Trabalhar na branch `feat/fluxo-projetos-central`, preservando main e produção.

## Contratos de integração

Projetos: `{id:number,espaco_id,nome,objetivo,status,proxima_acao,prazo,notas,versao,criado,atualizado}`. Status: `ativo`, `pausado`, `concluido`, `arquivado`.

- `GET /api/projetos?espaco=...&todos=1`: array.
- `POST /api/projetos`: cria; `PATCH /api/projetos/:id`: altera com `versao`.
- `GET /api/projetos/:id`: projeto com `tarefas` e `conversas`.

Tarefas mantêm a interface anterior e acrescentam `projeto_id`, `projeto_nome`, `descricao`, `prioridade` (`baixa|normal|alta|urgente`), `prazo` (YYYY-MM-DD), `lembrete` (ISO ou null), `checklist:[{texto,feito}]`, `versao`, `origens:[{conversa_id,mensagem_id,canal,titulo}]`. `proxima` continua sendo o dia planejado, não prazo.

- Lista aceita `projeto`, `sem_projeto=1`, `pessoa`, `espaco`, `todas`.
- Criação/edição aceitam novos campos. Alterações usam `versao` quando disponível; conflito retorna 409.
- `POST /api/conversas/:id/tarefa` recebe `mensagem_id`, `titulo`, `projeto_id`, `proxima`, `operacao` (UUID). Sem mensagem/operação mantém compatibilidade, sem duplicar conversão legada.
- `POST /api/conversas/:id/vinculos` recebe `{tarefa_id,mensagem_id?}`; valida espaço, mensagem e projeto ativo.

Conversas mantêm `tarefa_id` para compatibilidade e acrescentam `tarefas:[{id,titulo,status,projeto_id,projeto_nome}]`, `triada`, `adiada_ate`, `cobrar_em`, `pendente_desde`, `versao`, `visto_em`, `tem_anteriores`.

- Lista aceita `estado` existente ou `todos|triar|adiadas|cobrar`, `canal`, `conta`, `pessoa`, `projeto`, `q`, `antes` (id de conversa; ordenação por última data/id), `limite`.
- Detalhe aceita `antes` (id de mensagem) e `limite`. Retorna histórico com `tem_anteriores`.
- PATCH aceita campos acima; `versao` para evitar sobrescrever edição nova. Estado de arquivamento continua compatível, mas nova entrada reabre.
- `GET /api/pessoas/:id/linha-do-tempo?espaco=...` → `{pessoa,eventos:[{tipo,id,titulo,em,espaco_id,conversa_id?,tarefa_id?,projeto_id?}]}`.

Operação local: `GET /api/operacao` retorna `{local:boolean,fontes:[{id,nome,estado,em,erro?,categorias?:string[]}]}`. `GET /api/operacao/:fonte/:categoria` retorna os dados autorizados do adaptador local. Categoria nunca é URL arbitrária. Implantação pública retorna apenas `local:false`, sem detalhes. Controles de acesso e endereço devem ser explícitos no gateway.

## Entregas e verificações

- [x] 1. Núcleo relacional e caixa: novos testes de idempotência, rollback, isolamento e concorrência; migração, projetos, tarefas, vínculos múltiplos, estados, cursores, timeline e rotas. Executar novos testes RED, implementar, executar `npm test` GREEN.
- [x] 2. E-mail confiável: teste de backlog maior que lote e retomada, pastas e referências parciais. Implementar sem perder mensagens nem alterar o provedor. Executar `node --test test/email.test.ts` e regressão.
- [x] 3. Operação local: gateway autenticado, rotas fixas, política de conteúdo e fontes locais; testes com upstreams fictícios, falhas, Host/origem e rejeição de destinos não autorizados. Documentar configuração sem habilitar dados reais.
- [x] 4. Interface: separar módulo de entrada/estilos, projetos, tarefa contextual, captura, lista/quadro, triagem, filtros, datas, mensagem→tarefa, vínculo e origem, timeline, páginas de espaço e operação. Verificar fluxo com navegador real, dados fictícios, desktop e celular.
- [x] 5. Integração: Hoje, MCP de leitura, exportação por projeto e testes de navegador no CI. Executar todos os testes e verificar CSP, retenção, raiz e `/central/`.
- [x] 6. Revisão independente, correções, documentação no vault e commits. Relatar limites operacionais sem alegar que conectores reais foram pareados ou que houve deploy.

## Foco de revisão

- Conteúdo de mensagens expira sem sobreviver em auditoria, descrição, log ou exportação automática.
- Mensagens/tarefas/projetos de espaços distintos nunca são vinculados; alterações não quebram vínculos antigos.
- Repetição de POST e falha parcial não duplicam nem deixam registros soltos.
- Navegação rápida e edições atrasadas não sobrescrevem estado recente.
- Local e VPS têm fronteira explícita: detalhes locais não entram no tráfego para o servidor público.

## Registro de progresso

- Baseline confirmado: 55 testes.
- Final: 100 testes de backend, 7 de navegador, 1 de sessão WhatsApp, 5 do gate Ops; todos passaram.
- Revisão independente: ponteiro legado, concorrência, autosave e troca de infraestrutura corrigidos com regressões RED→GREEN.
- Produção e credenciais reais não foram alteradas; gateway local e acesso Ops dependem da ativação privada documentada.
