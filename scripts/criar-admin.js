// Cria o primeiro administrador (ou adiciona outro) direto pelo terminal.
//   npm run admin:criar -- <usuario> "<Nome Completo>" <senha>

import { consulta, inicializarBanco, pool } from '../server/db.js';
import { gerarHash, validarSenha } from '../server/auth.js';

const [usuarioBruto, nome, senha] = process.argv.slice(2);

if (!usuarioBruto || !nome || !senha) {
  console.error('\nUso: npm run admin:criar -- <usuario> "<Nome Completo>" <senha>');
  console.error('Ex.:  npm run admin:criar -- carvalho "Jose Carvalho" MinhaSenha123\n');
  process.exit(1);
}

const usuario = usuarioBruto.trim().toLowerCase();

if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
  console.error('Usuario deve ter 3 a 30 caracteres: letras, numeros, ponto, hifen ou underline.');
  process.exit(1);
}

const erroSenha = validarSenha(senha);
if (erroSenha) {
  console.error(erroSenha);
  process.exit(1);
}

try {
  await inicializarBanco();
  const { rows } = await consulta(
    'INSERT INTO admins (usuario, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id, usuario, nome',
    [usuario, nome.trim(), await gerarHash(senha)]
  );
  console.log(`\nAdmin criado: #${rows[0].id} ${rows[0].usuario} (${rows[0].nome})`);
  console.log('Acesse http://localhost:3000/admin para entrar.\n');
} catch (erro) {
  if (erro.code === '23505') console.error(`\nJa existe um admin com o usuario "${usuario}".\n`);
  else console.error('\nFalha ao criar admin:', erro.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
