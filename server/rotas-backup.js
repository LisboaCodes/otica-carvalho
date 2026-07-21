import crypto from 'node:crypto';
import { Router } from 'express';
import { consulta, pool, registrarLog } from './db.js';
import { exigirAdmin } from './auth.js';
import { validarGarantia } from './validacao.js';

export const rotasBackup = Router();
rotasBackup.use(exigirAdmin);

const VERSAO_BACKUP = 1;

function carimboArquivo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function lerTudo() {
  const garantias = await consulta(
    `SELECT id, token, cpf, nome, data_nascimento, data_consulta, produto, observacoes,
            validade, criado_por, criado_em, atualizado_em
       FROM garantias ORDER BY id`
  );
  const admins = await consulta(
    'SELECT id, usuario, nome, senha_hash, ativo, criado_em, ultimo_acesso FROM admins ORDER BY id'
  );
  const logs = await consulta(
    'SELECT id, admin_id, admin_nome, acao, garantia_id, detalhe, criado_em FROM log_acoes ORDER BY id'
  );
  return { garantias: garantias.rows, admins: admins.rows, logs: logs.rows };
}

/* ------------------------------ backup em JSON ------------------------------ */

rotasBackup.get('/json', async (req, res, proximo) => {
  try {
    const dados = await lerTudo();
    const pacote = {
      versao: VERSAO_BACKUP,
      origem: 'otica-carvalho-garantias',
      gerado_em: new Date().toISOString(),
      gerado_por: req.admin.usuario,
      totais: {
        garantias: dados.garantias.length,
        admins: dados.admins.length,
        logs: dados.logs.length,
      },
      dados,
    };

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'backup_json',
      detalhe: `${dados.garantias.length} garantias`,
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-otica-carvalho-${carimboArquivo()}.json"`
    );
    res.send(JSON.stringify(pacote, null, 2));
  } catch (erro) {
    proximo(erro);
  }
});

/* ------------------------------- backup em SQL ------------------------------ */

function aspasSQL(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE';
  if (typeof valor === 'number') return String(valor);
  if (valor instanceof Date) return `'${valor.toISOString()}'`;
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function inserts(tabela, colunas, linhas) {
  if (!linhas.length) return `-- (sem registros em ${tabela})\n`;
  return (
    linhas
      .map(
        (linha) =>
          `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas
            .map((coluna) => aspasSQL(linha[coluna]))
            .join(', ')});`
      )
      .join('\n') + '\n'
  );
}

/**
 * Dump portatil: roda em qualquer Postgres (Neon, Supabase, RDS, local).
 * Inclui schema + dados + ajuste das sequences.
 */
rotasBackup.get('/sql', async (req, res, proximo) => {
  try {
    const { garantias, admins, logs } = await lerTudo();

    const dump = `-- Backup do sistema de garantias da Otica Carvalho
-- Gerado em: ${new Date().toISOString()}
-- Por: ${req.admin.usuario}
-- Registros: ${garantias.length} garantias, ${admins.length} admins, ${logs.length} logs
--
-- Restaurar em qualquer Postgres:
--   psql "SUA_CONNECTION_STRING" -f este-arquivo.sql

BEGIN;

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  usuario       TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  senha_hash    TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS garantias (
  id              SERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  cpf             TEXT NOT NULL,
  nome            TEXT NOT NULL,
  data_nascimento DATE NOT NULL,
  data_consulta   DATE,
  produto         TEXT,
  observacoes     TEXT,
  validade        DATE NOT NULL,
  criado_por      INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garantias_cpf ON garantias (cpf);
CREATE INDEX IF NOT EXISTS idx_garantias_validade ON garantias (validade);

CREATE TABLE IF NOT EXISTS log_acoes (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  admin_nome  TEXT,
  acao        TEXT NOT NULL,
  garantia_id INTEGER,
  detalhe     TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_criado_em ON log_acoes (criado_em DESC);

-- Limpa o destino antes de repovoar.
TRUNCATE log_acoes, garantias, admins RESTART IDENTITY CASCADE;

${inserts('admins', ['id', 'usuario', 'nome', 'senha_hash', 'ativo', 'criado_em', 'ultimo_acesso'], admins)}
${inserts(
  'garantias',
  ['id', 'token', 'cpf', 'nome', 'data_nascimento', 'data_consulta', 'produto', 'observacoes', 'validade', 'criado_por', 'criado_em', 'atualizado_em'],
  garantias
)}
${inserts('log_acoes', ['id', 'admin_id', 'admin_nome', 'acao', 'garantia_id', 'detalhe', 'criado_em'], logs)}
-- Reposiciona as sequences para o proximo INSERT nao colidir.
SELECT setval(pg_get_serial_sequence('admins', 'id'), COALESCE((SELECT MAX(id) FROM admins), 1), TRUE);
SELECT setval(pg_get_serial_sequence('garantias', 'id'), COALESCE((SELECT MAX(id) FROM garantias), 1), TRUE);
SELECT setval(pg_get_serial_sequence('log_acoes', 'id'), COALESCE((SELECT MAX(id) FROM log_acoes), 1), TRUE);

COMMIT;
`;

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: 'backup_sql',
      detalhe: `${garantias.length} garantias`,
    });

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-otica-carvalho-${carimboArquivo()}.sql"`
    );
    res.send(dump);
  } catch (erro) {
    proximo(erro);
  }
});

/* ------------------------------- backup em CSV ------------------------------ */

rotasBackup.get('/csv', async (req, res, proximo) => {
  try {
    const { rows } = await consulta(
      `SELECT cpf, nome, data_nascimento, data_consulta, produto, observacoes, validade, criado_em
         FROM garantias ORDER BY id`
    );

    const colunas = ['cpf', 'nome', 'data_nascimento', 'data_consulta', 'produto', 'observacoes', 'validade', 'criado_em'];
    const celula = (valor) => {
      if (valor === null || valor === undefined) return '';
      const texto = valor instanceof Date ? valor.toISOString() : String(valor);
      return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };

    // BOM + separador ";" para o Excel em portugues abrir sem bagunçar acentos.
    const csv =
      '﻿' +
      [colunas.join(';'), ...rows.map((linha) => colunas.map((c) => celula(linha[c])).join(';'))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="garantias-otica-carvalho-${carimboArquivo()}.csv"`
    );
    res.send(csv);
  } catch (erro) {
    proximo(erro);
  }
});

/* --------------------------------- restauracao ------------------------------ */

/**
 * Importa um backup JSON. Modo "mesclar" (padrao) mantem o que ja existe e
 * ignora garantias repetidas; modo "substituir" apaga as garantias atuais antes.
 * Admins nunca sao sobrescritos, para nao derrubar o proprio acesso.
 */
rotasBackup.post('/restaurar', async (req, res, proximo) => {
  const cliente = await pool.connect();
  try {
    const pacote = req.body?.dados ? req.body : req.body?.pacote;
    const lista = pacote?.dados?.garantias;

    if (!Array.isArray(lista)) {
      return res.status(400).json({ erro: 'Arquivo invalido: nao encontrei "dados.garantias".' });
    }
    if (pacote.versao !== VERSAO_BACKUP) {
      return res.status(400).json({ erro: `Versao de backup incompativel (esperado ${VERSAO_BACKUP}).` });
    }

    const substituir = req.body?.modo === 'substituir';
    let inseridas = 0;
    let ignoradas = 0;
    const problemas = [];

    await cliente.query('BEGIN');
    if (substituir) await cliente.query('DELETE FROM garantias');

    for (const [indice, item] of lista.entries()) {
      const validacao = validarGarantia(item);
      if (!validacao.ok) {
        ignoradas++;
        if (problemas.length < 10) problemas.push(`Linha ${indice + 1}: ${validacao.erro}`);
        continue;
      }

      const d = validacao.dados;
      const token = /^[a-f0-9]{32}$/.test(item.token ?? '')
        ? item.token
        : crypto.randomBytes(16).toString('hex');

      const { rowCount } = await cliente.query(
        `INSERT INTO garantias (token, cpf, nome, data_nascimento, data_consulta, produto, observacoes, validade, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (token) DO NOTHING`,
        [token, d.cpf, d.nome, d.data_nascimento, d.data_consulta, d.produto, d.observacoes, d.validade, req.admin.id]
      );

      if (rowCount) inseridas++;
      else ignoradas++;
    }

    await cliente.query('COMMIT');

    await registrarLog({
      adminId: req.admin.id,
      adminNome: req.admin.nome,
      acao: substituir ? 'restaurou_backup_substituindo' : 'restaurou_backup',
      detalhe: `${inseridas} inseridas, ${ignoradas} ignoradas`,
    });

    res.json({ inseridas, ignoradas, problemas });
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    proximo(erro);
  } finally {
    cliente.release();
  }
});
