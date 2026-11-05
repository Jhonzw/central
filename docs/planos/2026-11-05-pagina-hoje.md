# Reformulação da página Hoje

Pedido: reorganizar a página principal inteira e corrigir o formulário de tarefas e o botão + saindo do quadro.

Diagnóstico reproduzido em navegador: a grade do formulário exige 544px e fica dentro de um quadro de 427px em viewport de1280px. A quebra responde à janela, não ao espaço real do componente. Além disso, captura em Hoje não selecionava o dia atual.

Desenho escolhido para execução: agenda como coluna principal, captura em duas linhas com botão ao lado do título e campos de organização embaixo; acompanhamento de mensagens/cobranças ao lado; indicadores compactos no topo; projetos e espaços embaixo. O visual e a infraestrutura existentes continuam, sem dependências novas. A alternativa de manter os quadros iguais e só reduzir o botão não resolve a hierarquia nem a largura mínima.

- [x] Reproduzir e registrar testes de geometria e captura (RED).
- [x] Reformular Hoje e tornar captura compartilhada adaptável ao próprio componente.
- [x] Agrupar tarefas vencidas, de hoje e lembretes, sem duplicar; indicadores filtram os itens correspondentes.
- [x] Conferir estados vazios, contexto local e pessoal, desktop/tablet/celular e fluxos existentes.
- [x] Testes, revisão, registro no vault e publicação conforme autorização vigente.

Sem alteração de banco, envio de mensagens, credenciais ou dependências de produção. Escopo: interface da página Hoje, formulário compartilhado, montagem dos scripts locais e regressões de navegador.

Verificação concluída: 100 testes backend e 11 testes de navegador passaram. Revisão independente encontrou e permitiu corrigir quebra com nomes longos; teste específico reproduziu RED e passou GREEN. Publicação seguirá o procedimento existente, sem mudanças de banco ou configuração.
