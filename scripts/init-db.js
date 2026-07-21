// Cria/verifica as tabelas no Neon sem subir o servidor.
//   npm run db:init

import { inicializarBanco, consulta, pool } from '../server/db.js';

try {
  await inicializarBanco();
  const { rows } = await consulta(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('admins', 'garantias', 'log_acoes')
     ORDER BY table_name
  `);
  console.log('\nTabelas prontas no Neon:', rows.map((r) => r.table_name).join(', '));

  const admins = await consulta('SELECT COUNT(*)::int AS total FROM admins');
  if (admins.rows[0].total === 0) {
    console.log('\nNenhum admin cadastrado ainda. Crie o primeiro com:');
    console.log('  npm run admin:criar -- carvalho "Seu Nome" SuaSenha123\n');
  } else {
    console.log(`Admins cadastrados: ${admins.rows[0].total}\n`);
  }
} catch (erro) {
  console.error('\nFalha ao inicializar o banco:', erro.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
