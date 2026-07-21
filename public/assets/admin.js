import {
  $, $$, api, aplicarMascaraCPF, certificadoHTML, cpfValido, desenharQR, diasAte,
  escapar, formatarData, formatarDataHora, hojeISO, limparAviso, limparCPF, mostrarAviso,
} from './comum.js';

/* ================================= estado ================================= */

const estado = {
  admin: null,
  pagina: 1,
  porPagina: 20,
  total: 0,
  busca: '',
  situacao: 'todas',
  arquivoBackup: null,
};

/* ================================== login ================================= */

const telaLogin = $('#tela-login');
const telaPainel = $('#tela-painel');
const avisoLogin = $('#aviso-login');

function entrarNoPainel(admin) {
  estado.admin = admin;
  $('#quem-nome').textContent = admin.nome;
  telaLogin.classList.add('oculto');
  telaPainel.classList.remove('oculto');
  carregarGarantias();
  carregarResumo();
}

function voltarParaLogin(mensagem) {
  estado.admin = null;
  telaPainel.classList.add('oculto');
  telaLogin.classList.remove('oculto');
  if (mensagem) mostrarAviso(avisoLogin, mensagem);
  $('#login-senha').value = '';
}

$('#form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparAviso(avisoLogin);
  const botao = $('#btn-entrar');
  botao.disabled = true;
  botao.textContent = 'Entrando...';

  try {
    const { admin } = await api('/api/admin/login', {
      method: 'POST',
      body: { usuario: $('#login-usuario').value.trim(), senha: $('#login-senha').value },
    });
    entrarNoPainel(admin);
  } catch (erro) {
    mostrarAviso(avisoLogin, erro.message);
    $('#login-senha').select();
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  voltarParaLogin();
});

/**
 * Envolve chamadas autenticadas: se a sessao expirar no meio do uso,
 * o admin volta para a tela de login em vez de ver um erro solto.
 */
async function apiAdmin(caminho, opcoes) {
  try {
    return await api(caminho, opcoes);
  } catch (erro) {
    if (erro.status === 401) {
      voltarParaLogin('Sua sessão expirou. Entre novamente.');
      throw erro;
    }
    throw erro;
  }
}

/* =================================== abas ================================= */

const carregadores = {
  garantias: () => { carregarGarantias(); carregarResumo(); },
  equipe: carregarEquipe,
  atividade: carregarLogs,
};

$$('.tab').forEach((aba) => {
  aba.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((x) => x.classList.remove('active'));
    aba.classList.add('active');
    $(`#aba-${aba.dataset.aba}`).classList.add('active');
    carregadores[aba.dataset.aba]?.();
  });
});

function irParaAba(nome) {
  $(`.tab[data-aba="${nome}"]`).click();
}

/* ============================== indicadores =============================== */

async function carregarResumo() {
  try {
    const r = await apiAdmin('/api/admin/resumo');
    $('#kpis').innerHTML = [
      { valor: r.total, rotulo: 'Total', classe: '' },
      { valor: r.ativas, rotulo: 'Ativas', classe: 'destaque' },
      { valor: r.vencendo, rotulo: 'Vencem em 30 dias', classe: 'atencao' },
      { valor: r.expiradas, rotulo: 'Expiradas', classe: '' },
      { valor: r.no_mes, rotulo: 'Criadas este mês', classe: '' },
    ]
      .map((k) => `<div class="kpi ${k.classe}"><div class="valor">${k.valor}</div><div class="rotulo">${k.rotulo}</div></div>`)
      .join('');
  } catch {
    $('#kpis').innerHTML = '';
  }
}

/* =============================== listagem ================================= */

const corpoTabela = $('#corpo-tabela');

function selo(g) {
  if (!g.ativa) return '<span class="badge exp">Expirada</span>';
  const dias = diasAte(g.validade);
  if (dias <= 30) return `<span class="badge alerta">Vence em ${dias}d</span>`;
  return '<span class="badge ok">Ativa</span>';
}

async function carregarGarantias() {
  corpoTabela.innerHTML = '<tr><td colspan="6" class="vazio">Carregando...</td></tr>';

  const parametros = new URLSearchParams({
    busca: estado.busca,
    situacao: estado.situacao,
    pagina: String(estado.pagina),
    por_pagina: String(estado.porPagina),
  });

  try {
    const dados = await apiAdmin(`/api/admin/garantias?${parametros}`);
    estado.total = dados.total;

    if (!dados.garantias.length) {
      corpoTabela.innerHTML = `<tr><td colspan="6" class="vazio">${
        estado.busca || estado.situacao !== 'todas'
          ? 'Nenhuma garantia encontrada com esses filtros.'
          : 'Nenhuma garantia cadastrada ainda.'
      }</td></tr>`;
    } else {
      corpoTabela.innerHTML = dados.garantias
        .map(
          (g) => `<tr>
            <td><b>${escapar(g.nome)}</b><br><span style="color:var(--ink-soft);font-size:.78rem">${g.idade} anos</span></td>
            <td>${escapar(g.cpf_formatado)}</td>
            <td>${escapar(g.produto || '—')}</td>
            <td>${formatarData(g.validade)}</td>
            <td>${selo(g)}</td>
            <td>
              <div class="linha-acoes">
                <button class="btn btn-ghost btn-mini" data-ver="${g.id}">Ver</button>
                <button class="btn btn-ghost btn-mini" data-editar="${g.id}">Editar</button>
                <button class="btn btn-perigo btn-mini" data-excluir="${g.id}" data-nome="${escapar(g.nome)}">Excluir</button>
              </div>
            </td>
          </tr>`
        )
        .join('');
    }

    renderizarPaginacao();
  } catch (erro) {
    if (erro.status !== 401) {
      corpoTabela.innerHTML = `<tr><td colspan="6" class="vazio">${escapar(erro.message)}</td></tr>`;
    }
  }
}

function renderizarPaginacao() {
  const paginas = Math.max(1, Math.ceil(estado.total / estado.porPagina));
  $('#paginacao').innerHTML =
    paginas <= 1
      ? `${estado.total} registro${estado.total === 1 ? '' : 's'}`
      : `<button class="btn btn-ghost btn-mini" id="pag-anterior" ${estado.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
         <span>Página ${estado.pagina} de ${paginas} — ${estado.total} registros</span>
         <button class="btn btn-ghost btn-mini" id="pag-proxima" ${estado.pagina >= paginas ? 'disabled' : ''}>Próxima</button>`;

  $('#pag-anterior')?.addEventListener('click', () => { estado.pagina--; carregarGarantias(); });
  $('#pag-proxima')?.addEventListener('click', () => { estado.pagina++; carregarGarantias(); });
}

// Busca com atraso para nao disparar uma consulta por tecla digitada.
let temporizadorBusca;
$('#busca').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBusca);
  temporizadorBusca = setTimeout(() => {
    estado.busca = evento.target.value.trim();
    estado.pagina = 1;
    carregarGarantias();
  }, 350);
});

$('#filtro-situacao').addEventListener('change', (evento) => {
  estado.situacao = evento.target.value;
  estado.pagina = 1;
  carregarGarantias();
});

// Delegacao: os botoes da tabela sao recriados a cada carregamento.
corpoTabela.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button');
  if (!botao) return;

  if (botao.dataset.ver) return visualizar(botao.dataset.ver);
  if (botao.dataset.editar) return editar(botao.dataset.editar);
  if (botao.dataset.excluir) {
    const confirmado = await confirmar(
      'Excluir garantia',
      `A garantia de ${botao.dataset.nome} será removida em definitivo. Esta ação não pode ser desfeita.`
    );
    if (!confirmado) return;

    try {
      await apiAdmin(`/api/admin/garantias/${botao.dataset.excluir}`, { method: 'DELETE' });
      $('#cert-visualizacao').innerHTML = '';
      carregarGarantias();
      carregarResumo();
    } catch (erro) {
      if (erro.status !== 401) alert(erro.message);
    }
  }
});

async function visualizar(id) {
  try {
    const { garantia } = await apiAdmin(`/api/admin/garantias/${id}`);
    const alvo = $('#cert-visualizacao');
    alvo.innerHTML =
      certificadoHTML({ ...garantia, cpf: garantia.cpf_formatado }, { idQR: 'qr-visualizacao' }) +
      `<div class="acoes"><button class="btn btn-ghost" onclick="window.print()">Imprimir certificado</button></div>`;
    desenharQR(garantia, 'qr-visualizacao');
    alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (erro) {
    if (erro.status !== 401) alert(erro.message);
  }
}

/* ============================ cadastro / edicao ============================ */

const formGarantia = $('#form-garantia');
const avisoGarantia = $('#aviso-garantia');
const campoCPF = $('#g-cpf');

aplicarMascaraCPF(campoCPF);
$('#g-nascimento').max = hojeISO();

function limparFormulario() {
  formGarantia.reset();
  $('#g-id').value = '';
  $('#titulo-form').textContent = 'Cadastrar garantia';
  $('#btn-salvar').textContent = 'Gerar garantia';
  limparAviso(avisoGarantia);
  $('#cert-novo').innerHTML = '';
  campoCPF.removeAttribute('aria-invalid');
}

$('#btn-cancelar-edicao').addEventListener('click', limparFormulario);

function somarAnos(anos) {
  const base = $('#g-consulta').value || hojeISO();
  const [ano, mes, dia] = base.split('-').map(Number);
  const alvo = new Date(Date.UTC(ano + anos, mes - 1, dia));
  $('#g-validade').value = alvo.toISOString().slice(0, 10);
}
$('#btn-validade-1a').addEventListener('click', () => somarAnos(1));
$('#btn-validade-2a').addEventListener('click', () => somarAnos(2));

async function editar(id) {
  try {
    const { garantia } = await apiAdmin(`/api/admin/garantias/${id}`);
    $('#g-id').value = garantia.id;
    $('#g-nome').value = garantia.nome;
    $('#g-cpf').value = garantia.cpf_formatado;
    $('#g-nascimento').value = garantia.data_nascimento ?? '';
    $('#g-consulta').value = garantia.data_consulta ?? '';
    $('#g-validade').value = garantia.validade ?? '';
    $('#g-produto').value = garantia.produto ?? '';
    $('#g-observacoes').value = garantia.observacoes ?? '';

    $('#titulo-form').textContent = `Editando: ${garantia.nome}`;
    $('#btn-salvar').textContent = 'Salvar alterações';
    limparAviso(avisoGarantia);
    $('#cert-novo').innerHTML = '';
    irParaAba('cadastro');
    $('#g-nome').focus();
  } catch (erro) {
    if (erro.status !== 401) alert(erro.message);
  }
}

formGarantia.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparAviso(avisoGarantia);
  campoCPF.removeAttribute('aria-invalid');

  const cpf = limparCPF(campoCPF.value);
  if (!cpfValido(cpf)) {
    campoCPF.setAttribute('aria-invalid', 'true');
    campoCPF.focus();
    return mostrarAviso(avisoGarantia, 'CPF inválido. Confira os 11 dígitos.');
  }

  const corpo = {
    nome: $('#g-nome').value,
    cpf,
    data_nascimento: $('#g-nascimento').value,
    data_consulta: $('#g-consulta').value,
    validade: $('#g-validade').value,
    produto: $('#g-produto').value,
    observacoes: $('#g-observacoes').value,
  };

  const id = $('#g-id').value;
  const botao = $('#btn-salvar');
  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = 'Salvando...';

  try {
    const { garantia } = await apiAdmin(id ? `/api/admin/garantias/${id}` : '/api/admin/garantias', {
      method: id ? 'PUT' : 'POST',
      body: corpo,
    });

    mostrarAviso(avisoGarantia, id ? 'Garantia atualizada.' : 'Garantia cadastrada com sucesso.', 'sucesso');

    $('#cert-novo').innerHTML =
      certificadoHTML({ ...garantia, cpf: garantia.cpf_formatado }, { idQR: 'qr-novo' }) +
      `<div class="acoes"><button class="btn btn-ghost" onclick="window.print()">Imprimir certificado</button></div>`;
    desenharQR(garantia, 'qr-novo');

    if (!id) {
      formGarantia.reset();
      $('#g-id').value = '';
    } else {
      $('#g-id').value = '';
      $('#titulo-form').textContent = 'Cadastrar garantia';
      botao.textContent = 'Gerar garantia';
    }
    carregarResumo();
  } catch (erro) {
    if (erro.status !== 401) mostrarAviso(avisoGarantia, erro.message);
  } finally {
    botao.disabled = false;
    if (botao.textContent === 'Salvando...') botao.textContent = textoOriginal;
  }
});

/* ================================= backup ================================= */

const avisoBackup = $('#aviso-backup');

// Downloads passam pelo cookie de sessao normalmente; basta navegar ate a rota.
$('#btn-backup-sql').addEventListener('click', () => baixar('/api/admin/backup/sql'));
$('#btn-backup-json').addEventListener('click', () => baixar('/api/admin/backup/json'));
$('#btn-backup-csv').addEventListener('click', () => baixar('/api/admin/backup/csv'));

function baixar(caminho) {
  const link = document.createElement('a');
  link.href = caminho;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
  mostrarAviso(avisoBackup, 'Download iniciado. Guarde o arquivo em local seguro.', 'info');
}

$('#arquivo-backup').addEventListener('change', (evento) => {
  estado.arquivoBackup = evento.target.files[0] ?? null;
  $('#btn-restaurar').disabled = !estado.arquivoBackup;
  limparAviso(avisoBackup);
});

$('#btn-restaurar').addEventListener('click', async () => {
  if (!estado.arquivoBackup) return;

  const modo = $('#modo-restauracao').value;
  if (modo === 'substituir') {
    const confirmado = await confirmar(
      'Substituir todas as garantias',
      'Todas as garantias atuais serão apagadas e trocadas pelas do arquivo. Baixe um backup antes de continuar.'
    );
    if (!confirmado) return;
  }

  const botao = $('#btn-restaurar');
  botao.disabled = true;
  botao.textContent = 'Restaurando...';

  try {
    const pacote = JSON.parse(await estado.arquivoBackup.text());
    const r = await apiAdmin('/api/admin/backup/restaurar', {
      method: 'POST',
      body: { ...pacote, modo },
    });

    const detalhe = r.problemas?.length ? ` Problemas: ${r.problemas.join(' | ')}` : '';
    mostrarAviso(
      avisoBackup,
      `${r.inseridas} garantia(s) importada(s), ${r.ignoradas} ignorada(s).${detalhe}`,
      r.inseridas ? 'sucesso' : 'info'
    );

    $('#arquivo-backup').value = '';
    estado.arquivoBackup = null;
    carregarGarantias();
    carregarResumo();
  } catch (erro) {
    if (erro.status !== 401) {
      mostrarAviso(
        avisoBackup,
        erro instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : erro.message
      );
    }
  } finally {
    botao.disabled = !estado.arquivoBackup;
    botao.textContent = 'Restaurar';
  }
});

/* ================================= equipe ================================= */

async function carregarEquipe() {
  const corpo = $('#corpo-equipe');
  corpo.innerHTML = '<tr><td colspan="5" class="vazio">Carregando...</td></tr>';

  try {
    const { usuarios } = await apiAdmin('/api/admin/usuarios');
    corpo.innerHTML = usuarios
      .map((u) => {
        const souEu = u.usuario === estado.admin?.usuario;
        return `<tr>
          <td><b>${escapar(u.usuario)}</b>${souEu ? ' <span class="badge ok">você</span>' : ''}</td>
          <td>${escapar(u.nome)}</td>
          <td>${formatarDataHora(u.ultimo_acesso)}</td>
          <td>${u.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge exp">Desativado</span>'}</td>
          <td>
            <div class="linha-acoes">
              <button class="btn btn-ghost btn-mini" data-senha="${u.id}" data-usuario="${escapar(u.usuario)}">Trocar senha</button>
              ${souEu ? '' : `<button class="btn ${u.ativo ? 'btn-perigo' : 'btn-ghost'} btn-mini"
                    data-alternar="${u.id}" data-ativo="${u.ativo}" data-usuario="${escapar(u.usuario)}">
                    ${u.ativo ? 'Desativar' : 'Reativar'}</button>`}
            </div>
          </td>
        </tr>`;
      })
      .join('');
  } catch (erro) {
    if (erro.status !== 401) corpo.innerHTML = `<tr><td colspan="5" class="vazio">${escapar(erro.message)}</td></tr>`;
  }
}

$('#corpo-equipe').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button');
  if (!botao) return;

  try {
    if (botao.dataset.senha) {
      const senha = prompt(`Nova senha para "${botao.dataset.usuario}" (mín. 8 caracteres, com letras e números):`);
      if (!senha) return;
      await apiAdmin(`/api/admin/usuarios/${botao.dataset.senha}/senha`, { method: 'POST', body: { senha } });
      alert('Senha alterada.');
      return;
    }

    if (botao.dataset.alternar) {
      const ativoAgora = botao.dataset.ativo === 'true';
      const confirmado = await confirmar(
        ativoAgora ? 'Desativar acesso' : 'Reativar acesso',
        `O acesso de "${botao.dataset.usuario}" será ${ativoAgora ? 'bloqueado' : 'liberado'}.`
      );
      if (!confirmado) return;

      await apiAdmin(`/api/admin/usuarios/${botao.dataset.alternar}/ativo`, {
        method: 'POST',
        body: { ativo: !ativoAgora },
      });
      carregarEquipe();
    }
  } catch (erro) {
    if (erro.status !== 401) alert(erro.message);
  }
});

$('#form-admin').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const aviso = $('#aviso-admin');
  limparAviso(aviso);

  try {
    await apiAdmin('/api/admin/usuarios', {
      method: 'POST',
      body: {
        usuario: $('#a-usuario').value,
        nome: $('#a-nome').value,
        senha: $('#a-senha').value,
      },
    });
    mostrarAviso(aviso, 'Acesso criado com sucesso.', 'sucesso');
    evento.target.reset();
    carregarEquipe();
  } catch (erro) {
    if (erro.status !== 401) mostrarAviso(aviso, erro.message);
  }
});

/* =============================== atividade ================================ */

const ROTULOS_ACAO = {
  login: 'Entrou no painel',
  criou_garantia: 'Cadastrou garantia',
  editou_garantia: 'Editou garantia',
  excluiu_garantia: 'Excluiu garantia',
  criou_admin: 'Criou administrador',
  alterou_senha: 'Alterou senha',
  ativou_admin: 'Reativou administrador',
  desativou_admin: 'Desativou administrador',
  backup_json: 'Baixou backup JSON',
  backup_sql: 'Baixou backup SQL',
  restaurou_backup: 'Restaurou backup',
  restaurou_backup_substituindo: 'Restaurou backup (substituindo)',
};

async function carregarLogs() {
  const corpo = $('#corpo-logs');
  corpo.innerHTML = '<tr><td colspan="4" class="vazio">Carregando...</td></tr>';

  try {
    const { logs } = await apiAdmin('/api/admin/logs');
    corpo.innerHTML = logs.length
      ? logs
          .map(
            (l) => `<tr>
              <td>${formatarDataHora(l.criado_em)}</td>
              <td>${escapar(l.admin_nome || '—')}</td>
              <td>${escapar(ROTULOS_ACAO[l.acao] || l.acao)}</td>
              <td>${escapar(l.detalhe || '—')}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="vazio">Nenhuma atividade registrada.</td></tr>';
  } catch (erro) {
    if (erro.status !== 401) corpo.innerHTML = `<tr><td colspan="4" class="vazio">${escapar(erro.message)}</td></tr>`;
  }
}

/* ============================== confirmacao =============================== */

const modal = $('#modal-confirmar');

function confirmar(titulo, texto) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-texto').textContent = texto;
  modal.classList.add('visivel');

  return new Promise((resolver) => {
    const finalizar = (resposta) => {
      modal.classList.remove('visivel');
      $('#modal-ok').removeEventListener('click', aoConfirmar);
      $('#modal-cancelar').removeEventListener('click', aoCancelar);
      modal.removeEventListener('click', aoClicarFora);
      resolver(resposta);
    };
    const aoConfirmar = () => finalizar(true);
    const aoCancelar = () => finalizar(false);
    const aoClicarFora = (evento) => { if (evento.target === modal) finalizar(false); };

    $('#modal-ok').addEventListener('click', aoConfirmar);
    $('#modal-cancelar').addEventListener('click', aoCancelar);
    modal.addEventListener('click', aoClicarFora);
  });
}

/* ================================= inicio ================================= */

// Sessao valida no cookie? Entra direto, sem pedir senha de novo.
try {
  const { admin } = await api('/api/admin/sessao');
  entrarNoPainel(admin);
} catch {
  $('#login-usuario').focus();
}
