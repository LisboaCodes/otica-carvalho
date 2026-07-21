import {
  $, api, aplicarMascaraCPF, cpfValido, hojeISO, limparAviso,
  limparCPF, mostrarAviso, renderizarCertificados,
} from './comum.js';

const form = $('#form-consulta');
const campoCPF = $('#cpf');
const campoNascimento = $('#nascimento');
const aviso = $('#aviso');
const resultado = $('#resultado');
const btnBuscar = $('#btn-buscar');

aplicarMascaraCPF(campoCPF);
campoNascimento.max = hojeISO();

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparAviso(aviso);
  resultado.innerHTML = '';
  campoCPF.removeAttribute('aria-invalid');
  campoNascimento.removeAttribute('aria-invalid');

  const cpf = limparCPF(campoCPF.value);
  const nascimento = campoNascimento.value;

  if (!cpfValido(cpf)) {
    campoCPF.setAttribute('aria-invalid', 'true');
    campoCPF.focus();
    return mostrarAviso(aviso, 'CPF inválido. Confira os 11 dígitos.');
  }
  if (!nascimento) {
    campoNascimento.setAttribute('aria-invalid', 'true');
    campoNascimento.focus();
    return mostrarAviso(aviso, 'Informe a data de nascimento.');
  }

  btnBuscar.disabled = true;
  btnBuscar.textContent = 'Buscando...';

  try {
    const { garantias } = await api('/api/consulta', {
      method: 'POST',
      body: { cpf, data_nascimento: nascimento },
    });

    const ativas = garantias.filter((g) => g.ativa).length;
    mostrarAviso(
      aviso,
      garantias.length === 1
        ? 'Garantia encontrada.'
        : `${garantias.length} garantias encontradas (${ativas} ativa${ativas === 1 ? '' : 's'}).`,
      'sucesso'
    );
    renderizarCertificados(resultado, garantias);
    resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (erro) {
    mostrarAviso(aviso, erro.message);
  } finally {
    btnBuscar.disabled = false;
    btnBuscar.textContent = 'Buscar garantia';
  }
});

$('#btn-limpar').addEventListener('click', () => {
  form.reset();
  limparAviso(aviso);
  resultado.innerHTML = '';
  campoCPF.focus();
});
