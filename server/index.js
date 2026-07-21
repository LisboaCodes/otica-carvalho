import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { consulta, inicializarBanco, pool } from './db.js';
import { gerarHash, sessaoOpcional, validarSenha } from './auth.js';
import { rotasPublicas } from './rotas-publicas.js';
import { rotasAdmin } from './rotas-admin.js';
import { rotasBackup } from './rotas-backup.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const publico = path.join(raiz, '..', 'public');

const app = express();
app.set('trust proxy', 1); // IP real do cliente atras de proxy/HTTPS
app.disable('x-powered-by');

app.use(express.json({ limit: '8mb' })); // limite folgado por causa da restauracao de backup
app.use(sessaoOpcional);

app.use((_req, res, proximo) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  proximo();
});

app.get('/api/saude', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, banco: 'conectado' });
  } catch (erro) {
    res.status(503).json({ ok: false, banco: 'indisponivel', detalhe: erro.message });
  }
});

app.use('/api', rotasPublicas);
app.use('/api/admin', rotasAdmin);
app.use('/api/admin/backup', rotasBackup);

app.use(express.static(publico, { extensions: ['html'] }));

// Rota amigavel do QR Code: /v/<token> abre a pagina de validacao.
app.get('/v/:token', (_req, res) => res.sendFile(path.join(publico, 'validar.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota nao encontrada.' });
  res.status(404).sendFile(path.join(publico, 'index.html'));
});

app.use((erro, _req, res, _proximo) => {
  console.error('[erro]', erro);
  res.status(500).json({ erro: 'Erro interno no servidor. Tente novamente.' });
});

/**
 * Cria o primeiro admin a partir de ADMIN_USUARIO/ADMIN_SENHA quando a tabela
 * esta vazia. Existe para o deploy em container, onde nao da para rodar o
 * script interativo. Nao mexe em nada se ja houver algum admin cadastrado.
 */
async function garantirAdminInicial() {
  const usuario = String(process.env.ADMIN_USUARIO ?? '').trim().toLowerCase();
  const senha = String(process.env.ADMIN_SENHA ?? '');
  if (!usuario || !senha) return;

  const { rows } = await consulta('SELECT COUNT(*)::int AS total FROM admins');
  if (rows[0].total > 0) return;

  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    console.error(`[admin] ADMIN_SENHA rejeitada: ${erroSenha} Nenhum admin foi criado.`);
    return;
  }

  await consulta('INSERT INTO admins (usuario, nome, senha_hash) VALUES ($1, $2, $3)', [
    usuario,
    String(process.env.ADMIN_NOME ?? '').trim() || 'Administrador',
    await gerarHash(senha),
  ]);
  console.log(`[admin] primeiro administrador criado: ${usuario}`);
}

/** Espera o Postgres aceitar conexoes — no Coolify o banco pode subir depois do app. */
async function conectarComEspera(tentativas = 10) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      await inicializarBanco();
      console.log('[db] conectado, schema verificado');
      return;
    } catch (erro) {
      if (tentativa === tentativas) throw erro;
      const espera = Math.min(1000 * 2 ** (tentativa - 1), 8000);
      console.warn(`[db] tentativa ${tentativa}/${tentativas} falhou (${erro.message}). Nova tentativa em ${espera}ms.`);
      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }
}

const porta = Number(process.env.PORT) || 3000;

try {
  await conectarComEspera();
  await garantirAdminInicial();
} catch (erro) {
  console.error('\n[db] nao foi possivel conectar ao Postgres:', erro.message);
  console.error('Confira a DATABASE_URL (no .env local ou nas variaveis do Coolify).\n');
  process.exit(1);
}

const servidor = app.listen(porta, '0.0.0.0', () => {
  console.log(`\n  Otica Carvalho — Garantia Digital`);
  console.log(`  Consulta publica : http://localhost:${porta}/`);
  console.log(`  Painel admin     : http://localhost:${porta}/admin\n`);
});

// O Docker manda SIGTERM ao reiniciar o container: fecha tudo sem cortar requisicoes.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`\n[app] ${sinal} recebido, encerrando...`);
    servidor.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
