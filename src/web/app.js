const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const ico = (n, cls = '') => `<svg class="ico ${cls}"><use href="#i-${n}"/></svg>`;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const FUSO = 'America/Sao_Paulo';
const diaIso = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: FUSO });
const hojeIso = () => diaIso();
const somarDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return diaIso(d);
};
const dataCurta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const hora = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
const quando = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO,
  });
// Hora na lista: hoje mostra a hora; ontem, "ontem"; antes, a data.
function horaLista(iso) {
  const d = diaIso(new Date(iso));
  if (d === hojeIso()) return hora(iso);
  if (d === somarDias(-1)) return 'ontem';
  return dataCurta(d);
}
// Há quanto tempo a pessoa espera: é isso que decide quem vem primeiro.
function espera(iso) {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60e3);
  const txt =
    min < 1
      ? 'agora'
      : min < 60
        ? `${Math.round(min)} min`
        : min < 1440
          ? `${Math.round(min / 60)} h`
          : `${Math.round(min / 1440)} d`;
  return { txt, cls: min >= 1440 ? 'velha' : min >= 240 ? 'morna' : '' };
}
function nomeDia(d) {
  if (d === hojeIso()) return 'Hoje';
  if (d === somarDias(-1)) return 'Ontem';
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return s[0].toUpperCase() + s.slice(1);
}
const NOME_STATUS = {
  'a-fazer': 'A fazer',
  fazendo: 'Fazendo',
  aguardando: 'Aguardando',
  feito: 'Feito',
  cancelado: 'Cancelado',
};
const TIPOS_CANAL = { email: 'E-mail', whatsapp: 'WhatsApp', telefone: 'Telefone', outro: 'Outro' };
const NOME_ESTADO = {
  responder: 'Responder',
  esperando: 'Esperando',
  resolvida: 'Resolvidas',
  arquivada: 'Arquivadas',
};
// 5562999990000 -> +55 62 99999-0000 (só para mostrar; o banco guarda os dígitos).
const fone = (d) => {
  const m = String(d).match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d;
};
const iniciais = (n) =>
  String(n || '?')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

const D = {
  hoje: null,
  espacos: [],
  todosEspacos: [],
  tarefas: null,
  pessoas: null,
  conversas: null,
  conversa: null,
  contas: null,
  tokens: null,
  sessoes: null,
  conectores: null,
  busca: null,
  vocab: { status: [], estados: [] },
  erro: null,
};
const UI = {
  aba: 'hoje',
  espaco: 'todos',
  filtro: 'abertas',
  estado: 'responder',
  busca: '',
  buscaTudo: '',
  conversa: null,
  tokenNovo: null,
  gaveta: null,
};
const ABAS = [
  'hoje',
  'caixa',
  'tarefas',
  'projetos',
  'pessoas',
  'espaco',
  'operacao',
  'espacos',
  'conexoes',
  'busca',
  'mais',
];
Object.assign(UI, {
  contexto: location.hash.includes('local=1') ? 'local' : 'remoto',
  projeto: null,
  vista: 'lista',
  filtroProjeto: '',
  canal: '',
  conta: '',
  projetoCaixa: '',
  buscaCaixa: '',
  mensagem: null,
});
Object.assign(D, { projetos: [], projeto: null, operacao: null, contasCaixa: [], detalheOperacao: null });
document.addEventListener('click', fluxoClique, true);
document.addEventListener('submit', fluxoSubmit, true);

// Caminhos relativos à página: a Central funciona tanto na raiz de um domínio quanto em /central/.
async function api(metodo, caminho, corpo, contexto = UI.contexto) {
  if (UI.trocando && metodo !== 'GET') throw new Error('Aguarde a troca de contexto.');
  if (contexto !== UI.contexto) throw new Error('O contexto mudou. Abra novamente a ação neste espaço.');
  const rota = contexto === 'local' ? caminho.replace(/^\/api\//, '/api/local/') : caminho;
  const r = await fetch(rota.slice(1), {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json', 'X-Central': '1' } : { 'X-Central': '1' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (contexto !== UI.contexto) throw new Error('O contexto mudou. A resposta anterior foi descartada.');
  if (r.status === 401 && !caminho.startsWith('/api/entrar') && !caminho.startsWith('/api/convite')) {
    mostrarEntrada();
    throw new Error('sessão encerrada');
  }
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}
const espacoPor = (id) => D.todosEspacos.find((e) => e.id === id) || { id, nome: id, cor: '#888888' };
const cor = (id) => `--cor:${esc(espacoPor(id).cor)}`;
const chipEspaco = (id) =>
  `<span class="chip"><span class="bolinha" style="${cor(id)}"></span>${esc(espacoPor(id).nome)}</span>`;
const nomeConversa = (c) =>
  c.pessoa_nome ||
  (c.canal === 'whatsapp' ? c.titulo || fone(c.endereco) : c.ultima?.autor || c.titulo || c.endereco);
const avatar = (nome, espaco, canal, g) =>
  `<div class="avatar${g ? ' g' : ''}" style="${cor(espaco)}">${esc(iniciais(nome))}${canal ? `<span class="canal ${canal}">${ico(canal === 'email' ? 'email' : 'whatsapp')}</span>` : ''}</div>`;

// ---------- Avisos (com desfazer) ----------
function avisar(texto, { erro = false, acao, fn, ms = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = 'aviso-t' + (erro ? ' erro' : '');
  el.innerHTML = `<span>${esc(texto)}</span>${acao ? `<button>${esc(acao)}</button>` : ''}`;
  const contextoAviso = UI.contexto;
  if (acao)
    el.querySelector('button').onclick = () => {
      el.remove();
      if (contextoAviso !== UI.contexto) return;
      Promise.resolve(fn()).catch(falhou);
    };
  $('#avisos').append(el);
  setTimeout(() => el.remove(), ms);
}
const falhou = (er) => avisar(er.message, { erro: true });

// ---------- Navegação ----------
function contagens() {
  const h = D.hoje?.espacos || [];
  const doEspaco = (e) => UI.espaco === 'todos' || e.espaco.id === UI.espaco;
  return {
    responder: h.filter(doEspaco).reduce((a, e) => a + e.conversas.responder, 0),
    esperando: h.filter(doEspaco).reduce((a, e) => a + e.conversas.esperando, 0),
    atrasadas: h.filter(doEspaco).reduce((a, e) => a + e.vencidas.length, 0),
    hoje: h.filter(doEspaco).reduce((a, e) => a + e.deHoje.length, 0),
    porEspaco: Object.fromEntries(h.map((e) => [e.espaco.id, e.conversas.responder])),
  };
}
function desenharNav() {
  const c = contagens();
  const tarefasN = c.atrasadas + c.hoje;
  const itens = [
    ['hoje', 'Hoje', 'hoje', ''],
    ['caixa', 'Caixa', 'caixa', c.responder],
    ['tarefas', 'Tarefas', 'tarefas', tarefasN],
    ['projetos', 'Projetos', 'camadas', ''],
    ['pessoas', 'Pessoas', 'pessoas', ''],
  ];
  $('#nav').innerHTML = itens
    .map(
      ([id, nome, i, n]) =>
        `<button class="nav-item" data-ir="${id}" ${UI.aba === id ? 'aria-current="page"' : ''}>${ico(i)}${nome}${n ? `<span class="n${id === 'caixa' ? ' quente' : ''}">${n}</span>` : ''}</button>`,
    )
    .join('');
  $('#nav-espacos').innerHTML = [{ id: 'todos', nome: 'Todos' }, ...D.espacos]
    .map(
      (
        e,
      ) => `<button class="nav-item" data-espaco="${esc(e.id)}" ${UI.espaco === e.id ? 'aria-current="true"' : ''}>
      ${e.id === 'todos' ? ico('camadas') : `<span class="bolinha" style="${cor(e.id)};margin:0 4.5px"></span>`}${esc(e.nome)}${(e.id === 'todos' ? c.responder : c.porEspaco[e.id]) ? `<span class="n">${e.id === 'todos' ? c.responder : c.porEspaco[e.id]}</span>` : ''}</button>`,
    )
    .join('');
  if ($('#contexto-origem'))
    $('#contexto-origem').innerHTML = D.operacao?.espaco_local
      ? `<button class="btn mini" data-trocar-contexto>${UI.contexto === 'local' ? 'Trabalho local · trocar' : 'Central pessoal · trocar'}</button>`
      : '';
  $('#abas-movel').innerHTML = [...itens.filter(([id]) => id !== 'pessoas'), ['mais', 'Mais', 'conexao', '']]
    .map(
      ([id, nome, i, n]) =>
        `<button data-ir="${id}" ${UI.aba === id || (id === 'mais' && ['conexoes', 'espacos', 'operacao', 'pessoas', 'espaco'].includes(UI.aba)) ? 'aria-current="page"' : ''}>${ico(i)}${nome}${n && id === 'caixa' ? `<span class="n">${n}</span>` : ''}</button>`,
    )
    .join('');
}
function ir(aba, { conversa = null } = {}) {
  UI.aba = aba;
  UI.conversa = conversa;
  if (!conversa || String(D.conversa?.id) !== String(conversa)) D.conversa = null;
  atualizarEndereco();
  fecharGaveta();
  desenharNav();
  desenhar();
  carregarAba();
  scrollTo({ top: 0 });
}

async function carregarBase() {
  try {
    [D.espacos, D.todosEspacos, D.vocab, D.hoje] = await Promise.all([
      api('GET', '/api/espacos'),
      api('GET', '/api/espacos?todos'),
      api('GET', '/api/vocabulario'),
      api('GET', '/api/hoje'),
    ]);
    D.projetos = await api('GET', '/api/projetos?todos=1');
    D.operacao = await api('GET', '/api/operacao').catch(() => ({ local: false, fontes: [] }));
    UI.hojeEm = Date.now();
  } catch (e) {
    D.erro = e.message;
  }
  desenharNav();
}
async function carregarAba(forcar) {
  const sequencia = (UI.carga = (UI.carga || 0) + 1);
  const conversaId = UI.conversa,
    mensagemId = UI.mensagem;
  const qs = UI.espaco === 'todos' ? '' : `espaco=${encodeURIComponent(UI.espaco)}`;
  try {
    const novos = {};
    if (['hoje', 'espaco'].includes(UI.aba))
      novos.hoje = await api('GET', '/api/hoje' + (forcar ? '?forcar' : ''));
    if (['tarefas', 'hoje', 'espaco', 'projetos', 'caixa'].includes(UI.aba))
      novos.projetos = await api('GET', '/api/projetos?todos=1');
    if (['tarefas', 'hoje', 'espaco'].includes(UI.aba))
      novos.tarefas = await api(
        'GET',
        `/api/tarefas?${qs}${UI.aba === 'tarefas' && UI.filtro === 'todas' ? '&todas' : ''}${UI.aba !== 'tarefas' ? '' : UI.filtroProjeto === 'sem' ? '&sem_projeto=1' : UI.filtroProjeto ? '&projeto=' + UI.filtroProjeto : ''}`,
      );
    if (['pessoas', 'tarefas', 'espaco'].includes(UI.aba))
      novos.pessoas = await api(
        'GET',
        `/api/pessoas?${qs}${UI.busca ? '&q=' + encodeURIComponent(UI.busca) : ''}`,
      );
    if (UI.aba === 'projetos')
      novos.projeto = UI.projeto ? await api('GET', '/api/projetos/' + UI.projeto) : null;
    if (UI.aba === 'caixa') {
      novos.conversas = await api('GET', consultaCaixa());
      UI.maisCaixa = novos.conversas.length === 50;
      novos.contasCaixa = await api('GET', '/api/contas').catch(() => []);
      novos.conversa = conversaId
        ? await api('GET', `/api/conversas/${conversaId}${mensagemId ? '?mensagem=' + mensagemId : ''}`)
        : null;
      if (sequencia !== UI.carga) return;
      if (novos.conversa && !novos.conversa.visto_em)
        novos.conversa = await api('PATCH', `/api/conversas/${novos.conversa.id}`, {
          visto_em: new Date().toISOString(),
          versao: novos.conversa.versao,
        });
    }
    if (UI.aba === 'operacao') novos.operacao = await api('GET', '/api/operacao');
    if (UI.aba === 'conexoes' && UI.contexto !== 'local')
      [novos.contas, novos.tokens, novos.sessoes, novos.conectores] = await Promise.all([
        api('GET', '/api/contas'),
        api('GET', '/api/tokens'),
        api('GET', '/api/sessoes'),
        api('GET', '/api/conectores'),
      ]);
    if (UI.aba === 'busca')
      novos.busca = await api('GET', `/api/busca?q=${encodeURIComponent(UI.buscaTudo)}${qs ? '&' + qs : ''}`);
    if (sequencia !== UI.carga) return;
    Object.assign(D, novos);
    if (novos.hoje) UI.hojeEm = Date.now();
    D.erro = null;
  } catch (e) {
    if (sequencia !== UI.carga) return;
    D.erro = e.message;
  }
  atualizarEndereco();
  desenharNav();
  desenhar();
}
const faixaErro = () => (D.erro ? `<div class="erro-faixa">${ico('alerta')} ${esc(D.erro)}</div>` : '');
function desenhar() {
  const f = {
    mais: desenharMais,
    projetos: desenharProjetos,
    espaco: desenharEspaco,
    operacao: desenharOperacao,
    hoje: desenharHoje,
    caixa: desenharCaixa,
    tarefas: desenharTarefas,
    pessoas: desenharPessoas,
    espacos: desenharEspacos,
    conexoes: desenharConexoes,
    busca: desenharBusca,
  }[UI.aba];
  $('#conteudo').innerHTML =
    UI.aba === 'conexoes' && UI.contexto === 'local'
      ? `<div class="pagina"><h1>Trabalho local</h1><p>As fontes locais são configuradas no gateway. Troque para Central pessoal para gerenciar e-mail e WhatsApp.</p></div>`
      : f();
  if (UI.aba === 'caixa') {
    const m = $('.fio-msgs');
    if (m) m.scrollTop = m.scrollHeight;
    if (UI.mensagem) document.getElementById('mensagem-' + UI.mensagem)?.scrollIntoView({ block: 'center' });
  }
}

// ---------- Hoje ----------
function desenharHoje() {
  return paginaHoje(D.hoje);
}
function formRapida(espaco, projeto) {
  const padrao = espaco || (UI.espaco !== 'todos' ? UI.espaco : D.espacos[0]?.id);
  const dia = UI.aba === 'hoje' ? hojeIso() : '';
  return `<form class="rapida" data-rapida>
    <div class="rapida-entrada"><input name="titulo" placeholder="Qual é o próximo passo?" required maxlength="200" aria-label="Nova tarefa" autocomplete="off"><button class="btn primario" type="submit" aria-label="Criar tarefa">${ico('mais')}<span>Adicionar</span></button></div>
    <div class="rapida-campos"><label>Espaço<select name="espaco" aria-label="Espaço">${D.espacos.map((e) => `<option value="${esc(e.id)}" ${e.id === padrao ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select></label>
    <label>Projeto<select name="projeto_id" aria-label="Projeto">${opcoesProjeto(padrao, projeto || (UI.filtroProjeto !== 'sem' && UI.aba === 'tarefas' ? UI.filtroProjeto : null), 'Sem projeto')}</select></label>
    <label>Planejar para<select name="proxima" aria-label="Quando">${[
      ['Sem dia planejado', ''],
      ['Hoje', hojeIso()],
      ['Amanhã', somarDias(1)],
      ['Em 7 dias', somarDias(7)],
    ]
      .map(([n, v]) => `<option value="${v}" ${dia === v ? 'selected' : ''}>${n}</option>`)
      .join('')}</select></label></div>
  </form>`;
}

// ---------- Tarefas ----------
function linhaTarefa(t) {
  const hoje = hojeIso();
  const atrasada = t.proxima && t.proxima < hoje && !t.concluido;
  return `<div class="tarefa ${t.concluido ? 'feita' : ''}">
    <button class="marcar ${t.concluido ? 'feito' : ''}" data-concluir="${t.id}" data-versao="${t.versao}" data-status="${t.status}" title="${t.concluido ? 'Reabrir' : 'Concluir'}" aria-label="${t.concluido ? 'Reabrir' : 'Concluir'}">${ico('check')}</button>
    <div class="txt toque" data-tarefa="${t.id}"><div class="t">${esc(t.titulo)}</div>
      <div class="meta">${UI.espaco === 'todos' ? chipEspaco(t.espaco_id) : ''}${t.status !== 'a-fazer' && !t.concluido ? `<span class="chip">${NOME_STATUS[t.status]}</span>` : ''}${t.pessoa_nome ? `<span class="chip">${ico('pessoas')} ${esc(t.pessoa_nome)}</span>` : ''}${t.anotacoes.length ? `<span class="chip">${ico('nota')} ${t.anotacoes.length}</span>` : ''}<span class="chip">${esc(t.projeto_nome || 'Sem projeto')}</span>${t.prioridade && t.prioridade !== 'normal' ? `<span class="chip">${esc(t.prioridade)}</span>` : ''}${t.prazo ? `<span class="chip">prazo ${dataCurta(t.prazo)}</span>` : ''}${t.origens?.length ? `<span class="chip">${t.origens.length} origem(ns)</span>` : ''}</div></div>
    <span class="quando ${atrasada ? 'atrasada' : ''}">${t.proxima ? (t.proxima === hoje ? 'hoje' : t.proxima === somarDias(1) ? 'amanhã' : dataCurta(t.proxima)) : ''}</span>
  </div>`;
}
function desenharTarefas() {
  const ts = D.tarefas;
  if (!ts) return `<div class="pagina">${faixaErro() || '<div class="vazio">Carregando…</div>'}</div>`;
  const hoje = hojeIso();
  const grupos = [
    ['Atrasadas', ts.filter((t) => t.proxima && t.proxima < hoje && !t.concluido), 'mal'],
    ['Hoje', ts.filter((t) => t.proxima === hoje && !t.concluido)],
    ['Próximos dias', ts.filter((t) => t.proxima && t.proxima > hoje && !t.concluido)],
    ['Sem data', ts.filter((t) => !t.proxima && !t.concluido)],
    ['Concluídas', ts.filter((t) => t.concluido)],
  ].filter(([, l]) => l.length);
  const abertas = ts.filter((t) => !t.concluido).length;
  return `<div class="pagina">
    <div class="cab"><div><h1>Tarefas</h1><p>${plural(abertas, 'aberta', 'abertas')}${UI.espaco === 'todos' ? ' em todos os espaços' : ' em ' + esc(espacoPor(UI.espaco).nome)}. Marque a caixinha para concluir; clique no texto para detalhar.</p></div>
      <div class="segmento"><button data-filtro="abertas" aria-pressed="${UI.filtro === 'abertas'}">Abertas</button><button data-filtro="todas" aria-pressed="${UI.filtro === 'todas'}">Com concluídas</button></div></div>
    ${faixaErro()}${contextoTopo()}${filtrosTarefas()}
    <section class="cartao">${formRapida()}
      ${
        UI.vista === 'quadro'
          ? quadroTarefas(ts)
          : grupos
              .map(
                ([titulo, lista, cls]) =>
                  `<div class="grupo-tit ${cls || ''}"><span>${titulo}</span><span>${lista.length}</span></div>${lista.map(linhaTarefa).join('')}`,
              )
              .join('') || '<div class="vazio"><b>Nenhuma tarefa</b>Escreva acima e aperte Enter.</div>'
      }
    </section>
  </div>`;
}
function gavetaTarefa(t) {
  return formTarefaCompleta(t);
}

// ---------- Pessoas ----------
function desenharPessoas() {
  const ps = D.pessoas;
  if (!ps) return `<div class="pagina">${faixaErro() || '<div class="vazio">Carregando…</div>'}</div>`;
  return `<div class="pagina">
    <div class="cab"><div><h1>Pessoas</h1><p>Uma pessoa, todos os canais dela. Conversa de quem está aqui cai sozinha no espaço certo.</p></div>
      <button class="btn primario" data-nova-pessoa>${ico('pessoa-mais')}Nova pessoa</button></div>
    ${faixaErro()}
    <div class="ferramentas"><label class="buscar">${ico('buscar')}<input name="busca-pessoas" placeholder="Nome, e-mail ou número" value="${esc(UI.busca)}" autocomplete="off"></label><span class="pequeno">${plural(ps.length, 'pessoa', 'pessoas')}</span></div>
    <div class="pessoas-grade">${
      ps
        .map(
          (p) => `<div class="cartao pessoa toque" data-pessoa="${p.id}">
        ${avatar(p.nome, p.espacos[0]?.id)}
        <div style="min-width:0;flex:1"><h3>${esc(p.nome)}</h3>
          <div class="canais">${
            p.canais
              .slice(0, 3)
              .map(
                (c) =>
                  `<span>${ico(c.tipo === 'email' ? 'email' : 'whatsapp')}${esc(c.tipo === 'email' || c.tipo === 'outro' ? c.valor : fone(c.valor))}</span>`,
              )
              .join('') || '<span>sem canal</span>'
          }</div>
          <div class="meta">${p.espacos.map((e) => chipEspaco(e.id)).join('')}</div></div>
      </div>`,
        )
        .join('') ||
      '<div class="cartao vazio" style="grid-column:1/-1"><b>Ninguém aqui ainda</b>Na caixa, “Cadastrar pessoa” cria a partir de uma conversa.</div>'
    }</div>
  </div>`;
}
const linhaCanal = (c) => `<div class="canal-linha"><select aria-label="Tipo">${Object.entries(TIPOS_CANAL)
  .map(([k, n]) => `<option value="${k}" ${k === c.tipo ? 'selected' : ''}>${n}</option>`)
  .join('')}</select>
  <input value="${esc(c.valor)}" placeholder="e-mail ou número com DDD" aria-label="Valor"><button type="button" class="btn fantasma" data-tirar-canal aria-label="Tirar">${ico('fechar')}</button></div>`;
function gavetaPessoa(p) {
  const meus = new Set(p.espacos.map((e) => e.id));
  return `<div class="gaveta-cab"><h2>${p.id ? esc(p.nome) : 'Nova pessoa'}</h2><button class="btn fantasma" data-fechar aria-label="Fechar">${ico('fechar')}</button></div>
  <form class="form" data-form-pessoa="${p.id || ''}">
    <label>Nome<input name="nome" value="${esc(p.nome)}" maxlength="120" required></label>
    <div><label>Espaços</label><div class="opcoes">${D.espacos.map((e) => `<button type="button" data-espaco-pessoa="${esc(e.id)}" aria-pressed="${meus.has(e.id)}"><span class="bolinha" style="${cor(e.id)}"></span>${esc(e.nome)}</button>`).join('')}</div></div>
    <div><label>Canais</label><div class="form lista-canais" style="gap:8px;margin-top:6px">${p.canais.map(linhaCanal).join('')}</div>
      <button type="button" class="btn mini" data-mais-canal style="margin-top:8px">${ico('mais')}Canal</button></div>
    <label>Notas<textarea name="notas">${esc(p.notas)}</textarea></label>
    <div style="display:flex;gap:10px"><button class="btn primario">Salvar</button>${p.id ? '<button type="button" class="btn perigo" data-apagar-pessoa>Apagar</button>' : ''}</div>
  </form>`;
}

// ---------- Espaços ----------
function desenharEspacos() {
  const linha = (
    e,
    novo,
  ) => `<form class="cartao" data-form-espaco style="padding:16px;display:grid;gap:12px">
    <div style="display:flex;gap:10px;align-items:center"><input name="cor" type="color" value="${esc(e.cor)}" aria-label="Cor" style="width:44px;height:38px;padding:3px">
      <input name="nome" value="${esc(e.nome)}" placeholder="${novo ? 'Nome do espaço novo' : 'Nome'}" aria-label="Nome" required></div>
    <div class="duas-col"><label>Id<input name="id" value="${esc(e.id)}" ${novo ? 'placeholder="ex.: loja" required pattern="[a-z0-9][a-z0-9-]{0,29}"' : 'readonly'}></label>
      <label>Ordem<input name="ordem" type="number" value="${e.ordem}"></label></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="arquivado" ${e.arquivado ? 'checked' : ''} style="width:auto">arquivado</label>
      <button class="btn ${novo ? 'primario' : ''}">${novo ? 'Criar espaço' : 'Salvar'}</button></div>
  </form>`;
  return `<div class="pagina">
    <div class="cab"><div><h1>Espaços</h1><p>Um por empresa ou vida. O que é de um espaço não aparece nos outros. Espaço não se apaga: arquiva.</p></div></div>
    <div class="espacos-grade">${D.todosEspacos.map((e) => linha(e, false)).join('')}${linha({ id: '', nome: '', cor: '#5eead4', ordem: D.todosEspacos.length, arquivado: 0 }, true)}</div>
  </div>`;
}

// ---------- Caixa ----------
function desenharCaixa() {
  const cs = D.conversas;
  const c = D.conversa;
  const n = contagens();
  const lista = !cs
    ? '<div class="vazio">Carregando…</div>'
    : cs
        .map(
          (
            x,
          ) => `<div class="item toque" data-abrir-conversa="${x.id}" ${String(UI.conversa) === String(x.id) ? 'aria-current="true"' : ''}>
      ${avatar(nomeConversa(x), x.espaco_id, x.canal)}
      <div class="txt"><div class="l1"><span class="nome">${esc(nomeConversa(x))}</span><span class="hora">${horaLista(x.ultima_em)}</span>${!x.visto_em ? '<span class="nao-vista" title="Ainda não vista na Central"></span>' : ''}</div>
        <div class="prev">${x.canal === 'email' && x.titulo ? `<b>${esc(x.titulo)}</b> · ` : ''}${x.ultima?.de_mim ? '<b>Você:</b> ' : ''}${esc(x.ultima?.texto || x.ultima?.assunto || '')}</div>
        ${UI.espaco === 'todos' || x.nota || x.tarefa_id ? `<div class="meta">${UI.espaco === 'todos' ? chipEspaco(x.espaco_id) : ''}${x.nota ? `<span class="chip">${ico('nota')} nota</span>` : ''}${x.tarefa_id ? `<span class="chip">${ico('tarefas')} tarefa</span>` : ''}</div>` : ''}</div>
    </div>`,
        )
        .join('') ||
      `<div class="vazio"><b>${UI.estado === 'responder' ? 'Nada para responder' : 'Vazio'}</b>${UI.estado === 'responder' ? 'Você está em dia nesta caixa.' : ''}</div>`;
  const contar = { responder: n.responder, esperando: n.esperando };
  return `${faixaErro() ? `<div style="padding:12px 16px 0">${faixaErro()}</div>` : ''}<div class="caixa ${c ? 'aberta' : ''}">
    <section class="lista">
      ${filtrosCaixa()}
      <div class="itens" id="itens">${lista}${UI.maisCaixa ? '<button class="btn carregar-mais" data-mais-conversas>Carregar mais conversas</button>' : ''}</div>
      <div class="atalhos-dica"><span><span class="kbd">J</span> <span class="kbd">K</span> navegar</span><span><span class="kbd">E</span> resolvido</span><span><span class="kbd">R</span> responder</span><span><span class="kbd">T</span> virar tarefa</span></div>
    </section>
    <section class="conversa">${c ? painelConversa(c) : `<div class="nada-aberto"><div>${ico('whatsapp')}<b>Escolha uma conversa</b>Responda pelo app dela, volte e marque como resolvida.<br>Se você responder pelo celular, ela vai sozinha para “Esperando”.</div></div>`}</section>
  </div>`;
}
function painelConversa(c) {
  const nome = nomeConversa(c);
  const r = c.responder;
  const dias = [];
  for (const m of c.mensagens) {
    const d = diaIso(new Date(m.em));
    if (!dias.length || dias.at(-1).d !== d) dias.push({ d, ms: [] });
    dias.at(-1).ms.push(m);
  }
  const bolha = (m) => {
    const longo = (m.texto || '').length > 700;
    return `<div id="mensagem-${m.id}" class="bolha ${m.de_mim ? 'minha' : ''} ${Number(UI.mensagem) === m.id ? 'destacada' : ''}">
      ${!m.de_mim && c.canal === 'email' && m.autor ? `<div class="autor">${esc(m.autor)}</div>` : ''}
      ${m.assunto && c.canal === 'email' ? `<div class="assunto">${esc(m.assunto)}</div>` : ''}
      <div class="texto ${longo ? 'longo' : ''}">${m.texto ? esc(m.texto) : '<span class="apagado">texto apagado pela retenção ou sem texto</span>'}</div>
      ${longo ? '<button class="mais" data-ler-tudo>ler tudo</button>' : ''}
      <div class="hr">${hora(m.em)}</div><div class="acoes-mensagem"><button data-criar-mensagem="${m.id}">Criar tarefa</button><button data-vincular-mensagem="${m.id}">Vincular tarefa</button></div></div>`;
  };
  const resolvida = c.estado === 'resolvida';
  return `<div class="conv-cab">
      <button class="btn fantasma voltar" data-fechar-conversa aria-label="Voltar">${ico('voltar')}</button>
      <div class="quem">${avatar(nome, c.espaco_id, c.canal, true)}
        <div style="min-width:0"><h2>${esc(nome)}</h2>
          <div class="sub"><span>${c.canal === 'email' ? 'E-mail' : 'WhatsApp'}${c.endereco ? ' · ' + esc(c.canal === 'email' ? c.endereco : fone(c.endereco)) : ''}</span>
            <select data-mover aria-label="Espaço da conversa" style="${cor(c.espaco_id)}">${D.espacos.map((e) => `<option value="${esc(e.id)}" ${e.id === c.espaco_id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}</select>
            ${c.pessoa_id ? '' : `<button class="btn mini fantasma" data-cadastrar-pessoa>${ico('pessoa-mais')}cadastrar</button>`}</div></div></div>
      <div class="acoes-conv">
        ${r ? `<a class="btn ${r.app === 'WhatsApp' ? 'wa' : 'primario'}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-responder>${ico(r.app === 'WhatsApp' ? 'whatsapp' : 'email')}Responder no ${esc(r.app)}<span class="kbd">R</span></a>` : ''}
        ${resolvida ? `<button class="btn" data-mudar-estado="responder">${ico('atualizar')}Reabrir</button>` : `<button class="btn" data-mudar-estado="resolvida">${ico('check')}Resolvido<span class="kbd">E</span></button>`}
        <button class="btn fantasma secundaria" data-mudar-estado="esperando" ${c.estado === 'esperando' ? 'hidden' : ''}>${ico('relogio')}Esperando</button>
        <button class="btn fantasma secundaria" data-virar-tarefa>${ico('tarefas')}Criar tarefa</button><button class="btn fantasma secundaria" data-agendar-conversa="adiada_ate">Adiar</button><button class="btn fantasma secundaria" data-agendar-conversa="cobrar_em">Cobrar depois</button>${!c.triada ? '<button class="btn fantasma secundaria" data-triar>Marcar triada</button>' : ''}${c.adiada_ate || c.cobrar_em ? '<button class="btn fantasma secundaria" data-retomar>Retomar agora</button>' : ''}
        <button class="btn fantasma secundaria" data-mudar-estado="arquivada" title="Arquivar">${ico('arquivo')}<span class="so-movel">Arquivar</span></button>
      </div>
    </div>
    <div class="fio-msgs">${c.tem_anteriores ? '<button class="btn carregar-mais" data-mais-mensagens>Mensagens anteriores</button>' : ''}${dias.map((d) => `<div class="dia">${nomeDia(d.d)}</div>${d.ms.map(bolha).join('')}`).join('')}</div>
    ${contextoConversa(c)}<div class="conv-pe">
      <textarea data-nota data-conversa="${c.id}" data-versao="${c.versao}" data-contexto="${UI.contexto}" placeholder="Nota interna (só você vê)" maxlength="4000">${esc(c.nota)}</textarea>
      <div class="dica"><span>${ico('cadeado')} A Central só lê: para responder, use o botão, que abre o ${esc(r?.app || 'app')} já nesta conversa.</span><span id="nota-salva"></span></div>
    </div>`;
}

// Muda o estado, avisa com "desfazer" e já abre a próxima da fila.
async function mudarEstado(estado) {
  const c = D.conversa;
  if (!c) return;
  const antes = c.estado,
    id = c.id;
  const idx = (D.conversas || []).findIndex((x) => x.id === id);
  let versaoNova;
  try {
    const nova = await api('PATCH', `/api/conversas/${id}`, { estado, versao: c.versao });
    versaoNova = nova.versao;
  } catch (er) {
    return falhou(er);
  }
  const proxima = estado !== UI.estado ? D.conversas[idx + 1] || D.conversas[idx - 1] : null;
  UI.conversa =
    estado !== UI.estado ? (matchMedia('(max-width: 900px)').matches ? null : (proxima?.id ?? null)) : id;
  atualizarEndereco();
  avisar(
    `${esc(nomeConversa(c))}: ${{ resolvida: 'resolvida', esperando: 'esperando o outro lado', arquivada: 'arquivada', responder: 'reaberta' }[estado]}`,
    {
      acao: 'Desfazer',
      fn: async () => {
        try {
          await api('PATCH', `/api/conversas/${id}`, { estado: antes, versao: versaoNova });
          UI.conversa = id;
          await atualizarContagens();
          await carregarAba();
        } catch (er) {
          falhou(er);
        }
      },
    },
  );
  await atualizarContagens();
  await carregarAba();
}
// Os números da barra e das abas vêm do /api/hoje.
async function atualizarContagens() {
  try {
    D.hoje = await api('GET', '/api/hoje');
    UI.hojeEm = Date.now();
    desenharNav();
  } catch {}
}
async function salvarNota(el) {
  const id = Number(el.dataset.conversa),
    contexto = el.dataset.contexto,
    nota = el.value;
  if (!id || contexto !== UI.contexto || nota === el.defaultValue) return;
  if (el.salvando) return;
  el.salvando = true;
  let salvou = false;
  try {
    const c = await api(
      'PATCH',
      `/api/conversas/${id}`,
      { nota, versao: Number(el.dataset.versao) },
      contexto,
    );
    el.defaultValue = nota;
    el.dataset.versao = String(c.versao);
    salvou = true;
    if (D.conversa?.id === id && UI.conversa == id && contexto === UI.contexto) {
      D.conversa.nota = nota;
      D.conversa.versao = c.versao;
      const atual = $('[data-nota]');
      if (atual?.dataset.conversa === String(id)) atual.dataset.versao = String(c.versao);
      const s = $('#nota-salva');
      if (s) s.textContent = 'nota salva';
    }
  } catch (er) {
    falhou(er);
  } finally {
    el.salvando = false;
  }
  if (salvou && el.value !== el.defaultValue) return salvarNota(el);
}

// ---------- Conexões ----------
// "Mozilla/5.0 (Linux; Android 14…) … Chrome/131…" -> "Chrome no Android"
function aparelho(ua = '') {
  const nav = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Navegador';
  const so = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return so ? `${nav} no ${so}` : nav;
}
function estadoWa(c) {
  const e = c.estado || {};
  const visto = e.visto ? Date.now() - Date.parse(e.visto) < 2 * 60e3 : false;
  if (e.restricao) return ['mal', e.restricao];
  if (!visto) return ['mal', 'o servidor não tem processo do WhatsApp ligado a esta conta'];
  if (e.conectado) return ['bom', `conectado${c.endereco ? ' · ' + fone(c.endereco) : ''}`];
  return [
    'aviso',
    e.erro || (e.codigo ? 'esperando você digitar o código no celular' : 'desconectado: pareie abaixo'),
  ];
}
function desenharConexoes() {
  if (!D.contas) return `<div class="pagina">${faixaErro() || '<div class="vazio">Carregando…</div>'}</div>`;
  const emails = D.contas.filter((c) => c.tipo === 'email');
  const was = D.contas.filter((c) => c.tipo === 'whatsapp');
  const opcoesEspaco = (sel) =>
    D.espacos
      .map((e) => `<option value="${esc(e.id)}" ${e.id === sel ? 'selected' : ''}>${esc(e.nome)}</option>`)
      .join('');
  const tokenDe = (escopo) => D.tokens.find((t) => t.escopo === escopo && !t.revogado);
  return `<div class="pagina">
    <div class="cab"><div><h1>Conexões</h1><p>De onde a Central lê. Tudo só leitura: nada é enviado, marcado como lido ou apagado na origem.</p></div></div>
    ${faixaErro()}
    ${
      UI.tokenNovo
        ? `<section class="cartao" style="margin-bottom:16px;padding:16px;display:grid;gap:10px;border-color:var(--acento)"><b>Token novo (${esc(UI.tokenNovo.registro.escopo)}): aparece só agora</b>
      <div class="segredo">${esc(UI.tokenNovo.token)}</div><span class="pequeno">Copie para onde ele vai ser usado. Ele não fica legível em lugar nenhum.</span></section>`
        : ''
    }
    <div class="conexoes">
    <section class="cartao"><div class="cartao-cab"><h2>${ico('whatsapp')}WhatsApp</h2><small>aparelho conectado, só leitura</small></div>
      ${
        was
          .map((c) => {
            const [luz, txt] = estadoWa(c);
            const t = tokenDe('whatsapp:' + c.id);
            return `<div class="conta"><span class="luz ${luz}"></span>
        <div class="txt"><h3>${esc(c.nome)} ${chipEspaco(c.espaco_id)}</h3><p>${esc(txt)}${t ? '' : ' · falta o token do processo'}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${c.estado?.conectado ? `<button class="btn perigo" data-wa-desligar="${esc(c.id)}">Desligar</button>` : ''}
          ${t ? '' : `<button class="btn" data-token="whatsapp:${esc(c.id)}" data-token-nome="WhatsApp ${esc(c.nome)}">Gerar token</button>`}
          <button class="btn fantasma perigo" data-apagar-conta="${esc(c.id)}" title="Apagar">${ico('fechar')}</button></div></div>
        ${
          c.estado?.conectado
            ? ''
            : c.estado?.codigo
              ? `<div class="passo-wa"><span>No celular: <b>WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número de telefone</b>, e digite:</span><div class="codigo-par">${esc(c.estado.codigo)}</div><span class="pequeno">Vale por alguns minutos. Se expirar, a tela avisa e você pede outro.</span></div>`
              : `<form class="passo-wa" data-parear="${esc(c.id)}"><span>Para conectar, digite o seu número (com 55 e DDD) e peça o código:</span>
            <div style="display:flex;gap:8px"><input name="numero" inputmode="numeric" placeholder="5562999990000" required pattern="[0-9]{12,13}"><button class="btn wa">Gerar código</button></div></form>`
        }`;
          })
          .join('') || '<div class="vazio">Nenhum número ligado.</div>'
      }
      <details class="adicionar"><summary>${ico('mais')}Ligar outro número</summary>
        <form class="form" data-form-wa><div class="duas-col"><label>Nome<input name="nome" placeholder="Meu WhatsApp" required maxlength="60"></label>
          <label>Espaço padrão<select name="espaco_id">${opcoesEspaco(D.espacos[0]?.id)}</select></label></div>
          <label>Id curto<input name="id" placeholder="ex.: meu-whats" required pattern="[a-z0-9][a-z0-9-]{1,29}"></label>
          <span class="pequeno">Conversa de quem está cadastrado vai para o espaço da pessoa; o resto cai no espaço padrão. Grupos ficam de fora. WhatsApp não oficial pode ser restringido: use um número seu.</span>
          <div><button class="btn primario">Ligar número</button></div></form></details>
    </section>

    <section class="cartao"><div class="cartao-cab"><h2>${ico('email')}E-mail</h2><small>IMAP com TLS, só leitura</small></div>
      ${
        emails
          .map(
            (
              c,
            ) => `<div class="conta"><span class="luz ${c.erro ? 'mal' : c.lida_em ? 'bom' : 'aviso'}"></span>
        <div class="txt"><h3>${esc(c.nome)} ${chipEspaco(c.espaco_id)}</h3><p>${esc(c.endereco)} · ${c.erro ? esc(c.erro) : c.lida_em ? 'lida ' + quando(c.lida_em) : 'ainda não lida'}${c.ativa ? '' : ' · pausada'}</p></div>
        <div style="display:flex;gap:8px"><button class="btn" data-ler-conta="${esc(c.id)}">${ico('atualizar')}Ler agora</button><button class="btn fantasma perigo" data-apagar-conta="${esc(c.id)}" title="Apagar">${ico('fechar')}</button></div></div>`,
          )
          .join('') || '<div class="vazio">Nenhuma caixa ligada.</div>'
      }
      <details class="adicionar" ${emails.length ? '' : 'open'}><summary>${ico('mais')}Ligar um e-mail</summary>
        <form class="form" data-form-email>
          <div class="duas-col"><label>Nome<input name="nome" placeholder="Gmail pessoal" required maxlength="60"></label>
            <label>Espaço<select name="espaco_id">${opcoesEspaco(UI.espaco !== 'todos' ? UI.espaco : D.espacos[0]?.id)}</select></label></div>
          <label>E-mail<input name="usuario" type="email" required autocomplete="off" placeholder="voce@gmail.com"></label>
          <label>Senha de app<input name="senha" type="password" required autocomplete="new-password"></label>
          <div class="duas-col"><label>Servidor IMAP<input name="host" value="imap.gmail.com" required></label><label>Id curto<input name="id" placeholder="ex.: gmail" required pattern="[a-z0-9][a-z0-9-]{1,29}"></label></div>
          <div class="duas-col"><label>Pasta de entrada<input name="pasta" value="INBOX" required></label><label>Pasta Enviados (opcional)<input name="pasta_enviados" placeholder="Nome exato no servidor"></label></div><p class="pequeno">Configure Enviados para a Central também reconhecer respostas feitas no seu aplicativo. Sem essa pasta, a coleta acompanha apenas a entrada.</p>
          <span class="pequeno">No Gmail: Conta Google → Segurança → Verificação em duas etapas → <b>Senhas de app</b>. A senha vai cifrada e não volta para a tela.</span>
          <div><button class="btn primario">Ligar e-mail</button></div></form></details>
    </section>

    <section class="cartao"><div class="cartao-cab"><h2>${ico('raio')}Painéis que mandam resumo</h2></div>
      ${
        D.conectores
          .map((c) => {
            const t = tokenDe('fonte:' + c.id);
            return `<div class="conta"><span class="luz ${c.tipo !== 'resumo-push' || (t && t.usado) ? 'bom' : 'aviso'}"></span><div class="txt"><h3>${esc(c.nome)} ${chipEspaco(c.espaco)}</h3>
        <p>${c.tipo === 'resumo-push' ? (t ? (t.usado ? 'último envio ' + quando(t.usado) : 'token criado, ainda sem envio') : 'sem token') : 'lido pela Central'}</p></div>
        ${c.tipo === 'resumo-push' && !t ? `<button class="btn" data-token="fonte:${esc(c.id)}" data-token-nome="${esc(c.nome)}">Gerar token</button>` : ''}</div>`;
          })
          .join('') || '<div class="vazio">Nenhum painel configurado.</div>'
      }
    </section>

    <section class="cartao"><div class="cartao-cab"><h2>${ico('escudo')}Segurança</h2><small>${plural(D.sessoes.length, 'sessão aberta', 'sessões abertas')}</small></div>
      ${D.sessoes.map((x) => `<div class="conta"><span class="luz bom"></span><div class="txt"><h3 class="mono" style="font-size:14px">${esc(x.ip || 'local')}</h3><p>${esc(aparelho(x.agente))} · visto ${quando(x.visto)}</p></div></div>`).join('')}
      <details class="adicionar"><summary>${ico('cadeado')}Tokens de máquina (${D.tokens.filter((t) => !t.revogado).length} ativos)</summary>
        <div class="form">${D.tokens
          .map(
            (
              t,
            ) => `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border-top:1px solid var(--fio);padding-top:10px">
          <div><b style="font-weight:500">${esc(t.nome)}</b> <span class="pequeno mono">#${t.id} ${esc(t.escopo)}</span><div class="pequeno">${t.usado ? 'usado ' + quando(t.usado) : 'nunca usado'}${t.revogado ? ' · revogado' : ''}</div></div>
          ${t.revogado ? '' : `<button class="btn mini perigo" data-revogar="${t.id}">Revogar</button>`}</div>`,
          )
          .join('')}
          <div><button class="btn mini" data-token="leitura" data-token-nome="MCP (assistente)">${ico('mais')}Token de leitura para o MCP</button></div></div></details>
      <div class="conta"><div class="txt"><p>Perdeu o celular ou desconfia de algo?</p></div><button class="btn perigo" data-sair-todas>Sair de todas as sessões</button></div>
    </section>
    </div>
  </div>`;
}

// ---------- Busca ----------
function desenharBusca() {
  const b = D.busca;
  if (!b) return `<div class="pagina">${faixaErro() || '<div class="vazio">Buscando…</div>'}</div>`;
  const marcar = (t) =>
    esc(t)
      .replace(/\u0002/g, '<mark>')
      .replace(/\u0003/g, '</mark>');
  const total = b.conversas.length + b.tarefas.length + b.pessoas.length;
  return `<div class="pagina busca-res">
    <div class="cab"><div><h1>“${esc(UI.buscaTudo)}”</h1><p>${plural(total, 'resultado', 'resultados')} em mensagens, tarefas e pessoas de todos os espaços.</p></div></div>
    ${faixaErro()}
    <section class="cartao">
    ${
      b.conversas.length
        ? `<div class="grupo-tit"><span>Mensagens</span><span>${b.conversas.length}</span></div>${b.conversas
            .map(
              (
                c,
              ) => `<div class="fila-item toque" data-abrir-conversa="${c.id}" data-estado-conversa="${esc(c.estado)}" data-espaco-conversa="${esc(c.espaco_id)}">
      ${avatar(c.pessoa_nome || c.titulo, c.espaco_id, c.canal)}<div class="txt"><div class="nome"><span>${esc(c.pessoa_nome || c.titulo)}</span></div><div class="prev">${marcar(c.trecho)}</div></div><span class="idade">${horaLista(c.em)}</span></div>`,
            )
            .join('')}`
        : ''
    }
    ${b.tarefas.length ? `<div class="grupo-tit"><span>Tarefas</span><span>${b.tarefas.length}</span></div>${b.tarefas.map((t) => `<div class="fila-item toque" data-tarefa="${t.id}"><div class="txt"><div class="nome"><span>${esc(t.titulo)}</span></div><div class="prev">${NOME_STATUS[t.status]}${t.proxima ? ' · ' + dataCurta(t.proxima) : ''}</div></div>${chipEspaco(t.espaco_id)}</div>`).join('')}` : ''}
    ${b.pessoas.length ? `<div class="grupo-tit"><span>Pessoas</span><span>${b.pessoas.length}</span></div>${b.pessoas.map((p) => `<div class="fila-item toque" data-pessoa="${p.id}">${avatar(p.nome, p.espacos?.[0]?.id)}<div class="txt"><div class="nome"><span>${esc(p.nome)}</span></div></div></div>`).join('')}` : ''}
    ${total ? '' : '<div class="vazio"><b>Nada encontrado</b>A busca ignora acentos; tente uma palavra só.</div>'}
    </section></div>`;
}

// ---------- Gaveta ----------
function abrirGaveta(html) {
  $('#gaveta-painel').innerHTML = html;
  $('#gaveta').hidden = false;
  $('#gaveta-painel input, #gaveta-painel textarea')?.focus();
}
function fecharGaveta() {
  $('#gaveta').hidden = true;
  $('#gaveta-painel').innerHTML = '';
  UI.gaveta = null;
}
async function abrirTarefa(id) {
  try {
    if (!D.pessoas) D.pessoas = await api('GET', '/api/pessoas');
    const t = await api('GET', '/api/tarefas/' + id);
    if (t) {
      UI.gaveta = { tipo: 'tarefa', id: t.id };
      abrirGaveta(gavetaTarefa(t));
    }
  } catch (er) {
    falhou(er);
  }
}
async function abrirPessoa(id) {
  try {
    const p =
      (D.pessoas || []).find((x) => String(x.id) === String(id)) ||
      (await api('GET', '/api/pessoas')).find((x) => String(x.id) === String(id));
    if (p) {
      const timeline = await carregarTimeline(p);
      UI.gaveta = { tipo: 'pessoa', id: p.id };
      abrirGaveta(gavetaPessoa(p) + timeline);
    }
  } catch (er) {
    falhou(er);
  }
}

// ---------- Cliques ----------
document.addEventListener('click', async (e) => {
  const alvo = (s) => e.target.closest(s);
  if (alvo('[data-fechar]')) return fecharGaveta();
  if (alvo('a[href]')) return;
  const irPara = alvo('[data-ir]');
  if (irPara) {
    if (irPara.dataset.ir === 'projetos') {
      UI.projeto = null;
      D.projeto = null;
    }
    return ir(irPara.dataset.ir);
  }
  if (alvo('[data-ir-caixa]')) {
    UI.estado = alvo('[data-ir-caixa]').dataset.irCaixa;
    return ir('caixa');
  }
  if (alvo('[data-espaco]') && !alvo('#gaveta')) {
    UI.espaco = alvo('[data-espaco]').dataset.espaco;
    UI.conversa = null;
    UI.projeto = null;
    UI.filtroProjeto = '';
    return ir(UI.espaco === 'todos' ? 'hoje' : 'espaco');
  }
  if (alvo('[data-atualizar]')) {
    avisar('Lendo tudo de novo…', { ms: 2000 });
    return carregarAba(true);
  }
  if (alvo('[data-filtro]')) {
    UI.filtro = alvo('[data-filtro]').dataset.filtro;
    return carregarAba();
  }
  if (alvo('[data-estado]')) {
    UI.estado = alvo('[data-estado]').dataset.estado;
    UI.conversa = null;
    UI.mensagem = null;
    atualizarEndereco();
    return carregarAba();
  }
  const abrirConv = alvo('[data-abrir-conversa]');
  if (abrirConv) {
    if (abrirConv.dataset.estadoConversa) UI.estado = abrirConv.dataset.estadoConversa;
    if (abrirConv.dataset.espacoConversa && UI.espaco !== 'todos')
      UI.espaco = abrirConv.dataset.espacoConversa;
    if (UI.aba !== 'caixa') return ir('caixa', { conversa: abrirConv.dataset.abrirConversa });
    UI.conversa = abrirConv.dataset.abrirConversa;
    UI.mensagem = null;
    atualizarEndereco();
    $$('.item').forEach((i) => i.toggleAttribute('aria-current', i.dataset.abrirConversa === UI.conversa));
    return carregarAba();
  }
  if (alvo('[data-fechar-conversa]')) {
    UI.conversa = null;
    D.conversa = null;
    UI.mensagem = null;
    atualizarEndereco();
    return desenhar();
  }
  if (alvo('[data-mudar-estado]')) return mudarEstado(alvo('[data-mudar-estado]').dataset.mudarEstado);
  if (alvo('[data-ler-tudo]')) {
    const b = alvo('.bolha');
    b.querySelector('.texto').classList.remove('longo');
    alvo('[data-ler-tudo]').remove();
    return;
  }
  if (alvo('[data-virar-tarefa]')) {
    try {
      const t = await api('POST', `/api/conversas/${D.conversa.id}/tarefa`, {});
      avisar('Virou tarefa', { acao: 'Abrir', fn: () => abrirTarefa(t.id) });
    } catch (er) {
      return falhou(er);
    }
    return carregarAba();
  }
  if (alvo('[data-cadastrar-pessoa]')) {
    const c = D.conversa;
    UI.gaveta = { tipo: 'pessoa', id: null };
    return abrirGaveta(
      gavetaPessoa({
        nome: c.canal === 'email' ? c.mensagens.find((m) => !m.de_mim)?.autor || '' : c.titulo || '',
        notas: '',
        espacos: [{ id: c.espaco_id }],
        canais: c.endereco ? [{ tipo: c.canal === 'email' ? 'email' : 'whatsapp', valor: c.endereco }] : [],
      }),
    );
  }
  const conc = alvo('[data-concluir]');
  if (conc) {
    const id = Number(conc.dataset.concluir);
    const feito = conc.classList.contains('feito');
    conc.classList.toggle('feito', !feito);
    try {
      const antes = conc.dataset.status;
      const atual = await api('PATCH', `/api/tarefas/${id}`, {
        status: feito ? 'a-fazer' : 'feito',
        versao: Number(conc.dataset.versao),
      });
      if (!feito)
        avisar('Tarefa concluída', {
          acao: 'Desfazer',
          fn: async () => {
            await api('PATCH', `/api/tarefas/${id}`, { status: antes, versao: atual.versao });
            await carregarAba();
            await atualizarContagens();
          },
        });
    } catch (er) {
      falhou(er);
    }
    await carregarAba();
    return atualizarContagens();
  }
  const tar = alvo('[data-tarefa]');
  if (tar) return abrirTarefa(tar.dataset.tarefa);
  const pes = alvo('[data-pessoa]');
  if (pes) return abrirPessoa(pes.dataset.pessoa);
  if (alvo('[data-nova-pessoa]')) {
    UI.gaveta = { tipo: 'pessoa', id: null };
    return abrirGaveta(
      gavetaPessoa({
        nome: '',
        notas: '',
        espacos: UI.espaco === 'todos' ? [] : [{ id: UI.espaco }],
        canais: [{ tipo: 'whatsapp', valor: '' }],
      }),
    );
  }

  // Dentro da gaveta
  const op = alvo('[data-opcao]');
  if (op) {
    const f = op.closest('form');
    f.querySelector(`[name=${op.dataset.opcao}]`).value = op.dataset.valor;
    $$(`[data-opcao="${op.dataset.opcao}"]`, f).forEach((b) => b.setAttribute('aria-pressed', b === op));
    return;
  }
  const ep = alvo('[data-espaco-pessoa]');
  if (ep) return ep.setAttribute('aria-pressed', ep.getAttribute('aria-pressed') !== 'true');
  if (alvo('[data-mais-canal]'))
    return alvo('form')
      .querySelector('.lista-canais')
      .insertAdjacentHTML('beforeend', linhaCanal({ tipo: 'whatsapp', valor: '' }));
  if (alvo('[data-tirar-canal]')) return alvo('.canal-linha').remove();
  if (alvo('[data-apagar-anotacao]')) {
    const b = alvo('[data-apagar-anotacao]');
    try {
      await api('PATCH', `/api/tarefas/${b.dataset.daTarefa}`, {
        apagarAnotacao: Number(b.dataset.apagarAnotacao),
      });
    } catch (er) {
      return falhou(er);
    }
    await carregarAba();
    return abrirTarefa(b.dataset.daTarefa);
  }
  if (alvo('[data-apagar-pessoa]')) {
    if (!confirm('Apagar esta pessoa? As tarefas ficam, sem a pessoa.')) return;
    try {
      await api('DELETE', `/api/pessoas/${UI.gaveta.id}`);
    } catch (er) {
      return falhou(er);
    }
    fecharGaveta();
    avisar('Pessoa apagada');
    return carregarAba();
  }

  // Conexões
  const acao = async (fn, ok) => {
    try {
      await fn();
      if (ok) avisar(ok);
    } catch (er) {
      falhou(er);
    }
    carregarAba();
  };
  if (alvo('[data-ler-conta]')) {
    avisar('Lendo a caixa…', { ms: 2500 });
    return acao(
      () => api('POST', `/api/contas/${alvo('[data-ler-conta]').dataset.lerConta}/ler`, {}),
      'Caixa lida',
    );
  }
  if (alvo('[data-apagar-conta]')) {
    if (!confirm('Apagar esta conta e as conversas dela na Central? A caixa de verdade não muda.')) return;
    return acao(
      () => api('DELETE', `/api/contas/${alvo('[data-apagar-conta]').dataset.apagarConta}`),
      'Conta apagada',
    );
  }
  if (alvo('[data-wa-desligar]')) {
    if (!confirm('Desligar este WhatsApp da Central? O aparelho sai da lista de conectados.')) return;
    return acao(
      () =>
        api('POST', `/api/contas/${alvo('[data-wa-desligar]').dataset.waDesligar}/whatsapp`, {
          acao: 'desligar',
        }),
      'Pedido de desligar enviado',
    );
  }
  if (alvo('[data-token]')) {
    const b = alvo('[data-token]');
    try {
      UI.tokenNovo = await api('POST', '/api/tokens', { nome: b.dataset.tokenNome, escopo: b.dataset.token });
    } catch (er) {
      return falhou(er);
    }
    await carregarAba();
    scrollTo({ top: 0 });
    return;
  }
  if (alvo('[data-revogar]')) {
    if (!confirm('Revogar este token? Quem usa ele para de funcionar na hora.')) return;
    return acao(
      () => api('DELETE', `/api/tokens/${alvo('[data-revogar]').dataset.revogar}`),
      'Token revogado',
    );
  }
  if (alvo('[data-sair-todas]')) {
    if (!confirm('Encerrar todas as sessões, inclusive esta?')) return;
    try {
      await api('POST', '/api/sessoes/sair-de-todas', {});
    } catch {}
    return mostrarEntrada();
  }
});
$('#sair').onclick = async () => {
  if (UI.contexto === 'local') {
    await fetch('gateway/sair', { method: 'POST', headers: { 'X-Central': '1' } });
    location.replace('gateway/entrar');
    return;
  }
  try {
    await api('POST', '/api/sair', {});
  } catch {}
  mostrarEntrada();
};
$('#busca-topo').onkeydown = (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    UI.buscaTudo = e.target.value.trim();
    ir('busca');
  }
};

document.addEventListener('change', async (e) => {
  try {
    if (e.target.matches('[data-filtro-projeto]')) {
      UI.filtroProjeto = e.target.value;
      return carregarAba();
    }
    if (e.target.matches('[data-canal-caixa]')) {
      UI.canal = e.target.value;
      UI.conta = '';
      UI.conversa = null;
      return carregarAba();
    }
    if (e.target.matches('[data-conta-caixa]')) {
      UI.conta = e.target.value;
      UI.conversa = null;
      return carregarAba();
    }
    if (e.target.matches('[data-projeto-caixa]')) {
      UI.projetoCaixa = e.target.value;
      UI.conversa = null;
      return carregarAba();
    }
    if (e.target.matches('[data-projetos-status]')) {
      UI.projetosStatus = e.target.value;
      return desenhar();
    }
    if (e.target.matches('[data-status-tarefa]')) {
      await api('PATCH', '/api/tarefas/' + e.target.dataset.statusTarefa, {
        status: e.target.value,
        versao: Number(e.target.dataset.versao),
      });
      return carregarAba();
    }
    if (e.target.matches('[data-rapida] [name=espaco]')) {
      e.target.form.querySelector('[name=projeto_id]').innerHTML = opcoesProjeto(e.target.value);
      return;
    }
  } catch (er) {
    return falhou(er);
  }

  if (e.target.matches('[data-mover]')) {
    const c = D.conversa,
      para = e.target.value,
      de = c.espaco_id;
    let movida;
    try {
      movida = await api('PATCH', `/api/conversas/${c.id}`, { espaco_id: para, versao: c.versao });
      if (UI.conversa == c.id) D.conversa = movida;
    } catch (er) {
      e.target.value = de;
      return falhou(er);
    }
    avisar(`Movida para ${espacoPor(para).nome}`, {
      acao: 'Desfazer',
      fn: async () => {
        await api('PATCH', `/api/conversas/${c.id}`, { espaco_id: de, versao: movida.versao });
        await carregarAba();
      },
    });
    return carregarAba();
  }
  if (e.target.matches('[name=proxima][type=date]'))
    $$('[data-opcao="proxima"]', e.target.closest('form')).forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.valor === e.target.value),
    );
});
document.addEventListener('focusout', (e) => {
  if (e.target.matches('[data-nota]')) {
    clearTimeout(UI.tNota);
    salvarNota(e.target);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-busca-caixa]')) {
    UI.buscaCaixa = e.target.value;
    clearTimeout(UI.tBuscaCaixa);
    UI.tBuscaCaixa = setTimeout(async () => {
      await carregarAba();
      const b = $('[data-busca-caixa]');
      b?.focus();
      b?.setSelectionRange(b.value.length, b.value.length);
    }, 350);
  }

  if (e.target.matches('[data-nota]')) {
    clearTimeout(UI.tNota);
    const s = $('#nota-salva');
    if (s) s.textContent = '';
    UI.tNota = setTimeout(() => salvarNota(e.target), 1200);
  }
  if (e.target.matches('[name=busca-pessoas]')) {
    UI.busca = e.target.value;
    clearTimeout(UI.t);
    UI.t = setTimeout(async () => {
      await carregarAba();
      const b = $('[name=busca-pessoas]');
      b?.focus();
      b?.setSelectionRange(b.value.length, b.value.length);
    }, 250);
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.matches('[data-rapida]')) {
    e.preventDefault();
    if (f.submetendo) return;
    f.submetendo = true;
    const botao = f.querySelector('button[type=submit]');
    if (botao) botao.disabled = true;
    const d = Object.fromEntries(new FormData(f));
    let criada;
    try {
      criada = await api('POST', '/api/tarefas', {
        espaco_id: d.espaco,
        titulo: d.titulo,
        projeto_id: d.projeto_id ? Number(d.projeto_id) : null,
        proxima: d.proxima || null,
      });
    } catch (er) {
      return falhou(er);
    } finally {
      f.submetendo = false;
      if (botao?.isConnected) botao.disabled = false;
    }
    if (UI.aba === 'hoje') UI.hojeFiltro = 'todas';
    avisar(
      d.proxima === hojeIso()
        ? 'Tarefa adicionada à agenda de hoje'
        : d.proxima
          ? 'Tarefa planejada para ' + dataCurta(d.proxima)
          : 'Tarefa capturada sem dia planejado',
      { acao: 'Abrir', fn: () => abrirTarefa(criada.id) },
    );
    await carregarAba();
    atualizarContagens();
    const novo = $('[data-rapida] [name=titulo]');
    novo?.focus();
    return;
  }
  if (f.matches('[data-form-tarefa]')) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    try {
      await api('PATCH', `/api/tarefas/${f.dataset.formTarefa}`, {
        titulo: d.titulo,
        status: d.status,
        pessoa_id: d.pessoa || null,
        proxima: d.proxima || null,
        nota: d.nota,
        versao: Number(d.versao),
        projeto_id: d.projeto_id ? Number(d.projeto_id) : null,
        descricao: d.descricao,
        prioridade: d.prioridade,
        prazo: d.prazo || null,
        lembrete: instanteInput(d.lembrete),
        checklist: String(d.checklist || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => ({ texto: x.replace(/^\[[ xX]\]\s*/, ''), feito: /^\[[xX]\]/.test(x) })),
      });
    } catch (er) {
      return falhou(er);
    }
    fecharGaveta();
    avisar('Tarefa salva');
    await carregarAba();
    return atualizarContagens();
  }
  if (f.matches('[data-form-pessoa]')) {
    e.preventDefault();
    const dados = {
      nome: f.querySelector('[name=nome]').value,
      notas: f.querySelector('[name=notas]').value,
      espacos: $$('[data-espaco-pessoa][aria-pressed="true"]', f).map((b) => b.dataset.espacoPessoa),
      canais: $$('.canal-linha', f)
        .map((c) => ({ tipo: c.querySelector('select').value, valor: c.querySelector('input').value.trim() }))
        .filter((c) => c.valor),
    };
    try {
      f.dataset.formPessoa
        ? await api('PUT', `/api/pessoas/${f.dataset.formPessoa}`, dados)
        : await api('POST', '/api/pessoas', dados);
    } catch (er) {
      return falhou(er);
    }
    fecharGaveta();
    avisar('Pessoa salva');
    return carregarAba();
  }
  if (f.matches('[data-form-espaco]')) {
    e.preventDefault();
    const v = (n) => f.querySelector(`[name=${n}]`);
    try {
      await api('POST', '/api/espacos', {
        id: v('id').value.trim(),
        nome: v('nome').value,
        cor: v('cor').value,
        ordem: Number(v('ordem').value) || 0,
        arquivado: v('arquivado').checked,
      });
    } catch (er) {
      return falhou(er);
    }
    avisar('Espaço salvo');
    return carregarBase().then(desenhar);
  }
  if (f.matches('[data-parear]')) {
    e.preventDefault();
    try {
      await api('POST', `/api/contas/${f.dataset.parear}/whatsapp`, {
        acao: 'parear',
        numero: f.querySelector('[name=numero]').value,
      });
    } catch (er) {
      return falhou(er);
    }
    avisar('Pedido enviado: o código aparece aqui em alguns segundos');
    return carregarAba();
  }
  if (f.matches('[data-form-email], [data-form-wa]')) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    try {
      await api('POST', '/api/contas', { ...d, tipo: f.matches('[data-form-email]') ? 'email' : 'whatsapp' });
    } catch (er) {
      return falhou(er);
    }
    avisar('Conta ligada');
    return carregarAba();
  }
});

// Atalhos da caixa (fora de campo de texto).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#gaveta').hidden) return fecharGaveta();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('#gaveta textarea'))
    return e.target.closest('form').requestSubmit();
  if (
    e.target.matches('input, textarea, select') ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    $('#app').hidden ||
    !$('#gaveta').hidden
  )
    return;
  if (e.key === '/') {
    e.preventDefault();
    return $('#busca-topo').focus();
  }
  if (UI.aba !== 'caixa') return;
  const lista = D.conversas || [];
  const i = lista.findIndex((x) => String(x.id) === String(UI.conversa));
  const abrir = (x) => x && $(`[data-abrir-conversa="${x.id}"]`)?.click();
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    abrir(lista[i + 1] || (i < 0 ? lista[0] : null));
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    abrir(lista[i - 1]);
  } else if (e.key === 'e' && D.conversa)
    mudarEstado(D.conversa.estado === 'resolvida' ? 'responder' : 'resolvida');
  else if (e.key === 'r' && D.conversa?.responder) $('[data-responder]')?.click();
  else if (e.key === 't' && D.conversa) $('[data-virar-tarefa]')?.click();
  else if (e.key === 'Escape' && D.conversa) $('[data-fechar-conversa]')?.click();
});

// ---------- Entrar e primeiro acesso ----------
function mostrarTela(app) {
  $('#app').hidden = !app;
  $('#entrada').hidden = app;
}
const telaEntrada = (form) => `<div class="entrada-tela">
  <div class="entrada-marca"><div class="marca" style="padding:0">${$('.marca svg').outerHTML}Central</div>
    <div><h1>Tudo o que pede você, <em>num lugar só.</em></h1>
      <ul><li>${ico('caixa')}E-mail e WhatsApp de cada empresa, separados por espaço</li><li>${ico('cadeado')}Só leitura: nada é enviado daqui</li><li>${ico('escudo')}Senha e autenticador do celular</li></ul></div>
    <span class="pequeno">Central pessoal · código aberto</span></div>
  <div class="entrada-form">${form}</div></div>`;
function mostrarEntrada(erro, aviso) {
  mostrarTela(false);
  D.hoje = null;
  // O campo "usuario" escondido existe para o gerenciador de senhas: sem ele, o
  // navegador põe o seu login salvo no campo do código.
  $('#entrada').innerHTML = telaEntrada(`<form class="entrada" data-entrar novalidate>
    <h2>Entrar</h2><p>${esc(aviso || 'Sua senha e o código de 6 números do app autenticador.')}</p>
    <input name="usuario" autocomplete="username" value="central" hidden>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required autofocus></label>
    <label>Código do autenticador<input class="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000"></label>
    <button class="btn primario">Entrar</button>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
  </form>`);
}
// Central sem dono: não adianta pedir senha. Pede o convite (link inteiro ou só o código).
function mostrarPrimeiroAcesso(erro) {
  mostrarTela(false);
  $('#entrada').innerHTML = telaEntrada(`<form class="entrada" data-primeiro novalidate>
    <h2>Primeiro acesso</h2><p>A Central ainda não tem senha. Cole o link de convite que você recebeu (ou só o código que começa com <b>cvt_</b>).</p>
    <label>Convite<input name="convite" autocomplete="off" spellcheck="false" placeholder="https://…/#convite=cvt_…" required autofocus></label>
    <button class="btn primario">Continuar</button>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
  </form>`);
}
const codigoLimpo = (v) => String(v || '').replace(/\s/g, '');
function mostrarConvite(convite, passo = 1, dados = {}, erro) {
  mostrarTela(false);
  $('#entrada').innerHTML = telaEntrada(
    passo === 1
      ? `<form class="entrada" data-convite-1>
      <h2>Crie a sua senha</h2><p>Passo 1 de 2. Ela fica só com você: nem quem criou o convite vê.</p>
      <label>Senha (12 caracteres ou mais)<input name="senha" type="password" autocomplete="new-password" minlength="12" required autofocus></label>
      <label>Repita a senha<input name="senha2" type="password" autocomplete="new-password" minlength="12" required></label>
      <button class="btn primario">Continuar</button>
      ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
    </form>`
      : `<form class="entrada" data-convite-2>
      <h2>Ligue o autenticador</h2><p>Passo 2 de 2. No Google Authenticator (ou Aegis, 1Password), toque em <b>+</b> e leia o QR:</p>
      <div class="qr">${dados.qr || ''}</div>
      <p class="pequeno">Sem câmera? “Inserir chave de configuração” e digite:</p>
      <div class="segredo">${esc(dados.segredo.match(/.{1,4}/g).join(' '))}</div>
      <label>Código de 6 números que o app mostra<input class="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required autofocus></label>
      <button class="btn primario">Ativar</button>
      ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
    </form>`,
  );
  $('#entrada').dataset.convite = convite;
  UI.conviteDados = dados;
}

document.addEventListener('submit', async (e) => {
  const f = e.target;
  const d = Object.fromEntries(new FormData(f));
  if (f.matches('[data-primeiro]')) {
    e.preventDefault();
    const c = String(d.convite || '').match(/cvt_[\w-]{20,}/)?.[0];
    return c ? mostrarConvite(c) : mostrarPrimeiroAcesso('Não achei o convite aí. Ele começa com cvt_.');
  }
  if (f.matches('[data-entrar]')) {
    e.preventDefault();
    d.codigo = codigoLimpo(d.codigo);
    if (!d.senha) return mostrarEntrada('Digite a senha.');
    if (!/^[0-9]{6}$/.test(d.codigo))
      return mostrarEntrada(
        'O código são os 6 números que aparecem no app autenticador (Google Authenticator, Aegis…), não o seu usuário.',
      );
    try {
      await api('POST', '/api/entrar', { senha: d.senha, codigo: d.codigo });
      iniciarApp();
    } catch (er) {
      /configurada/.test(er.message) ? mostrarPrimeiroAcesso() : mostrarEntrada(er.message);
    }
  }
  if (f.matches('[data-convite-1]')) {
    e.preventDefault();
    const convite = $('#entrada').dataset.convite;
    if (d.senha !== d.senha2) return mostrarConvite(convite, 1, {}, 'As duas senhas não são iguais.');
    try {
      mostrarConvite(convite, 2, await api('POST', '/api/convite/abrir', { convite, senha: d.senha }));
    } catch (er) {
      mostrarConvite(convite, 1, {}, er.message);
    }
  }
  if (f.matches('[data-convite-2]')) {
    e.preventDefault();
    const convite = $('#entrada').dataset.convite;
    try {
      await api('POST', '/api/convite/ativar', { convite, codigo: codigoLimpo(d.codigo) });
      history.replaceState(null, '', location.pathname);
      mostrarEntrada(null, 'Pronto. Agora entre com a senha e um código novo do autenticador.');
    } catch (er) {
      mostrarConvite(convite, 2, UI.conviteDados, er.message);
    }
  }
});

async function iniciarApp() {
  mostrarTela(true);
  const [caminho, parametros] = location.hash.slice(1).split('?');
  const [aba, conversa] = caminho.split('/');
  const params = new URLSearchParams(parametros || '');
  UI.espaco = params.get('espaco') || 'todos';
  UI.projeto = Number(params.get('projeto')) || null;
  UI.estado = params.get('estado') || 'responder';
  UI.mensagem = Number(params.get('mensagem')) || null;
  UI.aba = ABAS.includes(aba) && aba !== 'busca' ? aba : 'hoje';
  UI.conversa = UI.aba === 'caixa' && /^\d+$/.test(conversa || '') ? conversa : null;
  desenharNav();
  $('#conteudo').innerHTML = '<div class="pagina"><div class="vazio">Carregando…</div></div>';
  await carregarBase();
  await carregarAba();
}

(async () => {
  const convite = location.hash.match(/^#convite=(cvt_[\w-]+)$/)?.[1];
  // O convite sai da barra de endereço na hora (não fica no histórico nem em print).
  if (convite) {
    history.replaceState(null, '', location.pathname);
    return mostrarConvite(convite);
  }
  try {
    const op = await fetch('api/operacao')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (op?.espaco_local) {
      D.operacao = op;
      const local = await fetch('api/local/sessao').then((r) => r.json());
      if (local.logado) {
        UI.contexto = 'local';
        if (!location.hash.includes('local=1'))
          history.replaceState(null, '', location.pathname + '#hoje?local=1');
        return iniciarApp();
      }
    }
    const s = await (await fetch('api/sessao')).json();
    if (s.logado) return iniciarApp();
    s.configurado ? mostrarEntrada() : mostrarPrimeiroAcesso();
  } catch {
    mostrarEntrada('Sem conexão com a Central.');
  }
})();

// Mensagem nova chega sozinha: a caixa e os números se atualizam enquanto a página está aberta.
setInterval(() => {
  if ($('#app').hidden || document.hidden || !$('#gaveta').hidden) return;
  if (document.activeElement?.matches('#conteudo input, #conteudo textarea, #conteudo select')) return;
  const agora = Date.now();
  if (
    UI.aba === 'conexoes' &&
    D.contas?.some(
      (c) => c.tipo === 'whatsapp' && (c.estado?.pedido || (c.estado?.codigo && !c.estado?.conectado)),
    )
  )
    return carregarAba();
  if (agora - (UI.vistoEm || 0) < 30e3) return;
  UI.vistoEm = agora;
  if (UI.aba === 'caixa' || UI.aba === 'hoje') {
    const y = $('.itens')?.scrollTop;
    carregarAba().then(() => {
      if (y != null && $('.itens')) $('.itens').scrollTop = y;
    });
  }
  if (UI.aba !== 'hoje' && agora - (UI.hojeEm || 0) > 60e3) {
    UI.hojeEm = agora;
    atualizarContagens();
  }
}, 5e3);
