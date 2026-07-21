import pg from 'pg';

const { Pool, types } = pg;

// O driver devolve DATE como objeto Date no fuso local, o que empurra a data
// um dia para tras dependendo do horario. Como so guardamos datas (sem hora),
// lemos o valor cru "YYYY-MM-DD" que o Postgres ja envia.
types.setTypeParser(1082, (valor) => valor);
// NUMERIC como number em vez de string.
types.setTypeParser(1700, (valor) => (valor === null ? null : Number(valor)));

if (!process.env.DATABASE_URL) {
  console.error('\nDATABASE_URL nao definida. Copie .env.example para .env e preencha a conexao do Postgres.\n');
  process.exit(1);
}

/**
 * Decide o TLS a partir de DATABASE_SSL ou do sslmode= da URL.
 * Padrao: desligado — no Coolify o app fala com o Postgres pela rede interna
 * do Docker, onde o trafego nao sai do servidor e nao ha certificado.
 * Postgres gerenciado na internet (Neon, RDS, Supabase) precisa de sslmode=require.
 */
function configurarSSL(url) {
  const forcado = String(process.env.DATABASE_SSL ?? '').trim().toLowerCase();
  let sslmode = '';
  try {
    sslmode = new URL(url).searchParams.get('sslmode') ?? '';
  } catch {
    // URL fora do padrao: cai no modo explicito ou no padrao desligado.
  }

  const modo = forcado || sslmode;
  if (modo === 'verify-full' || modo === 'verify') return { rejectUnauthorized: true };
  if (modo === 'require' || modo === 'no-verify' || modo === 'prefer' || modo === 'on') {
    return { rejectUnauthorized: false };
  }
  return false;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: configurarSSL(process.env.DATABASE_URL),
  max: Number(process.env.DB_POOL_MAX) || 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (erro) => {
  console.error('[db] erro no pool de conexoes:', erro.message);
});

export function consulta(sql, parametros = []) {
  return pool.query(sql, parametros);
}

const SCHEMA = `
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
  id               SERIAL PRIMARY KEY,
  token            TEXT NOT NULL UNIQUE,
  cpf              TEXT NOT NULL,
  nome             TEXT NOT NULL,
  data_nascimento  DATE NOT NULL,
  data_consulta    DATE,
  produto          TEXT,
  observacoes      TEXT,
  validade         DATE NOT NULL,
  criado_por       INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garantias_cpf ON garantias (cpf);
CREATE INDEX IF NOT EXISTS idx_garantias_validade ON garantias (validade);

-- Trilha de auditoria: quem cadastrou, alterou ou excluiu cada garantia.
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
`;

export async function inicializarBanco() {
  await pool.query(SCHEMA);
}

export async function registrarLog({ adminId, adminNome, acao, garantiaId = null, detalhe = null }) {
  try {
    await pool.query(
      `INSERT INTO log_acoes (admin_id, admin_nome, acao, garantia_id, detalhe)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, adminNome, acao, garantiaId, detalhe]
    );
  } catch (erro) {
    // Auditoria nunca deve derrubar a operacao principal.
    console.error('[log] falha ao registrar acao:', erro.message);
  }
}
