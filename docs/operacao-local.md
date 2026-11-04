# Operação local da Central

O gateway é um processo opcional nesta máquina. Serve o mesmo frontend da Central, mas mantém **Central pessoal** e **Trabalho local** em contextos separados. Tarefas, projetos e pessoas de Trabalho local ficam em SQLite próprio. Os IDs podem coincidir com os da VPS: não representam o mesmo registro. “Todos” reúne somente espaços do contexto selecionado.

O exemplo vem desativado. Nenhuma fonte real foi configurada, nenhum serviço Ops foi alterado e nenhum `.env` é lido ou escrito por este comando. Requer Node 24, sem dependências adicionais.

## Configurar e iniciar

1. Copie `config/gateway.example.json` para `~/.config/central/gateway.json`, fora do repositório. Proteja a pasta com modo `700` e o arquivo com `600`.
2. Gere um segredo próprio com pelo menos 16 caracteres. O comando abaixo lê sem ecoar e envia somente por stdin; a saída é um hash scrypt com sal aleatório. Guarde esse hash em `segredoHash`, nunca o segredo em texto.

```bash
read -rsp 'Segredo exclusivo do gateway: ' SEGREDO_GATEWAY
printf '%s' "$SEGREDO_GATEWAY" | node ferramentas/gateway-local.ts --hash
unset SEGREDO_GATEWAY
```

3. Configure `central` com a origem HTTPS pessoal, incluindo `/central/` se usada pela VPS. HTTP só é permitido para `127.0.0.1` em desenvolvimento. Não inclua credenciais, query ou fragmento na URL.
4. Configure `bancoLocal` com caminho absoluto em pasta privada fora do repositório e das pastas de backup/sincronização da Central pública. Ajuste `espacosLocais` na configuração privada. O banco não contém senha, cookie de login nem token Ops; não precisa de chave de cofre. Se futuramente receber credenciais criptografadas, a chave deverá ficar em arquivo privado separado do banco e dos backups.
5. Configure as fontes permitidas: `url` obrigatoriamente `http://127.0.0.1:PORTA/`; categorias somente `notas`, `chamados`, `transmissoes`, `pedidos`, `acompanhamento`. O adaptador faz somente `GET /api/CATEGORIA`, sem parâmetros. A variável nomeada em `tokenEnv` precisa conter um **token de leitura** dedicado do Ops, distinto do segredo do gateway e das credenciais Central. O gateway exige esse token; não transforma token de escrita em somente leitura. Ative no Ops o suporte restrito descrito abaixo; até lá mantenha `fontes: []`.
6. Exporte essa variável por mecanismo privado de sua sessão ou gerenciador de serviços, habilite `habilitado: true` e execute:

```bash
node ferramentas/gateway-local.ts
```

O caminho alternativo pode ser indicado com `CENTRAL_GATEWAY_CONFIG`. O processo sempre escuta `127.0.0.1`; abra **http://127.0.0.1:7801**, não `localhost`. O Host inclui a porta e precisa corresponder exatamente. Não publique esse listener em nginx, túnel, LAN ou VPS: acesso remoto privado exige outro desenho de transporte e autenticação.

## Habilitar credencial de leitura no Ops

O repositório Ops possui o gate opcional `src/painel/central-leitura.js`, integrado no início do servidor do painel. Ele só é habilitado para clientes que enviam Authorization. Sem esse header, a utilização local anterior do painel continua igual; esse suporte não substitui a proteção da máquina nem publica o painel em rede.

O próprio usuário deve gerar um token aleatório em arquivo privado fora dos dois repositórios, sem publicar/copiar seu valor em mensagens ou no histórico. Por exemplo, execute manualmente:

```bash
install -d -m 700 "$HOME/.config/ops-central"
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; import {homedir} from "node:os"; writeFileSync(homedir()+"/.config/ops-central/token",randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"})'
export OPS_CENTRAL_TOKEN_ARQ="$HOME/.config/ops-central/token"
export CENTRAL_OPS_TOKEN_LEITURA="$(cat "$OPS_CENTRAL_TOKEN_ARQ")"
```

O comando falha caso o arquivo já exista; não sobrescreve credenciais. O processo Ops precisa receber `OPS_CENTRAL_TOKEN_ARQ`, enquanto o gateway recebe `CENTRAL_OPS_TOKEN_LEITURA` ou a variável privada escolhida em `tokenEnv`. Configure isso no gerenciador de serviços/sessão apropriado, sem alterar `.env` em produção. A adoção exige iniciar/reiniciar explicitamente os processos pelo usuário; esta implementação não fez isso nem criou o arquivo real.

Bearer válido permite exclusivamente GET nos caminhos exatos `/api/notas`, `/api/chamados`, `/api/transmissoes`, `/api/pedidos`, `/api/acompanhamento` e `/api/resumo`, sem query string ou barra final. A categoria resumo não está exposta pelo adaptador gateway atual. Qualquer escrita, HEAD/OPTIONS, caminho diferente ou parâmetro é recusado antes dos handlers. Credencial inválida, header duplicado/excessivo ou arquivo ausente/inválido recebe erro genérico; não há fallback para a entrada local do painel. O arquivo deve ser regular, sem symlink, com permissão exclusiva do usuário, e conter 32 a 128 caracteres de letras/números/underscore/hífen. O token é relido por requisição e comparado por hash com `timingSafeEqual`; removê-lo ou substituí-lo invalida a credencial anterior. Não há chamada de escrita ao Protheus ou GLPI adicionada pelo gate.

## Autenticação e fronteiras

Antes do frontend, `/gateway/entrar` pede o segredo local. O cookie local é HttpOnly, SameSite=Strict, com nome por porta e validade de 8 horas. Como o transporte é HTTP loopback, não usa Secure: processos que controlam esta máquina continuam sendo uma fronteira de confiança. Cookies não isolam aplicações por porta; a validação de Origin/Host e o segredo independente continuam obrigatórios. Há limite de tentativas de login e de sessões. `POST /gateway/sair` encerra a sessão local e descarta seu cookie upstream em memória.

Login na Central pessoal é uma segunda etapa: senha e código seguem somente para a rota fixa `/api/entrar` da Central configurada, e não são persistidos. O cookie remoto é guardado exclusivamente na memória da sessão local, sem expô-lo ao navegador. Encerrar o processo descarta essas sessões. O domínio público e a entrada local têm sessões independentes. O gateway nunca repassa Cookie, Authorization, X-Real-IP nem outros headers arbitrários do cliente; monta headers próprios para cada destino. Nenhum cookie Central vai ao Ops. Redirecionamentos upstream são rejeitados.

Toda escrita exige Origin exata e `X-Central`; origens externas e `Sec-Fetch-Site: cross-site` são recusados também na leitura. Não há CORS aberto. Conteúdo tem CSP restrita à própria origem, resposta privada sem cache, limite de corpo/resposta e timeout. Erros de fontes são opacos e não incluem dados ou credenciais. O gateway não registra corpos de requisição ou respostas.

`/api/local/*` é reservado ao SQLite da máquina: espaços (lista/criação/alteração/arquivamento), vocabulário, Hoje, tarefas e projetos (lista/criação/detalhe/alteração), pessoas (lista/criação/detalhe/alteração/exclusão/timeline) e busca em tarefas/pessoas/conversas locais. Conversas, contas e conectores retornam listas vazias; não há coleta corporativa, exportação, MCP nem sincronização local→VPS. Uma rota local inexistente falha localmente, sem fallback remoto. O contexto local não oferece ações de escrita no GLPI, Protheus ou Ops.

`/api/operacao` e `/api/local/operacao` retornam `{local:true,espaco_local:true,fontes:[{id,nome,estado,em,erro?,categorias}]}`. A listagem informa configuração e resultado da última consulta, sem sondar a fonte. O detalhe `/api/operacao/:fonte/:categoria` (também sob `/api/local`) retorna `{dados,em,erro}`; falha retorna 502 com `dados:null`. Categorias não são URLs e parâmetros extras são recusados. A VPS pública deve retornar somente `{local:false,fontes:[]}`.

Somente uma allowlist de rotas pessoais `/api/*` segue para a Central. Dados carregados do Ops não entram nessas requisições. Ao criar ou editar registros corporativos, mantenha **Trabalho local** selecionado. Não copie conteúdo corporativo para Central pessoal: o gateway separa roteamento e armazenamento, mas não identifica semanticamente texto colado pelo usuário em um formulário pessoal. O frontend trata texto das fontes como texto, sem executar HTML ou seguir links automaticamente.

## Validação

```bash
node --test test/gateway.test.ts
npm test
```

Os testes iniciam upstreams fictícios e verificam sentinelas corporativas, isolamento entre cookies/sessões, ausência de tráfego remoto nas ações locais, persistência SQLite, Host/Origin/CSRF, categorias fixas, rejeição de redirects, limites e erros. O pareamento com um Ops real e o transporte remoto privado permanecem etapas operacionais futuras.
