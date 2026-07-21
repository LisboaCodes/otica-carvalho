// Regras de dominio compartilhadas pelo servidor.

export function limparCPF(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Valida CPF pelos dois digitos verificadores. */
export function cpfValido(valor) {
  const cpf = limparCPF(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 00000000000, 11111111111, ...

  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) {
      soma += Number(cpf[i]) * (posicao + 1 - i);
    }
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(cpf[posicao])) return false;
  }
  return true;
}

export function formatarCPF(valor) {
  const cpf = limparCPF(valor);
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Aceita apenas "YYYY-MM-DD" que corresponda a uma data real do calendario. */
export function dataValida(valor) {
  if (!DATA_ISO.test(String(valor ?? ''))) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia <= ultimoDia && ano >= 1900 && ano <= 2200;
}

export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function idadeEmAnos(dataNascimento, referencia = hojeISO()) {
  if (!dataValida(dataNascimento)) return null;
  const [an, mn, dn] = dataNascimento.split('-').map(Number);
  const [ar, mr, dr] = referencia.split('-').map(Number);
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade -= 1;
  return idade >= 0 ? idade : null;
}

export function garantiaVigente(validade, referencia = hojeISO()) {
  return dataValida(validade) && validade >= referencia;
}

/**
 * Valida e normaliza o corpo de uma garantia vindo do painel.
 * Retorna { ok: true, dados } ou { ok: false, erro }.
 */
export function validarGarantia(corpo) {
  const nome = String(corpo?.nome ?? '').trim().replace(/\s+/g, ' ');
  const cpf = limparCPF(corpo?.cpf);
  const dataNascimento = String(corpo?.data_nascimento ?? '').trim();
  const validade = String(corpo?.validade ?? '').trim();
  const dataConsulta = String(corpo?.data_consulta ?? '').trim();
  const produto = String(corpo?.produto ?? '').trim();
  const observacoes = String(corpo?.observacoes ?? '').trim();

  if (nome.length < 3) return { ok: false, erro: 'Informe o nome completo do cliente.' };
  if (nome.length > 120) return { ok: false, erro: 'Nome muito longo (maximo 120 caracteres).' };
  if (!cpfValido(cpf)) return { ok: false, erro: 'CPF invalido. Confira os 11 digitos.' };
  if (!dataValida(dataNascimento)) return { ok: false, erro: 'Data de nascimento invalida.' };
  if (dataNascimento > hojeISO()) return { ok: false, erro: 'Data de nascimento no futuro.' };
  if (!dataValida(validade)) return { ok: false, erro: 'Data de validade da garantia invalida.' };
  if (dataConsulta && !dataValida(dataConsulta)) return { ok: false, erro: 'Data da consulta invalida.' };
  if (dataConsulta && validade < dataConsulta) {
    return { ok: false, erro: 'A validade nao pode ser anterior a data da consulta.' };
  }
  if (produto.length > 200) return { ok: false, erro: 'Descricao do produto muito longa.' };
  if (observacoes.length > 500) return { ok: false, erro: 'Observacoes muito longas (maximo 500).' };

  return {
    ok: true,
    dados: {
      nome,
      cpf,
      data_nascimento: dataNascimento,
      data_consulta: dataConsulta || null,
      produto: produto || null,
      observacoes: observacoes || null,
      validade,
    },
  };
}
