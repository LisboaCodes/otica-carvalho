import crypto from 'node:crypto';
import { Router } from 'express';
import { consulta, registrarLog } from './db.js';
import {
  autenticar,
  criarToken,
  definirCookieSessao,
  exigirAdmin,
  gerarHash,
  limparCookieSessao,
  validarSenha,
} from './auth.js';
import { criarLimitador, liberar } from './limitador.js';
import { formatarCPF, garantiaVigente, idadeEmAnos, limparCPF, validarGarantia, validarUsuario } from './validacao.js';

export const rotasAdmin = Router();

const limitarLogin = criarLimitador({
  limite: 6,
  janelaMs: 10 * 60 * 1000,
  mensagem: 'Muitas tentativas de login. Aguarde alguns minutos.',
});

/* ---------------------------------- sessao --------------------------------- */

rotasAdmin.post('/login', limitarLogin, async (req, res, proximo) => {
  try {
    const { usuario, senha } = req.body ?? {};
    if (!usuario || !senha) {
      return res.status(400).json({ erro: 'Informe usuario e senha.' });
    }

    const admin = await autenticar(usuario, senha);
    if (!admin) return res.status(401).json({ erro: 'Usuario ou senha incorretos.' });
    if (admin.bloqueado) return res.status(403).json({ erro: 'Este acesso foi desativado.' });

    liberar(req);
    definirCookieSessao(res, criarToken(admin));
    await registrarLog({ adminId: admin.id, adminNome: admin.nome, acao: 'login' });
    res.json({ admin: { usuario: admin.usuario, nome: admin.nome } });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.post('/logout', (req, res) => {
  limparCookieSessao(res);
  res.json({ ok: true });
});

rotasAdmin.get('/sessao', (req, res) => {
  if (!req.admin) return res.status(401).json({ erro: 'Sem sessao ativa.' });
  res.json({ admin: { usuario: req.admin.usuario, nome: req.admin.nome } });
});

// Tudo abaixo exige admin autenticado.
rotasAdmin.use(exigirAdmin);

/* -------------------------------- garantias -------------------------------- */

function montarLinha(linha) {
  return {
    ...linha,
    cpf_formatado: formatarCPF(linha.cpf),
    idade: idadeEmAnos(linha.data_nascimento),
    ativa: garantiaVigente(linha.validade),
  };
}

const CAMPOS = `id, token, cpf, nome, data_nascimento, data_consulta, produto,
                observacoes, validade, criado_em, atualizado_em`;

/** Lista com busca por nome/CPF, filtro de situacao e paginacao. */
rotasAdmin.get('/garantias', async (req, res, proximo) => {
  try {
    const busca = String(req.query.busca ?? '').trim();
    const situacao = String(req.query.situacao ?? 'todas');
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const porPagina = Math.min(100, Math.max(5, Number(req.query.por_pagina) || 20));

    const condicoes = [];
    const parametros = [];

    if (busca) {
      const cpfBusca = limparCPF(busca);
      if (cpfBusca.length >= 3) {
        parametros.push(`%${cpfBusca}%`);
        condicoes.push(`cpf LIKE $${parametros.length}`);
      } else {
        parametros.push(`%${busca}%`);
        condicoes.push(`nome ILIKE $${parametros.length}`);
      }
    }
    if (situacao === 'ativas') condicoes.push('validade >= CURRENT_DATE');
    if (situacao === 'expiradas') condicoes.push('validade < CURRENT_DATE');

    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const total = await consulta(`SELECT COUNT(*)::int AS total FROM garantias ${onde}`, parametros);
    const { rows } = await consulta(
      `SELECT ${CAMPOS} FROM garantias ${onde}
        ORDER BY criado_em DESC, id DESC
        LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
      [...parametros, porPagina, (pagina - 1) * porPagina]
    );

    res.json({
      garantias: rows.map(montarLinha),
      total: total.rows[0].total,
      pagina,
      por_pagina: porPagina,
    });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.get('/garantias/:id', async (req, res, proximo) => {
  try {
    const { rows } = await consulta(`SELECT ${CAMPOS} FROM garantias WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Garantia nao encontrada.' });
    res.json({ garantia: montarLinha(rows[0]) });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.post('/garantias', async (req, res, proximo) => {
  try {
    const validacao = validarGarantia(req.body);
    if (!validacao.ok) return res.status(400).json({ erro: validacao.erro });

    const d = validacao.dados;
    const token = crypto.randomBytes(16).toString('hex');

    const { rows } = await consulta(
      `INSERT INTO garantias (token, cpf, nome, data_nascimento, data_consulta, produto, observacoes, validade, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${CAMPOS}`,
      [token, d.cpf, d.nome, d.data_nascimento, d.data_consulta, d.produto, d.observacoes, d.validade, req.admin.id]
    );

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'criou_garantia',
      garantiaId: rows[0].id,
      detalhe: `${d.nome} (${formatarCPF(d.cpf)})`,
    });

    res.status(201).json({ garantia: montarLinha(rows[0]) });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.put('/garantias/:id', async (req, res, proximo) => {
  try {
    const validacao = validarGarantia(req.body);
    if (!validacao.ok) return res.status(400).json({ erro: validacao.erro });

    const d = validacao.dados;
    const { rows } = await consulta(
      `UPDATE garantias
          SET cpf = $1, nome = $2, data_nascimento = $3, data_consulta = $4,
              produto = $5, observacoes = $6, validade = $7, atualizado_em = NOW()
        WHERE id = $8
        RETURNING ${CAMPOS}`,
      [d.cpf, d.nome, d.data_nascimento, d.data_consulta, d.produto, d.observacoes, d.validade, req.params.id]
    );

    if (!rows.length) return res.status(404).json({ erro: 'Garantia nao encontrada.' });

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'editou_garantia',
      garantiaId: rows[0].id,
      detalhe: `${d.nome} (${formatarCPF(d.cpf)})`,
    });

    res.json({ garantia: montarLinha(rows[0]) });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.delete('/garantias/:id', async (req, res, proximo) => {
  try {
    const { rows } = await consulta(
      'DELETE FROM garantias WHERE id = $1 RETURNING id, nome, cpf',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Garantia nao encontrada.' });

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'excluiu_garantia',
      garantiaId: rows[0].id,
      detalhe: `${rows[0].nome} (${formatarCPF(rows[0].cpf)})`,
    });

    res.json({ ok: true });
  } catch (erro) {
    proximo(erro);
  }
});

/* -------------------------------- indicadores ------------------------------- */

rotasAdmin.get('/resumo', async (_req, res, proximo) => {
  try {
    const { rows } = await consulta(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE validade >= CURRENT_DATE)::int AS ativas,
             COUNT(*) FILTER (WHERE validade < CURRENT_DATE)::int AS expiradas,
             COUNT(*) FILTER (WHERE validade BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS vencendo,
             COUNT(*) FILTER (WHERE criado_em >= DATE_TRUNC('month', CURRENT_DATE))::int AS no_mes
        FROM garantias
    `);
    res.json(rows[0]);
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.get('/logs', async (_req, res, proximo) => {
  try {
    const { rows } = await consulta(
      'SELECT admin_nome, acao, garantia_id, detalhe, criado_em FROM log_acoes ORDER BY criado_em DESC LIMIT 60'
    );
    res.json({ logs: rows });
  } catch (erro) {
    proximo(erro);
  }
});

/* ---------------------------------- admins --------------------------------- */

rotasAdmin.get('/usuarios', async (_req, res, proximo) => {
  try {
    const { rows } = await consulta(
      'SELECT id, usuario, nome, ativo, criado_em, ultimo_acesso FROM admins ORDER BY id'
    );
    res.json({ usuarios: rows });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.post('/usuarios', async (req, res, proximo) => {
  try {
    const validacaoUsuario = validarUsuario(req.body?.usuario);
    if (!validacaoUsuario.ok) return res.status(400).json({ erro: validacaoUsuario.erro });

    const usuario = validacaoUsuario.usuario;
    const nome = String(req.body?.nome ?? '').trim();
    const senha = String(req.body?.senha ?? '');

    if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome do funcionario.' });

    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });

    const { rows } = await consulta(
      'INSERT INTO admins (usuario, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id, usuario, nome, ativo, criado_em',
      [usuario, nome, await gerarHash(senha)]
    );

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'criou_admin',
      detalhe: usuario,
    });

    res.status(201).json({ usuario: rows[0] });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Ja existe um admin com esse usuario.' });
    proximo(erro);
  }
});

/** Corrige usuario/nome de um admin — inclusive o proprio, sem perder a sessao. */
rotasAdmin.put('/usuarios/:id', async (req, res, proximo) => {
  try {
    const validacaoUsuario = validarUsuario(req.body?.usuario);
    if (!validacaoUsuario.ok) return res.status(400).json({ erro: validacaoUsuario.erro });

    const nome = String(req.body?.nome ?? '').trim();
    if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome do funcionario.' });

    const { rows } = await consulta(
      'UPDATE admins SET usuario = $1, nome = $2 WHERE id = $3 RETURNING id, usuario, nome, ativo',
      [validacaoUsuario.usuario, nome, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Admin nao encontrado.' });

    // Renomeando a si mesmo, o cookie ainda carrega os dados antigos: reemite.
    if (rows[0].id === req.admin.id) {
      definirCookieSessao(res, criarToken(rows[0]));
    }

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'editou_admin',
      detalhe: `#${rows[0].id} agora e ${rows[0].usuario}`,
    });

    res.json({ usuario: rows[0] });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Ja existe um admin com esse usuario.' });
    proximo(erro);
  }
});

rotasAdmin.post('/usuarios/:id/senha', async (req, res, proximo) => {
  try {
    const erroSenha = validarSenha(req.body?.senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });

    const { rowCount } = await consulta('UPDATE admins SET senha_hash = $1 WHERE id = $2', [
      await gerarHash(req.body.senha),
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ erro: 'Admin nao encontrado.' });

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'alterou_senha',
      detalhe: `admin #${req.params.id}`,
    });
    res.json({ ok: true });
  } catch (erro) {
    proximo(erro);
  }
});

rotasAdmin.post('/usuarios/:id/ativo', async (req, res, proximo) => {
  try {
    const id = Number(req.params.id);
    if (id === req.admin.id) {
      return res.status(400).json({ erro: 'Voce nao pode desativar o proprio acesso.' });
    }

    const { rows } = await consulta(
      'UPDATE admins SET ativo = $1 WHERE id = $2 RETURNING id, usuario, ativo',
      [Boolean(req.body?.ativo), id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Admin nao encontrado.' });

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: rows[0].ativo ? 'ativou_admin' : 'desativou_admin',
      detalhe: rows[0].usuario,
    });
    res.json({ usuario: rows[0] });
  } catch (erro) {
    proximo(erro);
  }
});
