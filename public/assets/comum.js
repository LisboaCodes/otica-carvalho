// Utilidades compartilhadas entre a consulta publica e o painel admin.

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

/** Escapa texto do banco antes de injetar em HTML. */
export function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const limparCPF = (valor) => String(valor ?? '').replace(/\D/g, '');

export function formatarCPF(valor) {
  const cpf = limparCPF(valor);
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/** Mascara o campo enquanto o usuario digita: 000.000.000-00 */
export function aplicarMascaraCPF(input) {
  input.addEventListener('input', () => {
    const cpf = limparCPF(input.value).slice(0, 11);
    let saida = cpf;
    if (cpf.length > 9) saida = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    else if (cpf.length > 6) saida = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6)}`;
    else if (cpf.length > 3) saida = `${cpf.slice(0, 3)}.${cpf.slice(3)}`;
    input.value = saida;
    input.removeAttribute('aria-invalid');
  });
}

export function cpfValido(valor) {
  const cpf = limparCPF(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) soma += Number(cpf[i]) * (posicao + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(cpf[posicao])) return false;
  }
  return true;
}

/** "2026-07-21" -> "21/07/2026" */
export const formatarData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

export function formatarDataHora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const hojeISO = () => {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function diasAte(iso) {
  if (!iso) return null;
  const alvo = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const hoje = new Date(`${hojeISO()}T00:00:00`);
  return Math.round((alvo - hoje) / 86_400_000);
}

/* --------------------------------- rede ----------------------------------- */

export class ErroAPI extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    credentials: 'same-origin',
    headers: opcoes.body ? { 'Content-Type': 'application/json' } : {},
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });

  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch {
    // resposta sem JSON (ex.: HTML de erro)
  }

  if (!resposta.ok) {
    throw new ErroAPI(corpo?.erro || `Falha na requisicao (${resposta.status}).`, resposta.status);
  }
  return corpo;
}

/* -------------------------------- avisos ---------------------------------- */

export function mostrarAviso(elemento, mensagem, tipo = 'erro') {
  if (!elemento) return;
  elemento.textContent = mensagem;
  elemento.className = `aviso visivel ${tipo}`;
}

export function limparAviso(elemento) {
  if (!elemento) return;
  elemento.textContent = '';
  elemento.className = 'aviso';
}

/* ------------------------------ certificado ------------------------------- */

export function certificadoHTML(g, { idQR } = {}) {
  const qrId = idQR ?? `qr-${g.id}`;
  const dias = diasAte(g.validade);
  const rotuloStatus = g.ativa
    ? dias === 0
      ? 'Vence hoje'
      : `Garantia ativa — ${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}`
    : 'Garantia expirada';

  const linha = (rotulo, valor) =>
    valor ? `<dt>${rotulo}</dt><dd>${escapar(valor)}</dd>` : '';

  return `<article class="cert">
    <div class="eyebrow">Certificado de Garantia</div>
    <div class="cert-row">
      <div class="cert-fields">
        <div class="cert-nome">${escapar(g.nome)}</div>
        <span class="status ${g.ativa ? 'ok' : 'exp'}">${rotuloStatus}</span>
        <dl>
          ${linha('CPF', g.cpf)}
          ${g.idade !== null && g.idade !== undefined ? `<dt>Idade</dt><dd>${g.idade} anos</dd>` : ''}
          ${linha('Produto', g.produto)}
          ${linha('Consulta', formatarData(g.data_consulta))}
          <dt>Valida ate</dt><dd>${formatarData(g.validade)}</dd>
          ${linha('Observacoes', g.observacoes)}
        </dl>
      </div>
      <div class="qr-box">
        <div id="${qrId}"></div>
        <small>ESCANEIE PARA<br>VALIDAR</small>
      </div>
    </div>
  </article>`;
}

/** Desenha o QR apontando para /v/<token>, que abre o certificado direto. */
export function desenharQR(g, idQR) {
  const alvo = document.getElementById(idQR ?? `qr-${g.id}`);
  if (!alvo || typeof QRCode === 'undefined' || !g.token) return;
  alvo.innerHTML = '';
  new QRCode(alvo, {
    text: `${location.origin}/v/${g.token}`,
    width: 118,
    height: 118,
    colorDark: '#12303a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

export function renderizarCertificados(container, garantias) {
  container.innerHTML = garantias.map((g) => certificadoHTML(g)).join('');
  garantias.forEach((g) => desenharQR(g));
}
