// ---------- Notas do Obsidian ----------
// A Central só lê: busca, mostra e liga a pessoas e projetos. Editar é no Obsidian.
//
// O texto da nota é dado, nunca HTML: cada pedaço passa por esc() antes de entrar
// na página, e endereço de fora aparece como texto, não vira link. A única coisa
// clicável é a ligação [[...]] para outra nota que existe na Central.

// Trechos dentro de uma linha: `código`, [[ligação]], ![[anexo]], **forte**, ==marca==.
function notaLinha(cru, ligacoes) {
  const re = /(`[^`\n]+`)|(!?\[\[[^\]\n]+\]\])|(\*\*[^*\n]+\*\*)|(==[^=\n]+==)/g;
  let saida = '',
    i = 0,
    m;
  while ((m = re.exec(cru))) {
    saida += esc(cru.slice(i, m.index));
    i = m.index + m[0].length;
    if (m[1]) saida += `<code>${esc(m[1].slice(1, -1))}</code>`;
    else if (m[3]) saida += `<b>${esc(m[3].slice(2, -2))}</b>`;
    else if (m[4]) saida += `<mark>${esc(m[4].slice(2, -2))}</mark>`;
    else {
      const anexo = m[2].startsWith('!');
      const dentro = m[2].slice(anexo ? 3 : 2, -2);
      const [alvoCompleto, apelido] = dentro.split('|');
      const alvo = alvoCompleto.split(/[#^]/)[0].trim();
      const rotulo = (apelido || alvoCompleto).trim();
      const id = ligacoes[alvo];
      saida += id
        ? `<button class="lig" data-abrir-nota="${id}">${esc(rotulo)}</button>`
        : `<span class="lig ${anexo ? 'anexo' : 'morta'}">${esc(rotulo)}</span>`;
    }
  }
  return saida + esc(cru.slice(i));
}

function notaHtml(texto, ligacoes) {
  const linhas = String(texto).replace(/\r\n?/g, '\n').split('\n');
  const partes = [];
  let i = 0;
  // Propriedades (frontmatter) no topo.
  if (linhas[0] === '---') {
    const fim = linhas.indexOf('---', 1);
    if (fim > 0) {
      partes.push(`<pre class="nota-props">${esc(linhas.slice(1, fim).join('\n'))}</pre>`);
      i = fim + 1;
    }
  }
  const celulas = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/);
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^\s*(```|~~~)/.test(l)) {
      const cerca = l.trim().slice(0, 3);
      const bloco = [];
      i++;
      while (i < linhas.length && !linhas[i].trim().startsWith(cerca)) bloco.push(linhas[i++]);
      i++;
      partes.push(`<pre class="nota-cod">${esc(bloco.join('\n'))}</pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const tab = [];
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) tab.push(linhas[i++]);
      const corpo = tab.filter((x) => !/^\s*\|[\s:|-]+\|\s*$/.test(x));
      const temCab = tab.length > 1 && /^\s*\|[\s:|-]+\|\s*$/.test(tab[1]);
      partes.push(
        `<div class="nota-tab"><table>${corpo
          .map(
            (linha, n) =>
              `<tr>${celulas(linha)
                .map((c) => `<${temCab && n === 0 ? 'th' : 'td'}>${notaLinha(c.trim(), ligacoes)}</${temCab && n === 0 ? 'th' : 'td'}>`)
                .join('')}</tr>`,
          )
          .join('')}</table></div>`,
      );
      continue;
    }
    i++;
    if (!l.trim()) continue;
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) partes.push(`<h${Math.min(m[1].length + 1, 5)}>${notaLinha(m[2], ligacoes)}</h${Math.min(m[1].length + 1, 5)}>`);
    else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) partes.push('<hr>');
    else if ((m = l.match(/^(\s*)(?:[-*+]|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/)))
      partes.push(
        `<div class="nota-li" style="--n:${Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 6)}"><span class="marca">${m[3] !== undefined ? (m[3] === ' ' ? '☐' : '☑') : m[2] ? esc(m[2]) + '.' : '•'}</span><span>${notaLinha(m[4], ligacoes)}</span></div>`,
      );
    else if ((m = l.match(/^\s*>\s?(.*)$/))) {
      const aviso = m[1].match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      partes.push(
        aviso
          ? `<div class="nota-cit forte"><b>${esc(aviso[2] || aviso[1])}</b></div>`
          : `<div class="nota-cit">${notaLinha(m[1], ligacoes)}</div>`,
      );
    } else partes.push(`<p>${notaLinha(l, ligacoes)}</p>`);
  }
  return partes.join('');
}

const tamanhoNota = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const marcarTrecho = (t) =>
  esc(t)
    .replace(/\u0002/g, '<mark>')
    .replace(/\u0003/g, '</mark>');
const linhaNota = (n) =>
  `<div class="fila-item toque" data-abrir-nota="${n.id}">${ico(n.tipo === 'texto' ? 'nota' : 'arquivo')}<div class="txt"><div class="nome"><span>${esc(n.titulo)}</span></div><div class="prev">${n.trecho ? marcarTrecho(String(n.trecho).replace(/\s+/g, ' ')) : esc(n.pasta || 'raiz do vault')}</div>${n.trecho && n.pasta ? `<div class="prev pasta">${esc(n.pasta)}</div>` : ''}</div>${n.espaco_id ? chipEspaco(n.espaco_id) : ''}<span class="idade">${n.modificada ? horaLista(n.modificada) : ''}</span></div>`;

function estadoNotas(e) {
  if (!e.ligado)
    return '<div class="erro-faixa">As notas não estão ligadas nesta Central. Falta apontar para o banco de sincronização do Obsidian.</div>';
  if (e.erro) return `<div class="erro-faixa">${ico('alerta')} A leitura do vault falhou: ${esc(e.erro)}</div>`;
  return '';
}

function desenharNotas() {
  if (UI.nota) return desenharNota();
  const d = D.notas;
  if (!d) return `<div class="pagina">${faixaErro() || '<div class="vazio">Carregando…</div>'}</div>`;
  const e = d.estado;
  return `<div class="pagina notas">
    <div class="cab"><div><h1>Notas</h1><p>${plural(e.total, 'arquivo', 'arquivos')} do Obsidian${e.ultima_leitura ? ` · conferido ${quando(e.ultima_leitura)}` : ''}. Para editar, use o Obsidian.</p></div>
      <button class="btn fantasma" data-ler-notas title="Ler agora o que mudou no vault">${ico('atualizar')}Atualizar</button></div>
    ${faixaErro()}${estadoNotas(e)}
    <div class="filtros-notas">
      <label class="buscar">${ico('buscar')}<input type="search" data-busca-notas value="${esc(UI.buscaNotas || '')}" placeholder="Buscar nas notas" aria-label="Buscar nas notas"></label>
      <select data-pasta-notas aria-label="Pasta"><option value="">Todas as pastas</option>${d.pastas
        .map((p) => `<option value="${esc(p.nome)}" ${UI.pastaNotas === p.nome ? 'selected' : ''}>${esc(p.nome || 'raiz do vault')} (${p.notas})</option>`)
        .join('')}</select>
    </div>
    <section class="cartao">
      ${
        d.notas.length
          ? `<div class="grupo-tit"><span>${UI.buscaNotas ? 'Resultados' : 'Modificadas por último'}</span><span>${d.notas.length}</span></div>${d.notas.map(linhaNota).join('')}`
          : `<div class="vazio"><b>${UI.buscaNotas || UI.pastaNotas ? 'Nada encontrado' : 'Nenhuma nota ainda'}</b>${UI.buscaNotas ? 'A busca ignora acentos; tente uma palavra só.' : 'As notas aparecem aqui depois que o Obsidian sincroniza com o servidor.'}</div>`
      }
    </section></div>`;
}

function desenharNota() {
  const n = D.nota;
  if (!n || String(n.id) !== String(UI.nota))
    return `<div class="pagina">${faixaErro() || '<div class="vazio">Abrindo…</div>'}</div>`;
  const projetos = (D.projetos || []).filter((p) => !n.vinculos.some((v) => v.projeto_id === p.id));
  const pessoas = (D.pessoas || []).filter((p) => !n.vinculos.some((v) => v.pessoa_id === p.id));
  return `<div class="pagina nota-pagina">
    <div class="cab"><div><button class="btn fantasma mini" data-voltar-notas>${ico('voltar')}Notas</button>
      <h1>${esc(n.titulo)}</h1><p>${esc(n.pasta || 'raiz do vault')}${n.modificada ? ` · modificada ${quando(n.modificada)}` : ''} · ${tamanhoNota(n.tamanho)}</p></div>
      ${n.espaco_id ? chipEspaco(n.espaco_id) : ''}</div>
    ${faixaErro()}
    <div class="nota-vinculos">
      ${n.vinculos
        .map(
          (v) =>
            `<span class="chip">${ico(v.pessoa_id ? 'pessoas' : 'camadas')}${esc(v.pessoa_nome || v.projeto_nome)}<button class="tirar" data-desligar-nota="${v.id}" aria-label="Desligar">${ico('fechar')}</button></span>`,
        )
        .join('')}
      <select data-ligar-nota aria-label="Ligar a um projeto ou pessoa"><option value="">Ligar a…</option>
        ${projetos.length ? `<optgroup label="Projetos">${projetos.map((p) => `<option value="projeto:${p.id}">${esc(p.nome)}</option>`).join('')}</optgroup>` : ''}
        ${pessoas.length ? `<optgroup label="Pessoas">${pessoas.map((p) => `<option value="pessoa:${p.id}">${esc(p.nome)}</option>`).join('')}</optgroup>` : ''}
      </select>
    </div>
    <article class="cartao nota-corpo">${
      n.tipo === 'texto'
        ? notaHtml(n.texto, n.ligacoes) || '<div class="vazio">Nota vazia.</div>'
        : `<div class="vazio"><b>Arquivo anexo</b>${esc(n.caminho)} não é texto. Abra no Obsidian para ver.</div>`
    }</article></div>`;
}

function abrirNota(id) {
  UI.aba = 'notas';
  UI.nota = String(id);
  if (String(D.nota?.id) !== String(id)) D.nota = null;
  atualizarEndereco();
  fecharGaveta();
  desenharNav();
  desenhar();
  carregarAba();
  scrollTo({ top: 0 });
}

async function carregarNotas(novos) {
  if (UI.nota) {
    novos.nota = await api('GET', '/api/notas/' + UI.nota);
    if (!D.pessoas) novos.pessoas = await api('GET', '/api/pessoas?').catch(() => []);
    return;
  }
  const qs = new URLSearchParams();
  if (UI.buscaNotas) qs.set('q', UI.buscaNotas);
  if (UI.pastaNotas) qs.set('pasta', UI.pastaNotas);
  if (UI.espaco !== 'todos') qs.set('espaco', UI.espaco);
  novos.notas = await api('GET', '/api/notas?' + qs);
}

document.addEventListener('click', async (e) => {
  const alvo = (s) => e.target.closest(s);
  try {
    if (alvo('[data-desligar-nota]')) {
      e.stopPropagation();
      D.nota.vinculos = await api('DELETE', `/api/notas/${D.nota.id}/vinculos/${alvo('[data-desligar-nota]').dataset.desligarNota}`);
      return desenhar();
    }
    if (alvo('[data-abrir-nota]')) return abrirNota(alvo('[data-abrir-nota]').dataset.abrirNota);
    if (alvo('[data-voltar-notas]')) {
      UI.nota = null;
      atualizarEndereco();
      desenhar();
      return carregarAba();
    }
    if (alvo('[data-ler-notas]')) {
      alvo('[data-ler-notas]').disabled = true;
      await api('POST', '/api/notas/ler-agora', {});
      await carregarAba();
      avisar('Vault conferido.');
    }
  } catch (er) {
    falhou(er);
    desenhar();
  }
});

document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-busca-notas]')) return;
  UI.buscaNotas = e.target.value.trim();
  clearTimeout(UI.tBuscaNotas);
  UI.tBuscaNotas = setTimeout(async () => {
    await carregarAba();
    const b = $('[data-busca-notas]');
    b?.focus();
    b?.setSelectionRange(b.value.length, b.value.length);
  }, 300);
});

document.addEventListener('change', async (e) => {
  try {
    if (e.target.matches('[data-pasta-notas]')) {
      UI.pastaNotas = e.target.value;
      return carregarAba();
    }
    if (e.target.matches('[data-ligar-nota]') && e.target.value) {
      const [tipo, id] = e.target.value.split(':');
      D.nota.vinculos = await api('POST', `/api/notas/${D.nota.id}/vinculos`, { [tipo + '_id']: Number(id) });
      desenhar();
    }
  } catch (er) {
    falhou(er);
  }
});
