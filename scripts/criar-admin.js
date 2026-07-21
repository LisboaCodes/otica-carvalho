// Cria o primeiro administrador (ou adiciona outro) direto pelo terminal.
//   npm run admin:criar -- <usuario> "<Nome Completo>" <senha>

import { consulta, inicializarBanco, pool } from '../server/db.js';
import { gerarHash, validarSenha } from '../server/auth.js';
import { validarUsuario } from '../server/validacao.js';

const [usuarioBruto, nome, senha] = process.argv.slice(2);

if (!usuarioBruto || !nome || !senha) {
  console.error('\nUso: npm run admin:criar -- <usuario> "<Nome Completo>" <senha>');
  console.error('Ex.:  npm run admin:criar -- carvalho "Jose Carvalho" MinhaSenha123\n');
  process.exit(1);
}

const validacaoUsuario = validarUsuario(usuarioBruto);
if (!validacaoUsuario.ok) {
  console.error(validacaoUsuario.erro);
  process.exit(1);
}
const usuario = validacaoUsuario.usuario;

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
