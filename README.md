# Ótica Carvalho

Monorepo com duas entregas:

| Pasta      | O que é                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `server/` + `public/` | **Garantia Digital** — aplicação Node + Postgres com CRUD real |
| `bio/`     | **Link na bio** — página estática para subdomínio                        |
| `arquivo/` | Versões originais, guardadas para referência                             |

---

# 1. Garantia Digital

- **Consulta pública** (`/`) — o cliente informa **CPF + data de nascimento** e vê o certificado com QR Code.
- **Painel administrativo** (`/admin`) — restrito, login com usuário e senha. Cadastra, edita, exclui e consulta garantias.
- **Validação por QR Code** (`/v/<token>`) — quem escaneia o certificado impresso vê os dados direto, sem digitar nada.
- **Backup local** — download do banco inteiro em SQL, JSON ou CSV, e restauração a partir do JSON.

## Deploy no Coolify

O `docker-compose.yml` sobe a stack inteira: **Postgres + aplicação**.

1. No Coolify: **+ New → Resource → Docker Compose**, apontando para este repositório.
2. O Coolify lê o compose e gera sozinho, no primeiro deploy:
   - `SERVICE_USER_POSTGRES` e `SERVICE_PASSWORD_POSTGRES` — credenciais do banco
   - `SERVICE_BASE64_64_SESSAO` — segredo do cookie de sessão
   - `SERVICE_FQDN_APP_3000` — domínio público apontando para a porta 3000
3. Antes de dar deploy, defina **uma** variável de ambiente à mão:

   | Variável       | Valor                                                       |
   | -------------- | ----------------------------------------------------------- |
   | `ADMIN_SENHA`  | senha do primeiro admin (mín. 8 caracteres, letras e números) |
   | `ADMIN_USUARIO`| opcional — padrão `carvalho`                                 |
   | `ADMIN_NOME`   | opcional — padrão `Administrador`                            |

4. Deploy. Na primeira subida a aplicação cria as tabelas e o primeiro administrador.

O banco fica no volume `dados-postgres` e a aplicação conversa com ele pela rede interna do Docker (`postgres:5432`), sem expor a porta para a internet.

> Depois do primeiro deploy, **remova `ADMIN_SENHA`** das variáveis do Coolify. Ela só é usada quando a tabela de admins está vazia, e deixá-la lá mantém a senha em texto puro no painel.

### Configure o HTTPS

O painel `/admin` expõe a base inteira de clientes e o login trafega nele. No Coolify, ative **Generate SSL Certificate** / Let's Encrypt no domínio antes de usar o sistema para valer. Com `NODE_ENV=production` (já definido no compose) o cookie de sessão só é enviado por HTTPS — sem certificado, o login não se mantém.

## Rodando na sua máquina

```bash
npm install
cp .env.example .env        # preencha DATABASE_URL e SESSION_SECRET
npm run db:init             # cria as tabelas
npm run admin:criar -- carvalho "Jose Carvalho" SuaSenha123
npm start
```

| Endereço                          | O que é                          |
| --------------------------------- | -------------------------------- |
| <http://localhost:3000/>          | Consulta pública (cliente)       |
| <http://localhost:3000/admin>     | Painel administrativo            |
| <http://localhost:3000/api/saude> | Checagem da conexão com o banco  |

`npm run dev` reinicia o servidor a cada alteração.

## Backup e migração

Na aba **Backup** do painel:

| Formato  | Para quê                                                               |
| -------- | ---------------------------------------------------------------------- |
| **SQL**  | Migrar para qualquer outro Postgres. Contém schema + dados + sequences. |
| **JSON** | Cópia completa, usada pela restauração dentro do próprio painel.        |
| **CSV**  | Abrir as garantias no Excel (separador `;`, acentos corretos).          |

Para levar o banco para outro lugar:

```bash
psql "NOVA_CONNECTION_STRING" -f backup-otica-carvalho-2026-07-21T10-30-00.sql
```

Depois é só trocar a `DATABASE_URL`. Nenhuma linha de código muda — é o mesmo Postgres, seja no Coolify, num VPS ou num serviço gerenciado.

> O dump usa `TRUNCATE ... RESTART IDENTITY CASCADE` antes de repovoar: ele **substitui** o conteúdo do banco de destino. Restaure sempre em um banco vazio ou que possa ser sobrescrito.

A restauração pelo painel tem dois modos: **mesclar** (mantém o que já existe, ignora repetidos) e **substituir** (apaga as garantias atuais). Administradores nunca são sobrescritos.

## Estrutura

```
server/
  index.js          Express, middlewares, arquivos estáticos, encerramento limpo
  db.js             pool do Postgres, schema e trilha de auditoria
  auth.js           bcrypt, cookie de sessão assinado (HMAC) e middlewares
  validacao.js      CPF com dígito verificador, datas, regras da garantia
  limitador.js      limite de tentativas por IP
  rotas-publicas.js consulta por CPF + nascimento e validação por token
  rotas-admin.js    CRUD, indicadores, logs e gestão de administradores
  rotas-backup.js   exportação SQL/JSON/CSV e restauração
public/
  index.html        consulta pública
  admin.html        painel administrativo
  validar.html      destino do QR Code
  assets/           estilo.css, comum.js, consulta.js, admin.js
scripts/
  init-db.js        cria/verifica as tabelas
  criar-admin.js    cria administradores pelo terminal
```

## Decisões de segurança e privacidade

- **A consulta pública exige CPF + data de nascimento.** Só o CPF permitiria que qualquer pessoa lesse os dados de um titular a partir de um número obtido em outro lugar.
- **Resposta única para "não encontrado".** CPF inexistente e data que não confere devolvem a mesma mensagem, então a busca não confirma se um CPF está cadastrado.
- **Limite por IP**: 12 consultas a cada 5 minutos na busca pública, 6 tentativas a cada 10 minutos no login. Barra varredura de CPFs e força bruta de senha.
- **Senhas com bcrypt** (custo 12). O login roda o `bcrypt.compare` mesmo quando o usuário não existe, para o tempo de resposta não revelar quais logins são válidos.
- **Sessão em cookie `HttpOnly` assinado com HMAC**, válida por 8 horas. Com `NODE_ENV=production`, o cookie vira `Secure`.
- **Trilha de auditoria**: cada cadastro, edição, exclusão, backup e login fica registrado com autor e data na aba *Atividade*.
- **Consultas parametrizadas** em todo o acesso ao banco, e escape de HTML em tudo que vem do banco para a tela.
- **Container sem privilégios**: a imagem roda como usuário `node`, não como root.

Os backups contêm CPFs e os hashes das senhas dos administradores — guarde-os com o mesmo cuidado que o banco.

---

# 2. Link na bio (`bio/`)

Página estática de um arquivo só, pronta para um subdomínio (ex.: `bio.oticacarvalho.com.br`).

```
bio/
  index.html   página completa (~14 KB)
  logo.jpg     logotipo, usado também como favicon e og:image
  fonts/       Cormorant Garamond e Jost, subset latin
```

Sem build, sem JavaScript, sem CDN externo: é só publicar a pasta em qualquer host estático — no Coolify, um recurso **Static Site** apontando para `bio/` resolve.

Para editar links, endereço ou horário, abra o `index.html` e mexa direto no HTML — cada link é um bloco `<a class="link">`.

---

# Domínios

| Endereço                          | Aponta para                                  |
| --------------------------------- | -------------------------------------------- |
| `https://oticacarvalho.com`       | Site principal / loja (fora deste repositório) |
| `https://garantia.oticacarvalho.com` | Aplicação de Garantia Digital (`app` no compose) |
| subdomínio da bio                 | Pasta `bio/` como Static Site                |

No Coolify, defina `garantia.oticacarvalho.com` como domínio do serviço `app` e ative o certificado Let's Encrypt. O DNS precisa de um registro `A` de `garantia` apontando para `201.23.76.139`.
