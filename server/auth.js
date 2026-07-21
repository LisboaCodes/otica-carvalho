import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { consulta } from './db.js';

const NOME_COOKIE = 'oc_sessao';
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas

const SEGREDO = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn(
    '[auth] SESSION_SECRET nao definida - usando segredo temporario. ' +
      'Os admins serao deslogados a cada reinicio do servidor.'
  );
}

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

function assinar(dados) {
  return crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');
}

export function criarToken({ id, usuario, nome }) {
  const carga = base64url(JSON.stringify({ id, usuario, nome, exp: Date.now() + DURACAO_SESSAO_MS }));
  return `${carga}.${assinar(carga)}`;
}

export function lerToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [carga, assinatura] = token.split('.');
  if (!carga || !assinatura) return null;

  const esperada = Buffer.from(assinar(carga));
  const recebida = Buffer.from(assinatura);
  // Comparacao em tempo constante evita vazar o segredo byte a byte.
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;

  try {
    const sessao = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    if (!sessao?.exp || Date.now() > sessao.exp) return null;
    return sessao;
  } catch {
    return null;
  }
}

function lerCookies(cabecalho = '') {
  const cookies = {};
  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const chave = parte.slice(0, separador).trim();
    if (chave) cookies[chave] = decodeURIComponent(parte.slice(separador + 1).trim());
  }
  return cookies;
}

export function definirCookieSessao(res, token) {
  const partes = [
    `${NOME_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

export function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', `${NOME_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Popula req.admin quando ha sessao valida. Nunca bloqueia. */
export function sessaoOpcional(req, _res, proximo) {
  const token = lerCookies(req.headers.cookie)[NOME_COOKIE];
  req.admin = token ? lerToken(token) : null;
  proximo();
}

/** Bloqueia rotas administrativas. */
export function exigirAdmin(req, res, proximo) {
  if (!req.admin) {
    return res.status(401).json({ erro: 'Sessao expirada ou inexistente. Faca login novamente.' });
  }
  proximo();
}

export function gerarHash(senha) {
  return bcrypt.hash(senha, 12);
}

export async function autenticar(usuario, senha) {
  const { rows } = await consulta(
    'SELECT id, usuario, nome, senha_hash, ativo FROM admins WHERE LOWER(usuario) = LOWER($1)',
    [String(usuario ?? '').trim()]
  );
  const admin = rows[0];

  // Sempre roda um bcrypt.compare, mesmo sem usuario, para o tempo de resposta
  // nao revelar quais logins existem.
  const hashFalso = '$2b$12$0000000000000000000000000000000000000000000000000000';
  const confere = await bcrypt.compare(String(senha ?? ''), admin?.senha_hash ?? hashFalso);

  if (!admin || !confere) return null;
  if (!admin.ativo) return { bloqueado: true };

  await consulta('UPDATE admins SET ultimo_acesso = NOW() WHERE id = $1', [admin.id]);
  return { id: admin.id, usuario: admin.usuario, nome: admin.nome };
}

export function validarSenha(senha) {
  const valor = String(senha ?? '');
  if (valor.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(valor) || !/\d/.test(valor)) {
    return 'A senha precisa conter letras e numeros.';
  }
  return null;
}
