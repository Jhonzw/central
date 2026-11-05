// Projetos, contexto e operação. Inserido localmente com CSP por hash.
function dataHoraInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const instanteInput = (v) => (v ? new Date(v).toISOString() : null);
function opcoesProjeto(espaco, selecionado, vazio = 'Sem projeto · organizar depois') {
  return (
    `<option value="">${esc(vazio)}</option>` +
    (D.projetos || [])
      .filter((p) => p.espaco_id === espaco && (p.status === 'ativo' || p.id === Number(selecionado)))
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === Number(selecionado) ? 'selected' : ''}>${esc(p.nome)}${p.status !== 'ativo' ? ' · ' + esc(p.status) : ''}</option>`,
      )
      .join('')
  );
}
function atualizarEndereco() {
  const qs = new URLSearchParams();
  if (UI.espaco !== 'todos') qs.set('espaco', UI.espaco);
  if (UI.contexto === 'local') qs.set('local', '1');
  if (UI.projeto && UI.aba === 'projetos') qs.set('projeto', UI.projeto);
  if (UI.aba === 'caixa' && UI.estado !== 'responder') qs.set('estado', UI.estado);
  if (UI.mensagem) qs.set('mensagem', UI.mensagem);
  history.replaceState(
    null,
    '',
    location.pathname +
      '#' +
      UI.aba +
      (UI.aba === 'caixa' && UI.conversa ? '/' + UI.conversa : '') +
      (qs.size ? '?' + qs : ''),
  );
}
function contextoTopo() {
  return UI.contexto === 'local'
    ? '<p class="faixa-local">Trabalho local · dados guardados neste dispositivo. “Todos” reúne somente os espaços locais.</p>'
    : '';
}
// A página Hoje reúne ações; cada contagem leva exatamente à sua fila.
function dadosDoDia(h) {
  const espacos = h.espacos.filter((e) => UI.espaco === 'todos' || e.espaco.id === UI.espaco);
  const unicas = (ts) => [...new Map(ts.map((t) => [t.id, t])).values()];
  const porPrioridade = (a, b) =>
    (({ urgente: 0, alta: 1, normal: 2, baixa: 3 })[a.prioridade] ?? 2) -
      ({ urgente: 0, alta: 1, normal: 2, baixa: 3 }[b.prioridade] ?? 2) ||
    String(a.prazo || a.proxima || '').localeCompare(String(b.prazo || b.proxima || '')) ||
    a.id - b.id;
  const atrasadas = unicas(espacos.flatMap((e) => e.vencidas)).sort(porPrioridade);
  const usadas = new Set(atrasadas.map((t) => t.id));
  const lembretes = unicas(espacos.flatMap((e) => e.lembretes || []))
    .filter((t) => !usadas.has(t.id))
    .sort(porPrioridade);
  lembretes.forEach((t) => usadas.add(t.id));
  const hoje = unicas(espacos.flatMap((e) => e.deHoje))
    .filter((t) => !usadas.has(t.id))
    .sort(porPrioridade);
  const conversas = espacos
    .flatMap((e) => e.conversas.primeiras)
    .sort((a, b) => (a.pendente_desde || a.ultima_em).localeCompare(b.pendente_desde || b.ultima_em));
  return {
    espacos,
    atrasadas,
    hoje,
    lembretes,
    conversas,
    responder: espacos.reduce((n, e) => n + e.conversas.responder, 0),
    esperando: espacos.reduce((n, e) => n + e.conversas.esperando, 0),
    cobrancas: espacos.flatMap((e) => e.cobrancas || []),
    projetos: espacos.flatMap((e) => e.projetos || []),
  };
}
function paginaHoje(h) {
  if (!h)
    return `<div class="pagina">${faixaErro() || '<div class="vazio">Organizando o seu dia…</div>'}</div>`;
  const dia = dadosDoDia(h),
    total = dia.atrasadas.length + dia.hoje.length + dia.lembretes.length;
  const data = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: FUSO,
  });
  const filtro = ['todas', 'atrasadas', 'hoje', 'lembretes'].includes(UI.hojeFiltro)
    ? UI.hojeFiltro
    : 'todas';
  const medida = (n, nome, desc, icone, acao, tom = '') =>
    `<button class="hoje-metrica ${n ? tom : 'sem-pendencia'}" ${acao}><span class="hoje-metrica-icone">${ico(icone)}</span><span class="hoje-metrica-texto"><span>${nome}</span><small>${desc}</small></span><b>${n}</b>${ico('voltar', 'hoje-seta')}</button>`;
  const tabs = [
    ['todas', 'Tudo do dia', total],
    ['atrasadas', 'Atrasadas', dia.atrasadas.length],
    ['hoje', 'Hoje', dia.hoje.length],
    ['lembretes', 'Lembretes', dia.lembretes.length],
  ];
  const grupos = [
    ['atrasadas', 'Atrasadas', 'Resolva o que já passou da data.', dia.atrasadas],
    ['hoje', 'Hoje', 'O que você reservou para este dia.', dia.hoje],
    ['lembretes', 'Lembretes', 'Chegou a hora de retomar.', dia.lembretes],
  ].filter(([id, , , ts]) => ts.length && (filtro === 'todas' || filtro === id));
  const resumo = dia.atrasadas.length
    ? `${plural(dia.atrasadas.length, 'tarefa precisa', 'tarefas precisam')} de atenção. Comece por aqui.`
    : total
      ? `${plural(total, 'ação na sua agenda', 'ações na sua agenda')}. Um próximo passo de cada vez.`
      : 'Organize o próximo passo. O restante fica no seu lugar.';
  return `<div class="pagina hoje">
    <header class="hoje-cab"><div><p class="hoje-data">${esc(data)}</p><h1>Seu dia, em ordem.</h1><p class="hoje-resumo">${esc(resumo)}</p></div><div class="hoje-contexto"><span class="chip">${UI.contexto === 'local' ? 'Trabalho local' : 'Central pessoal'} · ${UI.espaco === 'todos' ? 'Todos os espaços' : esc(espacoPor(UI.espaco).nome)}</span><button class="btn fantasma" data-atualizar aria-label="Atualizar o dia">${ico('atualizar')}<span>Atualizar</span></button></div></header>
    ${faixaErro()}${contextoTopo()}
    <section class="hoje-metricas" aria-label="Resumo do dia">
      ${medida(dia.atrasadas.length, 'Atrasadas', 'Precisam de atenção', 'alerta', 'data-hoje-filtro="atrasadas"', 'urgente')}
      ${medida(dia.hoje.length, 'Para hoje', 'Planejadas para o dia', 'calendario', 'data-hoje-filtro="hoje"', 'destaque')}
      ${medida(dia.responder, 'Para responder', 'Na sua caixa', 'caixa', 'data-ir-caixa="responder"', 'destaque')}
      ${medida(dia.esperando, 'Aguardando', 'Retorno de outra pessoa', 'relogio', 'data-ir-caixa="esperando"')}
    </section>
    <div class="hoje-layout">
      <section class="cartao hoje-agenda" data-agenda aria-labelledby="agenda-titulo">
        <div class="hoje-painel-cab"><div><span class="hoje-sobre">SEU FOCO</span><h2 id="agenda-titulo">Agenda do dia <span class="hoje-contagem">${total}</span></h2></div><button class="btn fantasma mini" data-ir="tarefas">Todas as tarefas ${ico('voltar', 'hoje-seta')}</button></div>
        <div class="hoje-captura"><p>Transforme o próximo passo em uma tarefa.</p>${formRapida()}<small>Enter também adiciona. Espaço e projeto ficam com a tarefa.</small></div>
        <div class="hoje-tabs" role="group" aria-label="Filtrar agenda">${tabs.map(([id, n, q]) => `<button data-hoje-filtro="${id}" aria-pressed="${filtro === id}">${n}<span>${q}</span></button>`).join('')}</div>
        <div class="hoje-agenda-lista">${grupos.map(([id, n, desc, ts]) => `<section class="hoje-grupo ${id}"><div class="hoje-grupo-cab"><h3><span class="hoje-ponto" aria-hidden="true"></span>${n}<span aria-hidden="true">${ts.length}</span></h3><p>${desc}</p></div>${ts.map((t) => linhaTarefa(t)).join('')}</section>`).join('') || `<div class="hoje-vazio">${ico('check')}<h3>${total ? 'Nenhuma tarefa neste filtro' : 'Sua agenda está livre'}</h3><p>${total ? 'As outras ações continuam nas abas ao lado.' : 'Adicione uma tarefa acima. Ela já fica planejada para hoje.'}</p>${total ? '<button class="btn" data-hoje-filtro="todas">Ver tudo do dia</button>' : '<button class="btn" data-foco-captura>Adicionar a primeira tarefa</button>'}</div>`}</div>
      </section>
      <aside class="hoje-acompanhamento">
        <section class="cartao hoje-caixa" aria-labelledby="hoje-caixa-titulo"><div class="hoje-painel-cab"><div><span class="hoje-sobre">CONVERSAS</span><h2 id="hoje-caixa-titulo">Sua caixa <span class="hoje-contagem">${dia.responder}</span></h2></div><button class="btn fantasma mini" data-ir-caixa="responder" aria-label="Abrir caixa">${ico('voltar', 'hoje-seta')}</button></div>
          <p class="hoje-painel-desc">Quem espera há mais tempo aparece primeiro.</p>
          ${
            dia.conversas
              .slice(0, 4)
              .map((c) => hojeConversa(c))
              .join('') ||
            '<div class="hoje-vazio compacto">' +
              ico('caixa') +
              '<h3>Você está em dia</h3><p>Novas conversas que pedem resposta aparecem aqui.</p></div>'
          }
          ${dia.responder > 4 ? `<button class="hoje-ver-todos" data-ir-caixa="responder">Ver as ${dia.responder} conversas ${ico('voltar', 'hoje-seta')}</button>` : ''}
        </section>
        <section class="cartao hoje-cobrancas" aria-labelledby="hoje-cobrar-titulo"><div class="hoje-painel-cab"><div><span class="hoje-sobre">ACOMPANHAMENTO</span><h2 id="hoje-cobrar-titulo">Retomar contato <span class="hoje-contagem">${dia.cobrancas.length}</span></h2></div>${ico('relogio')}</div>
          ${
            dia.cobrancas
              .slice(0, 4)
              .map((c) => hojeConversa(c, 'esperando'))
              .join('') ||
            `<div class="hoje-nota-vazia">Nenhuma cobrança para agora.${dia.esperando ? ` Você aguarda ${plural(dia.esperando, 'retorno', 'retornos')}.` : ' Marque uma data de cobrança na conversa para retomá-la na hora certa.'}</div>`
          }
          ${dia.cobrancas.length > 4 ? '<button class="hoje-ver-todos" data-ir-caixa="cobrar">Ver todas as cobranças</button>' : ''}
        </section>
      </aside>
    </div>
    <section class="hoje-projetos" aria-labelledby="hoje-projetos-titulo"><div class="hoje-secao-cab"><div><span class="hoje-sobre">CONTINUIDADE</span><h2 id="hoje-projetos-titulo">Projetos em movimento</h2></div><button class="btn fantasma mini" data-ir="projetos">Ver projetos ${ico('voltar', 'hoje-seta')}</button></div>
      <div class="hoje-projetos-grade">${
        dia.projetos
          .slice(0, 6)
          .map(
            (p) =>
              `<button class="hoje-projeto cartao" data-projeto="${p.id}" style="${cor(p.espaco_id)}"><span class="meta">${chipEspaco(p.espaco_id)}${!p.proxima_acao ? '<span class="hoje-sem-passo">Definir próximo passo</span>' : ''}</span><h3>${esc(p.nome)}</h3><p>${esc(p.proxima_acao || p.objetivo || 'Abra o projeto e escolha a próxima ação.')}</p><span class="hoje-projeto-rodape">${p.prazo ? 'Prazo ' + dataCurta(p.prazo) : 'Abrir projeto'}${ico('voltar', 'hoje-seta')}</span></button>`,
          )
          .join('') ||
        `<div class="hoje-projeto-vazio"><div>${ico('camadas')}<span><b>Dê um lugar para cada entrega</b><small>Reúna tarefas e conversas em um projeto.</small></span></div><button class="btn" data-novo-projeto>${ico('mais')}Criar projeto</button></div>`
      }</div>
    </section>
    <section class="hoje-espacos" aria-labelledby="hoje-espacos-titulo"><div class="hoje-secao-cab"><div><span class="hoje-sobre">CADA FRENTE NO SEU LUGAR</span><h2 id="hoje-espacos-titulo">${UI.espaco === 'todos' ? 'Seus espaços' : 'Neste espaço'}</h2></div></div><div class="hoje-espacos-grade">${dia.espacos.map((e) => hojeEspaco(e)).join('')}</div></section>
  </div>`;
}
function hojeConversa(c, estado = 'responder') {
  const idade = espera(c.pendente_desde || c.ultima_em);
  return `<button class="hoje-conversa" data-abrir-conversa="${c.id}" data-estado-conversa="${estado}" data-espaco-conversa="${esc(c.espaco_id)}">${avatar(nomeConversa(c), c.espaco_id, c.canal)}<span class="hoje-conversa-texto"><strong>${esc(nomeConversa(c))}</strong><span>${esc(c.ultima?.texto || c.ultima?.assunto || c.titulo || 'Abrir conversa')}</span><small>${esc(espacoPor(c.espaco_id).nome)} · ${c.canal === 'email' ? 'E-mail' : 'WhatsApp'}</small></span><span class="idade ${idade.cls}">${estado === 'esperando' && c.cobrar_em ? horaLista(c.cobrar_em) : idade.txt}</span></button>`;
}
function hojeEspaco(e) {
  const fontes = e.fontes || [],
    itens = fontes.flatMap((f) => f.itens),
    erros = fontes.filter((f) => f.erro);
  return `<article class="cartao hoje-espaco" style="${cor(e.espaco.id)}"><button class="hoje-espaco-topo" data-espaco="${esc(e.espaco.id)}"><span class="bolinha"></span><h3>${esc(e.espaco.nome)}</h3>${ico('voltar', 'hoje-seta')}</button><div class="hoje-espaco-resumo"><span><b>${e.abertas}</b> ${e.abertas === 1 ? 'tarefa aberta' : 'tarefas abertas'}</span><span><b>${e.conversas.responder}</b> para responder</span></div>
    ${
      itens.length
        ? `<div class="hoje-fonte-resumo">${itens
            .slice(0, 2)
            .map(
              (i) =>
                `<p class="${i.urgente ? 'urgente' : ''}">${i.qtd != null ? `<b>${i.qtd}</b> ` : ''}${esc(i.titulo)}</p>`,
            )
            .join(
              '',
            )}<button class="btn mini fantasma" data-ir="operacao">Ver operação ${ico('voltar', 'hoje-seta')}</button></div>`
        : ''
    }
    ${erros.map((f) => `<p class="fonte-erro">${esc(f.nome)}: ${esc(f.erro)}</p>`).join('')}</article>`;
}
function desenharMais() {
  return `<div class="pagina"><div class="cab"><div><h1>Seu espaço de trabalho</h1><p>Escolha o contexto e continue dentro da Central.</p></div></div>${contextoTopo()}
    ${D.operacao?.espaco_local ? `<button class="btn" data-trocar-contexto>${UI.contexto === 'local' ? 'Abrir Central pessoal' : 'Abrir trabalho local'}</button>` : ''}
    <div class="atalhos-espaco bloco-contexto">${[
      ['pessoas', 'Pessoas'],
      ['operacao', 'Operação'],
      ['conexoes', 'Conexões'],
      ['espacos', 'Gerenciar espaços'],
    ]
      .map(([aba, n]) => `<button class="cartao" data-ir="${aba}">${n}</button>`)
      .join('')}</div>
    <div class="grupo-tit">Espaços</div><div class="projetos-grade">${[{ id: 'todos', nome: 'Todos' }, ...D.espacos].map((e) => `<button class="cartao projeto-card" data-espaco="${esc(e.id)}"><h2>${esc(e.nome)}</h2></button>`).join('')}</div></div>`;
}
function cardProjeto(p) {
  return `<button class="cartao projeto-card" data-projeto="${p.id}" style="${cor(p.espaco_id)}">
    <div class="meta">${chipEspaco(p.espaco_id)}<span class="chip">${esc(p.status)}</span></div>
    <h2>${esc(p.nome)}</h2><p>${esc(p.objetivo || 'Defina o resultado que quer alcançar.')}</p>
    <div class="proxima-acao">${ico('raio')}${esc(p.proxima_acao || 'Escolher o próximo passo')}</div>
    ${p.prazo ? `<small>Prazo ${dataCurta(p.prazo)}</small>` : ''}</button>`;
}
function desenharProjetos() {
  if (D.projeto && UI.projeto) return desenharProjeto(D.projeto);
  const projetos = (D.projetos || []).filter((p) => UI.espaco === 'todos' || p.espaco_id === UI.espaco);
  return `<div class="pagina">${contextoTopo()}<div class="cab"><div><h1>Projetos</h1><p>Um resultado claro, o próximo passo e todo o contexto.</p></div>
    <button class="btn primario" data-novo-projeto>${ico('mais')}Novo projeto</button></div>${faixaErro()}
    <div class="ferramentas"><label>Mostrar<select data-projetos-status><option value="ativos" ${UI.projetosStatus !== 'todos' ? 'selected' : ''}>Ativos e pausados</option><option value="todos" ${UI.projetosStatus === 'todos' ? 'selected' : ''}>Todos, com histórico</option></select></label></div>
    <div class="projetos-grade">${
      projetos
        .filter((p) => UI.projetosStatus === 'todos' || ['ativo', 'pausado'].includes(p.status))
        .map(cardProjeto)
        .join('') ||
      '<div class="cartao vazio"><b>Qual resultado você quer alcançar?</b>Crie um projeto e reúna suas tarefas e conversas aqui.</div>'
    }</div></div>`;
}
function desenharProjeto(p) {
  const abertas = (p.tarefas || []).filter((t) => !t.concluido);
  return `<div class="pagina">${contextoTopo()}<button class="btn fantasma" data-voltar-projetos>← Projetos</button>
    <div class="cab projeto-cab"><div><div class="meta">${chipEspaco(p.espaco_id)}<span class="chip">${esc(p.status)}</span></div><h1>${esc(p.nome)}</h1><p>${esc(p.objetivo)}</p></div><button class="btn" data-editar-projeto="${p.id}">Editar projeto</button></div>${faixaErro()}
    <div class="projeto-proximo"><span class="titulo-lado">Próximo passo</span><strong>${esc(p.proxima_acao || 'Escolha a próxima ação nas tarefas abaixo')}</strong>${p.prazo ? `<span>Prazo ${dataCurta(p.prazo)}</span>` : ''}</div>
    <div class="ferramentas"><span>${plural(abertas.length, 'tarefa aberta', 'tarefas abertas')}</span><div class="segmento"><button data-vista-tarefas="lista" aria-pressed="${UI.vista !== 'quadro'}">Lista</button><button data-vista-tarefas="quadro" aria-pressed="${UI.vista === 'quadro'}">Quadro</button></div></div>
    <section class="cartao">${p.status === 'ativo' ? formRapida(p.espaco_id, p.id) : '<p class="vazio">Reative o projeto para adicionar trabalho.</p>'}${UI.vista === 'quadro' ? quadroTarefas(p.tarefas || []) : (p.tarefas || []).map(linhaTarefa).join('') || '<div class="vazio">Escreva a primeira tarefa acima.</div>'}</section>
    ${(p.conversas || []).length ? `<section class="cartao bloco-contexto"><div class="cartao-cab"><h2>Conversas relacionadas</h2></div>${p.conversas.map((c) => `<button class="fila-item" data-abrir-conversa="${c.id}" data-estado-conversa="${esc(c.estado)}"><span>${esc(c.titulo || c.pessoa_nome)}</span><span class="chip">${esc(c.canal || '')}</span></button>`).join('')}</section>` : ''}
    ${p.notas ? `<section class="cartao bloco-contexto"><div class="cartao-cab"><h2>Notas do projeto</h2></div><p class="texto-proprio">${esc(p.notas)}</p></section>` : ''}</div>`;
}
function formProjeto(p = {}) {
  return `<div class="gaveta-cab"><h2>${p.id ? 'Editar projeto' : 'Novo projeto'}</h2><button class="btn fantasma" data-fechar aria-label="Fechar">${ico('fechar')}</button></div>
    <form class="form" data-form-projeto="${p.id || ''}"><input type="hidden" name="versao" value="${p.versao || ''}">
      <label>Nome<input name="nome" maxlength="200" value="${esc(p.nome)}" required></label>
      <label>Espaço<select name="espaco_id" ${p.id ? 'disabled' : ''}>${D.espacos.map((e) => `<option value="${esc(e.id)}" ${e.id === (p.espaco_id || (UI.espaco !== 'todos' ? UI.espaco : D.espacos[0]?.id)) ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label>
      <label>Objetivo<textarea name="objetivo" maxlength="4000" placeholder="O que estará diferente quando terminar?">${esc(p.objetivo)}</textarea></label>
      <label>Próxima ação<input name="proxima_acao" maxlength="1000" value="${esc(p.proxima_acao)}" placeholder="Um passo concreto para avançar"></label>
      <div class="duas-col"><label>Prazo<input name="prazo" type="date" value="${esc(p.prazo)}"></label><label>Situação<select name="status">${Object.entries(
        { ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído', arquivado: 'Arquivado' },
      )
        .map(([s, n]) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${n}</option>`)
        .join('')}</select></label></div>
      <label>Notas<textarea name="notas" maxlength="8000">${esc(p.notas)}</textarea></label><p class="pequeno">Conclua as tarefas abertas antes de concluir ou arquivar o projeto.</p><button class="btn primario">Salvar projeto</button></form>`;
}
function quadroTarefas(ts) {
  return `<div class="quadro">${D.vocab.status
    .map(
      (s) =>
        `<section class="coluna-quadro"><div class="grupo-tit"><span>${NOME_STATUS[s]}</span><span>${ts.filter((t) => t.status === s).length}</span></div>${
          ts
            .filter((t) => t.status === s)
            .map(
              (t) =>
                `<div class="cartao tarefa-quadro"><button class="titulo-quadro" data-tarefa="${t.id}">${esc(t.titulo)}</button><p class="pequeno">${esc(t.projeto_nome || 'Sem projeto')}${t.prazo ? ' · prazo ' + dataCurta(t.prazo) : ''}</p><select data-status-tarefa="${t.id}" data-versao="${t.versao}" aria-label="Situação de ${esc(t.titulo)}">${D.vocab.status.map((x) => `<option value="${x}" ${x === s ? 'selected' : ''}>${NOME_STATUS[x]}</option>`).join('')}</select></div>`,
            )
            .join('') || '<p class="pequeno vazio">Nenhuma tarefa</p>'
        }</section>`,
    )
    .join('')}</div>`;
}
function filtrosTarefas() {
  return `<div class="ferramentas"><label>Projeto<select data-filtro-projeto><option value="">Todos os projetos</option><option value="sem" ${UI.filtroProjeto === 'sem' ? 'selected' : ''}>Sem projeto · organizar</option>${(
    D.projetos || []
  )
    .filter((p) => UI.espaco === 'todos' || p.espaco_id === UI.espaco)
    .map(
      (p) =>
        `<option value="${p.id}" ${String(p.id) === UI.filtroProjeto ? 'selected' : ''}>${esc(p.nome)}</option>`,
    )
    .join(
      '',
    )}</select></label><div class="segmento"><button data-vista-tarefas="lista" aria-pressed="${UI.vista !== 'quadro'}">Lista</button><button data-vista-tarefas="quadro" aria-pressed="${UI.vista === 'quadro'}">Quadro</button></div></div>`;
}
function formTarefaCompleta(t) {
  const ps = (D.pessoas || []).filter((p) => p.espacos.some((e) => e.id === t.espaco_id));
  return `<div class="gaveta-cab"><h2>Tarefa</h2><button class="btn fantasma" data-fechar aria-label="Fechar">${ico('fechar')}</button></div><form class="form" data-form-tarefa="${t.id}"><input type="hidden" name="versao" value="${t.versao}">
    <div>${chipEspaco(t.espaco_id)} <span class="chip">${esc(t.projeto_nome || 'Sem projeto')}</span></div>
    <label>O que fazer<input name="titulo" value="${esc(t.titulo)}" required maxlength="200"></label>
    <label>Projeto<select name="projeto_id">${opcoesProjeto(t.espaco_id, t.projeto_id)}</select></label>
    <label>Descrição<textarea name="descricao" maxlength="8000">${esc(t.descricao)}</textarea></label>
    <div class="duas-col"><label>Situação<select name="status">${D.vocab.status.map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${NOME_STATUS[s]}</option>`).join('')}</select></label><label>Prioridade<select name="prioridade">${Object.entries(
      { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' },
    )
      .map(([s, n]) => `<option value="${s}" ${s === t.prioridade ? 'selected' : ''}>${n}</option>`)
      .join('')}</select></label></div>
    <div class="duas-col"><label>Trabalhar em<input name="proxima" type="date" value="${esc(t.proxima)}"></label><label>Prazo de entrega<input name="prazo" type="date" value="${esc(t.prazo)}"></label></div>
    <label>Lembrar / cobrar em<input name="lembrete" type="datetime-local" value="${dataHoraInput(t.lembrete)}"></label>
    <label>Com quem<select name="pessoa"><option value="">Ninguém</option>${ps.map((p) => `<option value="${p.id}" ${p.id === t.pessoa_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
    <label>Checklist<textarea name="checklist" placeholder="[ ] Primeiro passo&#10;[x] Passo concluído" rows="4">${esc((t.checklist || []).map((i) => `[${i.feito ? 'x' : ' '}] ${i.texto}`).join('\n'))}</textarea><span class="pequeno">Um item por linha. Use [x] para marcar concluído.</span></label>
    <div class="origens"><label>Mensagens de origem</label>${(t.origens || []).map((o) => `<button type="button" class="origem" data-origem="${o.conversa_id}" data-mensagem="${o.mensagem_id || ''}">${ico(o.canal === 'email' ? 'email' : 'whatsapp')}<span>${esc(o.titulo || 'Conversa')} · ${o.mensagem_id ? 'mensagem #' + o.mensagem_id : 'conversa'}</span>↗</button>`).join('') || '<p class="pequeno">Criada diretamente na Central.</p>'}</div>
    <label>Anotar<textarea name="nota" maxlength="4000" placeholder="Anote uma decisão ou o que falta."></textarea></label><button class="btn primario">Salvar</button>
    ${(t.anotacoes || []).length ? `<div class="historico">${t.anotacoes.map((n) => `<div><time>${quando(n.em)}<button type="button" data-apagar-anotacao="${n.id}" data-da-tarefa="${t.id}">apagar</button></time>${esc(n.texto)}</div>`).join('')}</div>` : ''}</form>`;
}
function filtrosCaixa() {
  const estados = {
    triar: 'A triar',
    responder: 'Responder',
    esperando: 'Esperando',
    cobrar: 'Cobrar',
    adiadas: 'Adiados',
    resolvida: 'Concluídos',
    todos: 'Todos / Arquivados',
  };
  return `<div class="lista-cab"><h1>Caixa${UI.espaco !== 'todos' ? ' · ' + esc(espacoPor(UI.espaco).nome) : ''}</h1>
    <div class="segmento estados-caixa">${Object.entries(estados)
      .map(([id, n]) => `<button data-estado="${id}" aria-pressed="${UI.estado === id}">${n}</button>`)
      .join('')}</div>
    <div class="filtros-caixa"><input data-busca-caixa placeholder="Buscar na caixa" value="${esc(UI.buscaCaixa)}" aria-label="Buscar na caixa"><select data-canal-caixa aria-label="Canal"><option value="">Todos os canais</option><option value="email" ${UI.canal === 'email' ? 'selected' : ''}>E-mail</option><option value="whatsapp" ${UI.canal === 'whatsapp' ? 'selected' : ''}>WhatsApp</option></select>
    <select data-conta-caixa aria-label="Conta"><option value="">Todas as contas</option>${(
      D.contasCaixa || []
    )
      .filter((c) => !UI.canal || c.tipo === UI.canal)
      .map(
        (c) => `<option value="${esc(c.id)}" ${c.id === UI.conta ? 'selected' : ''}>${esc(c.nome)}</option>`,
      )
      .join('')}</select>
    <select data-projeto-caixa aria-label="Projeto da caixa"><option value="">Todos os projetos</option>${(
      D.projetos || []
    )
      .filter((p) => UI.espaco === 'todos' || p.espaco_id === UI.espaco)
      .map(
        (p) =>
          `<option value="${p.id}" ${String(p.id) === UI.projetoCaixa ? 'selected' : ''}>${esc(p.nome)}</option>`,
      )
      .join('')}</select></div>
    <details class="vistas-salvas"><summary>Vistas salvas</summary><button class="btn mini" data-salvar-vista>Salvar filtros atuais</button>${lerVistas()
      .map(
        (v, i) =>
          `<div><button class="btn mini" data-vista-salva="${i}">${esc(v.nome)}</button><button class="btn mini" data-apagar-vista="${i}" aria-label="Apagar vista ${esc(v.nome)}">×</button></div>`,
      )
      .join('')}</details></div>`;
}
function contextoConversa(c) {
  return `<aside class="contexto-conversa"><div class="grupo-tit"><span>Trabalho relacionado</span></div>${(c.tarefas || []).map((t) => `<div class="contexto-linha"><button class="contexto-tarefa" data-tarefa="${t.id}"><span>${esc(t.titulo)}</span><small>${esc(t.projeto_nome || 'Sem projeto')} · ${NOME_STATUS[t.status] || esc(t.status)}</small></button><button class="btn mini fantasma" data-desvincular="${t.id}" aria-label="Desvincular ${esc(t.titulo)}">×</button></div>`).join('') || '<p class="pequeno">Transforme uma mensagem em tarefa ou vincule ao trabalho existente.</p>'}
    <div class="meta"><span class="chip">${c.triada ? 'Triada' : 'A triar'}</span>${c.adiada_ate ? `<span class="chip">Adiada até ${quando(c.adiada_ate)}</span>` : ''}${c.cobrar_em ? `<span class="chip">Cobrar ${quando(c.cobrar_em)}</span>` : ''}${c.pendente_desde ? `<span class="chip">Pendente há ${espera(c.pendente_desde).txt}</span>` : ''}</div></aside>`;
}
function formConverter(mensagem) {
  const c = D.conversa;
  UI.converter = { conversa: c.id, mensagem, operacao: crypto.randomUUID() };
  return `<div class="gaveta-cab"><h2>Criar tarefa da mensagem</h2><button class="btn fantasma" data-fechar aria-label="Fechar">×</button></div><form class="form" data-converter><p>${chipEspaco(c.espaco_id)}<span class="chip">${mensagem ? 'Mensagem #' + mensagem : 'Conversa'}</span></p>
    <label>O que fazer<input name="titulo" maxlength="200" required value="${esc('Responder: ' + (c.titulo || c.pessoa_nome || 'conversa'))}"></label><label>Projeto<select name="projeto_id">${opcoesProjeto(c.espaco_id)}</select></label><label>Trabalhar em<input name="proxima" type="date"></label>
    <p class="pequeno">A origem fica vinculada. Nenhum conteúdo é enviado e a conversa continua disponível.</p><button class="btn primario">Criar tarefa</button></form>`;
}
async function abrirVinculo(mensagem) {
  const c = D.conversa,
    contexto = UI.contexto;
  const ts = await api('GET', '/api/tarefas?espaco=' + encodeURIComponent(c.espaco_id), undefined, contexto);
  if (UI.conversa != c.id || contexto !== UI.contexto) return;
  UI.vincular = { conversa: c.id, mensagem };
  abrirGaveta(
    `<div class="gaveta-cab"><h2>Vincular tarefa existente</h2><button class="btn fantasma" data-fechar aria-label="Fechar">×</button></div><form class="form" data-vincular><label>Tarefa<select name="tarefa_id" required><option value="">Escolha uma tarefa</option>${ts.map((t) => `<option value="${t.id}">${esc(t.titulo)}</option>`).join('')}</select></label><p class="pequeno">Somente tarefas deste espaço.</p><button class="btn primario" ${ts.length ? '' : 'disabled'}>Vincular</button></form>`,
  );
}
function formAgendar(tipo) {
  UI.agendar = { tipo, conversa: D.conversa.id, versao: D.conversa.versao };
  return `<div class="gaveta-cab"><h2>${tipo === 'adiada_ate' ? 'Adiar conversa' : 'Marcar cobrança'}</h2><button class="btn fantasma" data-fechar aria-label="Fechar">×</button></div><form class="form" data-agendar><label>Quando<input name="quando" type="datetime-local" required value="${dataHoraInput(D.conversa[tipo])}"></label><p class="pequeno">A Central lembra aqui; não envia nenhuma mensagem.</p><button class="btn primario">Salvar</button></form>`;
}
function desenharEspaco() {
  const e = D.hoje?.espacos.find((x) => x.espaco.id === UI.espaco);
  if (!e) return `<div class="pagina">${faixaErro() || '<div class="vazio">Escolha um espaço.</div>'}</div>`;
  return `<div class="pagina">${contextoTopo()}<div class="cab"><div><div class="meta">${chipEspaco(e.espaco.id)}</div><h1>${esc(e.espaco.nome)}</h1><p>O trabalho, as conversas e a operação deste espaço.</p></div></div>${faixaErro()}
    <div class="atalhos-espaco"><button class="cartao" data-ir-caixa="responder"><b>${e.conversas.responder}</b>Para responder</button><button class="cartao" data-ir="tarefas"><b>${e.abertas}</b>Tarefas abertas</button><button class="cartao" data-ir="projetos"><b>${(D.projetos || []).filter((p) => p.espaco_id === UI.espaco && p.status === 'ativo').length}</b>Projetos ativos</button><button class="cartao" data-ir="operacao"><b>${ico('raio')}</b>Operação</button></div>
    <div class="projetos-grade">${(D.projetos || [])
      .filter((p) => p.espaco_id === UI.espaco && p.status === 'ativo')
      .map(cardProjeto)
      .join('')}</div>
    <section class="cartao bloco-contexto"><div class="cartao-cab"><h2>Próximas ações</h2></div>${formRapida(e.espaco.id)}${
      (D.tarefas || [])
        .filter((t) => !t.concluido)
        .slice(0, 8)
        .map(linhaTarefa)
        .join('') || '<p class="vazio">Capture a primeira tarefa acima.</p>'
    }</section>
    ${
      e.fontes.length
        ? `<section class="cartao bloco-contexto"><div class="cartao-cab"><h2>Resumo da operação</h2></div>${e.fontes
            .flatMap((f) => f.itens)
            .map(
              (i) =>
                `<button class="fonte-item" data-ir="operacao"><b>${i.qtd ?? ''}</b><span>${esc(i.titulo)}</span>Ver na Central →</button>`,
            )
            .join('')}</section>`
        : ''
    }</div>`;
}
function desenharOperacao() {
  const op = D.operacao || {};
  return `<div class="pagina">${contextoTopo()}<div class="cab"><div><h1>Operação</h1><p>Informações dos sistemas conectados, dentro da Central.</p></div><button class="btn" data-recarregar-operacao>Atualizar</button></div>${faixaErro()}
    ${!op.local ? '<section class="cartao vazio"><b>Detalhes disponíveis na entrada local</b>Na versão pública, este espaço mostra apenas o resumo permitido. Use a Central local no notebook para consultar os detalhes da operação.</section>' : `<div class="fontes-operacao">${(op.fontes || []).map((f) => `<section class="cartao"><div class="cartao-cab"><h2>${esc(f.nome)}</h2><span class="chip">${esc(f.estado)}</span></div>${f.erro ? `<p class="erro">${esc(f.erro)}</p>` : ''}<div class="opcoes">${(f.categorias || []).map((c) => `<button class="btn" data-fonte="${esc(f.id)}" data-categoria="${esc(c)}">${esc(c)}</button>`).join('')}</div></section>`).join('') || '<section class="cartao vazio"><b>Nenhuma fonte local configurada</b>Configure as fontes permitidas no gateway deste dispositivo.</section>'}</div>`}
    ${D.detalheOperacao ? `<section class="cartao bloco-contexto"><div class="cartao-cab"><h2>${esc(UI.categoriaOperacao)}</h2><small>${D.detalheOperacao.em ? 'Atualizado ' + quando(D.detalheOperacao.em) : ''}</small></div>${D.detalheOperacao.erro ? `<p class="erro">${esc(D.detalheOperacao.erro)}</p>` : ''}${renderDadosOperacao(D.detalheOperacao.dados)}</section>` : ''}</div>`;
}
function renderDadosOperacao(v) {
  const dados = v?.dados ?? v;
  if (!dados || typeof dados !== 'object') return '<div class="vazio">Nenhuma informação disponível.</div>';
  const grupos = dados.baldes
    ? Object.entries(dados.baldes)
    : [['itens', Array.isArray(dados) ? dados : dados.linhas || dados.itens || []]];
  const nomes = {
    meus: 'Meus chamados',
    semDono: 'Sem responsável',
    parados: 'Sem atualização',
    pendentes: 'Pendentes',
    andando: 'Em andamento',
    itens: 'Itens da operação',
  };
  const acompanha = UI.categoriaOperacao === 'acompanhamento' ? dados.itens || dados : null;
  if (acompanha && !Array.isArray(acompanha))
    grupos.splice(0, grupos.length, [
      'itens',
      Object.entries(acompanha)
        .filter(([, x]) => x && typeof x === 'object')
        .map(([id, x]) => ({ id, ...x })),
    ]);
  return `<div class="dados-operacao">${
    grupos
      .map(([grupo, linhas]) => {
        if (!Array.isArray(linhas) || !linhas.length) return '';
        return `<section class="grupo-operacao"><div class="grupo-tit"><span>${esc(nomes[grupo] || 'Itens')}</span><span>${linhas.length}</span></div>${linhas
          .slice(0, 200)
          .map((r) => {
            const id = r.id || r.F2_DOC || r.C5_NUM || '';
            const titulo =
              r.titulo ||
              r.assunto ||
              (r.F2_DOC ? 'Documento ' + r.F2_DOC : r.C5_NUM ? 'Pedido ' + r.C5_NUM : 'Acompanhamento ' + id);
            const situacao =
              r.statusNome ||
              r.situacao?.nome ||
              (typeof r.situacao === 'string' ? r.situacao : '') ||
              (typeof r.status === 'string' ? r.status : '');
            const campos = [
              ['Responsável', r.tecnico || r.comQuem],
              ['Solicitante', r.requerente],
              ['Filial', r.F2_FILIAL || r.C5_FILIAL],
              ['Pedido', r.C5_NUM],
              ['Série', r.F2_SERIE],
              ['Próxima data', r.proxima],
              ['Sem atualização', Number.isFinite(r.semMexer) ? r.semMexer + ' dias' : null],
            ].filter(([, x]) => x !== undefined && x !== null && x !== '');
            return `<article class="item-operacao"><div class="operacao-titulo"><h3>${id ? `<span class="pequeno">#${esc(id)}</span> ` : ''}${esc(titulo)}</h3>${situacao ? `<span class="chip">${esc(situacao)}</span>` : ''}</div>${r.acao ? `<p class="proxima-acao">${esc(r.acao)}</p>` : ''}<dl>${campos.map(([nome, valor]) => `<div><dt>${nome}</dt><dd>${esc(valor)}</dd></div>`).join('')}</dl>${r.ultimo?.texto || r.nota ? `<details><summary>Último acompanhamento</summary><p class="texto-proprio">${esc(r.ultimo?.texto || r.nota)}</p></details>` : ''}${r.validacao?.causas?.length ? `<details><summary>O que precisa de atenção · ${r.validacao.causas.length}</summary><ul>${r.validacao.causas.map((c) => `<li>${esc(c.msg || c.descricao || 'Conferir cadastro')}</li>`).join('')}</ul></details>` : ''}</article>`;
          })
          .join(
            '',
          )}${linhas.length > 200 ? '<p class="pequeno">Exibindo os primeiros 200 itens desta categoria.</p>' : ''}</section>`;
      })
      .join('') || '<div class="vazio">Nenhum item nesta categoria.</div>'
  }</div>`;
}
async function carregarTimeline(p) {
  const qs = UI.espaco !== 'todos' ? '?espaco=' + encodeURIComponent(UI.espaco) : '';
  const dados = await api('GET', `/api/pessoas/${p.id}/linha-do-tempo${qs}`);
  return `<section class="timeline"><h3>Linha do tempo</h3>${dados.eventos.map((x) => `<button type="button" class="evento-timeline" ${x.conversa_id ? `data-origem="${x.conversa_id}"` : x.tarefa_id ? `data-tarefa="${x.tarefa_id}"` : x.tipo === 'tarefa' ? `data-tarefa="${x.id}"` : ''}><time>${quando(x.em)}</time><span>${esc(x.titulo)}</span><small>${esc(x.tipo)} · ${esc(espacoPor(x.espaco_id).nome)}</small></button>`).join('') || '<p class="pequeno">O histórico aparece conforme você vincula conversas e tarefas.</p>'}</section>`;
}
function lerVistas() {
  try {
    return JSON.parse(localStorage.getItem('central-vistas-' + UI.contexto) || '[]')
      .filter((v) => v && typeof v.nome === 'string')
      .slice(0, 10);
  } catch {
    return [];
  }
}
function salvarVistas(v) {
  try {
    localStorage.setItem('central-vistas-' + UI.contexto, JSON.stringify(v));
  } catch {
    avisar('Não foi possível salvar a preferência neste navegador.', { erro: true });
  }
}
async function fluxoClique(e) {
  const b = e.target.closest(
    '[data-novo-projeto],[data-projeto],[data-editar-projeto],[data-voltar-projetos],[data-vista-tarefas],[data-criar-mensagem],[data-vincular-mensagem],[data-origem],[data-agendar-conversa],[data-triar],[data-retomar],[data-mais-mensagens],[data-mais-conversas],[data-fonte],[data-recarregar-operacao],[data-trocar-contexto],[data-salvar-vista],[data-vista-salva],[data-apagar-vista],[data-virar-tarefa],[data-desvincular],[data-hoje-filtro],[data-foco-captura]',
  );
  if (!b) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  try {
    if (b.hasAttribute('data-trocar-contexto')) {
      if (UI.trocando) return;
      UI.trocando = true;
      $('#avisos').replaceChildren();
      clearTimeout(UI.tNota);
      UI.carga = (UI.carga || 0) + 1;
      fecharGaveta();
      $('#conteudo').innerHTML =
        '<div class="pagina"><div class="vazio">Abrindo o outro contexto…</div></div>';
      $('#nav').replaceChildren();
      $('#nav-espacos').replaceChildren();
      UI.contexto = UI.contexto === 'local' ? 'remoto' : 'local';
      UI.espaco = 'todos';
      UI.conversa = UI.projeto = UI.mensagem = null;
      UI.aba = 'hoje';
      D.tarefas = D.pessoas = D.conversas = D.conversa = D.projeto = D.detalheOperacao = null;
      D.projetos = [];
      try {
        atualizarEndereco();
        await carregarBase();
        await carregarAba();
      } finally {
        UI.trocando = false;
      }
      return;
    }
    if (b.hasAttribute('data-hoje-filtro')) {
      UI.hojeFiltro = b.dataset.hojeFiltro;
      return desenhar();
    }
    if (b.hasAttribute('data-foco-captura')) return $('[data-rapida] [name=titulo]')?.focus();
    if (b.hasAttribute('data-novo-projeto')) return abrirGaveta(formProjeto());
    if (b.hasAttribute('data-desvincular')) {
      await api('DELETE', `/api/conversas/${D.conversa.id}/vinculos/${b.dataset.desvincular}`);
      avisar('Vínculo removido; a tarefa foi preservada');
      return carregarAba();
    }
    if (b.hasAttribute('data-projeto')) {
      UI.projeto = Number(b.dataset.projeto);
      return ir('projetos');
    }
    if (b.hasAttribute('data-editar-projeto')) return abrirGaveta(formProjeto(D.projeto));
    if (b.hasAttribute('data-voltar-projetos')) {
      UI.projeto = null;
      D.projeto = null;
      return ir('projetos');
    }
    if (b.hasAttribute('data-vista-tarefas')) {
      UI.vista = b.dataset.vistaTarefas;
      return desenhar();
    }
    if (b.hasAttribute('data-virar-tarefa') || b.hasAttribute('data-criar-mensagem'))
      return abrirGaveta(formConverter(Number(b.dataset.criarMensagem) || null));
    if (b.hasAttribute('data-vincular-mensagem'))
      return abrirVinculo(Number(b.dataset.vincularMensagem) || null);
    if (b.hasAttribute('data-origem')) {
      UI.mensagem = Number(b.dataset.mensagem) || null;
      UI.estado = 'todos';
      return ir('caixa', { conversa: b.dataset.origem });
    }
    if (b.hasAttribute('data-agendar-conversa')) return abrirGaveta(formAgendar(b.dataset.agendarConversa));
    if (b.hasAttribute('data-triar')) {
      D.conversa = await api('PATCH', `/api/conversas/${D.conversa.id}`, {
        triada: true,
        versao: D.conversa.versao,
      });
      return carregarAba();
    }
    if (b.hasAttribute('data-retomar')) {
      D.conversa = await api('PATCH', `/api/conversas/${D.conversa.id}`, {
        adiada_ate: null,
        cobrar_em: null,
        versao: D.conversa.versao,
      });
      return carregarAba();
    }
    if (b.hasAttribute('data-mais-mensagens')) {
      const c = D.conversa,
        antigas = await api('GET', `/api/conversas/${c.id}?antes=${c.mensagens[0].id}`);
      const y = $('.fio-msgs').scrollHeight;
      c.mensagens = [...antigas.mensagens, ...c.mensagens];
      c.tem_anteriores = antigas.tem_anteriores;
      desenhar();
      $('.fio-msgs').scrollTop = $('.fio-msgs').scrollHeight - y;
      return;
    }
    if (b.hasAttribute('data-mais-conversas')) {
      const mais = await api('GET', consultaCaixa() + '&antes=' + D.conversas.at(-1).id);
      UI.maisCaixa = mais.length === 50;
      D.conversas.push(...mais);
      return desenhar();
    }
    if (b.hasAttribute('data-fonte')) {
      UI.categoriaOperacao = b.dataset.categoria;
      D.detalheOperacao = await api(
        'GET',
        `/api/operacao/${encodeURIComponent(b.dataset.fonte)}/${encodeURIComponent(b.dataset.categoria)}`,
      );
      return desenhar();
    }
    if (b.hasAttribute('data-recarregar-operacao')) {
      D.detalheOperacao = null;
      return carregarAba();
    }
    if (b.hasAttribute('data-salvar-vista')) {
      const nome = prompt('Nome desta vista:');
      if (!nome?.trim()) return;
      const vs = lerVistas();
      vs.push({
        nome: nome.trim().slice(0, 60),
        espaco: UI.espaco,
        estado: UI.estado,
        canal: UI.canal,
        conta: UI.conta,
        projetoCaixa: UI.projetoCaixa,
      });
      salvarVistas(vs.slice(-10));
      return desenhar();
    }
    if (b.hasAttribute('data-vista-salva')) {
      const v = lerVistas()[Number(b.dataset.vistaSalva)];
      if (v) {
        Object.assign(UI, v);
        await carregarAba();
        desenharNav();
      }
      return;
    }
    if (b.hasAttribute('data-apagar-vista')) {
      salvarVistas(lerVistas().filter((_, i) => i !== Number(b.dataset.apagarVista)));
      return desenhar();
    }
  } catch (er) {
    falhou(er);
  }
}
function consultaCaixa() {
  const qs = new URLSearchParams({ estado: UI.estado, limite: '50' });
  for (const [k, v] of Object.entries({
    espaco: UI.espaco === 'todos' ? '' : UI.espaco,
    canal: UI.canal,
    conta: UI.conta,
    projeto: UI.projetoCaixa,
    q: UI.buscaCaixa,
  }))
    if (v) qs.set(k, v);
  return '/api/conversas?' + qs;
}
async function fluxoSubmit(e) {
  const f = e.target;
  if (!f.matches('[data-form-projeto],[data-converter],[data-vincular],[data-agendar]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const d = Object.fromEntries(new FormData(f));
  const button = f.querySelector('button[type=submit],button.primario');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    if (f.hasAttribute('data-form-projeto')) {
      if (d.versao) d.versao = Number(d.versao);
      else delete d.versao;
      const id = f.dataset.formProjeto,
        p = await api(id ? 'PATCH' : 'POST', '/api/projetos' + (id ? '/' + id : ''), d);
      fecharGaveta();
      UI.projeto = p.id;
      UI.espaco = p.espaco_id;
      await carregarBase();
      return ir('projetos');
    }
    if (f.hasAttribute('data-converter')) {
      await api('POST', `/api/conversas/${UI.converter.conversa}/tarefa`, {
        ...d,
        projeto_id: d.projeto_id ? Number(d.projeto_id) : null,
        mensagem_id: UI.converter.mensagem,
        operacao: UI.converter.operacao,
      });
      fecharGaveta();
      avisar('Tarefa criada e vinculada');
      await carregarAba();
      return atualizarContagens();
    }
    if (f.hasAttribute('data-vincular')) {
      await api('POST', `/api/conversas/${UI.vincular.conversa}/vinculos`, {
        tarefa_id: Number(d.tarefa_id),
        mensagem_id: UI.vincular.mensagem,
      });
      fecharGaveta();
      return carregarAba();
    }
    if (f.hasAttribute('data-agendar')) {
      await api('PATCH', `/api/conversas/${UI.agendar.conversa}`, {
        [UI.agendar.tipo]: instanteInput(d.quando),
        versao: UI.agendar.versao,
        triada: true,
      });
      fecharGaveta();
      UI.conversa = null;
      avisar('Agendamento salvo');
      return carregarAba();
    }
  } catch (er) {
    falhou(er);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
