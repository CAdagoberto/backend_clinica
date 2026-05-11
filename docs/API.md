# API Clínica Psicológica (MySQL + Express)

Base URL local padrão: `http://127.0.0.1:4000`. Prefixo das rotas: **`/api`**.

Em produção no app Expo, a base externa usada é **`https://visaoderuastore.com.br`**, com as mesmas rotas (`/api/auth/login`, etc.) — ou seja, URLs completas como **`https://visaoderuastore.com.br/api/...`** (o app não repete `api` na base; se no Nginx a API for publicada em `/api`, basta o domínio como base).

## Configuração

A API carrega **dois** ficheiros (esta ordem, valores em `server/.env` sobrescrevem o da raiz):

| Ficheiro | Finalidade |
|----------|------------|
| **`.env` na raiz do repositório** | Credenciais do projeto principal (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` ou `DATABASE_URL`). |
| **`server/.env`** | Porta da API, `NODE_ENV`, `DATA_REFERENCIA` e, se quiser, `MYSQL_*` em vez do `.env` da raiz. Este ficheiro é carregado **depois** do da raiz com `override: true`, para os valores da pasta `server/` prevalecerem na VPS. |

Nomes aceites para MySQL: **`MYSQL_*`** (só API) ou **`DB_*`** / **`DATABASE_URL`** (típico do `.env` principal). Prioridade por campo: **`MYSQL_*` > `DB_*` > `DATABASE_URL` > padrão interno** (senha omissa → `123456` só se nada disso existir).

Copie **`server/.env.example`** ou **`server/.env.api.example`** para **`server/.env`**. Se as credenciais já estiverem no `.env` da raiz, basta um `server/.env` mínimo (`PORT`, `NODE_ENV`, `DATA_REFERENCIA`).

Variável **`DATA_REFERENCIA`** (formato `YYYY-MM-DD`) alimenta “consultas do dia”, alertas de admin e parte das notificações.

## Subida e produção

Ao executar `npm start`:

1. São criadas as pastas **`uploads/`** e **`logs/`** na raiz do pacote `server/` (para anexos futuros e logs).
2. O banco definido em **`MYSQL_DATABASE`** é criado se não existir.
3. Tabelas são criadas com **`CREATE TABLE IF NOT EXISTS`** e, se as tabelas estiverem vazias, é aplicado seed com salas, usuários de demonstração (senha `123456`) e consultas de exemplo.

Você pode rodar só a migração com: `npm run migrate`.

### Utilizador MySQL sem permissão `CREATE DATABASE` (erro 1044)

Utilizadores de aplicação (`app_user`, etc.) costumam ter apenas direitos **no schema já criado**. Se ao subir a API ou ao correr o Workbench aparecer **“Access denied … to database `clinica_psi`”** ao criar o schema:

1. **Como administrador (root ou equivalente)** crie a base e conceda acesso:

```sql
CREATE DATABASE IF NOT EXISTS clinica_psi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON clinica_psi.* TO 'app_user'@'localhost';
FLUSH PRIVILEGES;
```

(Ajuste `'app_user'@'localhost'` ao host real, ex. `'%'`.)

2. Na API, pode definir **`MYSQL_SKIP_CREATE_DATABASE=true`** no `server/.env` para não tentar `CREATE DATABASE` na subida (opcional: o código também ignora automaticamente o erro **1044** e segue, assumindo que a base já existe.)

## Autenticação

MVP sem JWT: o app envia `email` e `senha` no login; a resposta é o objeto usuário **sem hash de senha**. Cadastro exige cabeçalhos de contexto:

| Cabeçalho     | Valor                          |
|---------------|--------------------------------|
| `X-Ator-Tipo` | `admin` ou `estagiario`        |
| `X-Ator-Id`   | ID numérico do usuário logado |

## Rotas

### Saúde

| Método | Caminho    | Descrição        |
|--------|------------|------------------|
| GET    | `/health`  | Status e data de referência |

### Auth

| Método | Caminho           | Body (JSON)     | Descrição   |
|--------|-------------------|-----------------|-------------|
| POST   | `/api/auth/login` | `email`, `senha`| Login       |

### Usuários e cadastro

| Método | Caminho           | Observação |
|--------|-------------------|------------|
| POST   | `/api/cadastro`   | Body: mesmo formato do mock (`nome`, `email`, `senha`, `tipo`, campos opcionais de paciente/estagiário). Cabeçalhos `X-Ator-Tipo`, `X-Ator-Id`. |
| GET    | `/api/usuarios`   | Lista todos (equivalente a `getUsuarios` no mock). |

### Estagiários e pacientes

| Método | Caminho                          | Query |
|--------|----------------------------------|-------|
| GET    | `/api/estagiarios`               | `filtroNome` (opcional) |
| GET    | `/api/pacientes`                 | `estagiarioId` (opcional) |
| GET    | `/api/pacientes/com-status`      | `estagiarioId` (opcional) |
| GET    | `/api/pacientes/:pacienteId/prontuario` | — |

### Consultas

| Método | Caminho                                      | Body / query |
|--------|----------------------------------------------|--------------|
| GET    | `/api/consultas/usuario/:userId`             | — |
| GET    | `/api/consultas/disponiveis`                 | Pendentes na `DATA_REFERENCIA` |
| GET    | `/api/consultas/:consultaId`                 | — |
| PATCH  | `/api/consultas/:consultaId/check-in`        | — |
| PATCH  | `/api/consultas/:consultaId/status`          | `{ "novoStatus": "pendente" \| "confirmado" \| "cancelado" }` |
| GET    | `/api/consultas/:consultaId/relatorio`       | — |
| PUT    | `/api/consultas/:consultaId/relatorio`       | `{ "texto", "autorId" }` |
| POST   | `/api/consultas`                             | `pacienteId`, `estagiarioId`, `salaId`, `data`, `horario`, `status` opcional |
| POST   | `/api/consultas/pacote`                      | `pacienteId`, `estagiarioId`, `salaId`, `dataPrimeiraSessao`, `horario` |

### Notificações

| Método | Caminho                                | Body |
|--------|----------------------------------------|------|
| GET    | `/api/notificacoes/:usuarioId`         | — |
| PATCH  | `/api/notificacoes/:notificacaoId/lida`| `{ "usuarioId" }` |

### Encaminhamentos

| Método | Caminho                                      | Body |
|--------|----------------------------------------------|------|
| GET    | `/api/encaminhamentos`                       | Todos |
| GET    | `/api/encaminhamentos/paciente/:pacienteId`  | — |
| GET    | `/api/encaminhamentos/estagiario/:id`       | — |
| POST   | `/api/encaminhamentos`                       | `pacienteId`, `tipo` (`interno` \| `externo`), `destino`, `observacao`, `criadoPorId` |

### Avaliações

| Método | Caminho          | Query / body |
|--------|------------------|--------------|
| GET    | `/api/avaliacoes`| `papel` = `admin` \| `estagiario` \| `paciente`; `usuarioId` (para filtrar paciente/autor ou estagiário) |
| POST   | `/api/avaliacoes`| `tipo`, `nota` (1–5), `comentario`, `autorId`, `estagiarioId` opcional |

### Salas

| Método | Caminho                        | Body |
|--------|--------------------------------|------|
| GET    | `/api/salas`                   | — |
| GET    | `/api/salas/atendimento`       | — |
| PATCH  | `/api/salas/:salaId/status`    | `{ "novoStatus": "disponivel" \| "ocupada" \| "em reforma" }` |

### Admin

| Método | Caminho                         | Query |
|--------|---------------------------------|-------|
| GET    | `/api/admin/consultas`          | `status` opcional |
| GET    | `/api/admin/stats`              | — |
| GET    | `/api/admin/alertas`            | — |
| GET    | `/api/admin/estagiarios-carga` | `filtroNome`, `filtro` (`sem_consultas` \| `com_consultas`) |

### Presença do estagiário

| Método | Caminho                    | Descrição |
|--------|----------------------------|-----------|
| GET    | `/api/presencas/:estagiarioId` | Lista |
| POST   | `/api/presencas/:estagiarioId` | Registra chegada (data = `DATA_REFERENCIA`) |

## Erros

Respostas de erro: JSON `{ "error": "mensagem" }`, HTTP **400** por padrão (ou outro código se definido).

## Modelo de dados (MySQL)

Tabelas: `usuarios`, `salas`, `consultas`, `status_paciente`, `relatorio_consulta`, `notificacoes`, `encaminhamentos`, `avaliacoes`, `presencas_estagiario`. Senhas armazenadas com **bcrypt**; o seed usa a senha `123456` para os usuários de demonstração.

## PM2 (exemplo)

```bash
cd server && npm install && npm start
# ou
pm2 start src/index.js --name clinica-api
```

Garanta que o MySQL esteja acessível e que `.env` esteja no diretório `server/`.
