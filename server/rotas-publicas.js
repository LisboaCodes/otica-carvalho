import { Router } from 'express';
import { consulta } from './db.js';
import { criarLimitador } from './limitador.js';
import {
  cpfValido,
  dataValida,
  formatarCPF,
  garantiaVigente,
  idadeEmAnos,
  limparCPF,
} from './validacao.js';

export const rotasPublicas = Router();

const limitarConsulta = criarLimitador({
  limite: 12,
  janelaMs: 5 * 60 * 1000,
  mensagem: 'Muitas consultas seguidas. Aguarde alguns minutos e tente novamente.',
});

function montarCertificado(linha) {
  return {
    id: linha.id,
    token: linha.token,
    nome: linha.nome,
    cpf: formatarCPF(linha.cpf),
    data_nascimento: linha.data_nascimento,
    idade: idadeEmAnos(linha.data_nascimento),
    produto: linha.produto,
    observacoes: linha.observacoes,
    data_consulta: linha.data_consulta,
    validade: linha.validade,
    ativa: garantiaVigente(linha.validade),
  };
}

/**
 * Consulta publica: exige CPF + data de nascimento.
 * A dupla evita que qualquer pessoa com um CPF veja os dados do titular.
 */
rotasPublicas.post('/consulta', limitarConsulta, async (req, res, proximo) => {
  try {
    const cpf = limparCPF(req.body?.cpf);
    const nascimento = String(req.body?.data_nascimento ?? '').trim();

    if (!cpfValido(cpf)) {
      return res.status(400).json({ erro: 'CPF invalido. Digite os 11 digitos.' });
    }
    if (!dataValida(nascimento)) {
      return res.status(400).json({ erro: 'Informe a data de nascimento do titular.' });
    }

    const { rows } = await consulta(
      `SELECT id, token, nome, cpf, data_nascimento, data_consulta, produto, observacoes, validade
         FROM garantias
        WHERE cpf = $1 AND data_nascimento = $2
        ORDER BY validade DESC, id DESC`,
      [cpf, nascimento]
    );

    if (rows.length === 0) {
      // Resposta unica para CPF inexistente e para data que nao confere:
      // nao confirma se aquele CPF esta ou nao cadastrado.
      return res.status(404).json({
        erro: 'Nenhuma garantia encontrada para esse CPF e data de nascimento. Confira os dados digitados.',
      });
    }

    res.json({ garantias: rows.map(montarCertificado) });
  } catch (erro) {
    proximo(erro);
  }
});

/** Validacao por QR Code: o token impresso no certificado abre os dados direto. */
rotasPublicas.get('/garantia/:token', async (req, res, proximo) => {
  try {
    const token = String(req.params.token ?? '');
    if (!/^[a-f0-9]{32}$/.test(token)) {
      return res.status(400).json({ erro: 'Codigo de validacao invalido.' });
    }

    const { rows } = await consulta(
      `SELECT id, token, nome, cpf, data_nascimento, data_consulta, produto, observacoes, validade
         FROM garantias WHERE token = $1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: 'Certificado nao encontrado ou removido.' });
    }

    res.json({ garantias: [montarCertificado(rows[0])] });
  } catch (erro) {
    proximo(erro);
  }
});
