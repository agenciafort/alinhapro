# AlinhaPro — Consultoria em Tempo Real

Portal de consultoria online com documento colaborativo ao vivo e chat em tempo real.

## Como funciona

- **Super Admin** cria contas de admin (consultores) no painel exclusivo
- **Admins** fazem login e criam salas de consultoria para seus clientes
- **Clientes** acessam a sala com o link recebido (sem login necessário)
- Documento à esquerda, chat à direita — tudo em tempo real

## Segurança

### Autenticação de usuários

- **Super Admin**: conta criada diretamente no banco (SQL). Pode criar, ativar/desativar, resetar senha e deletar admins.
- **Admins**: contas criadas pelo Super Admin. Podem criar e gerenciar suas próprias salas.
- **Login**: email + senha com hash bcrypt. Sessão de 24 horas via token UUID.
- **Separação de papéis**: admins só veem suas próprias salas; super admin vê todas.

### Proteção de salas

- A **senha de administrador da sala** é guardada no banco como hash bcrypt.
- Editar documento exige sessão de consultor (token de 8 horas via `sessionStorage`).
- Concluir/reativar/deletar sala pede a senha da sala.
- **Clientes** acessam via link com UUID — sem login, sem edição do documento.

## Setup do banco (Supabase)

### Projeto novo (banco vazio)

1. **SQL Editor** → rode `setup-supabase.sql`
2. Rode `migracao-auth.sql` para criar o sistema de autenticação
3. Rode as outras migrações conforme necessário (`migracao-fases.sql`, `migracao-decisoes.sql`, etc.)

### Criar o Super Admin

No SQL Editor do Supabase, rode (editando email/nome/senha):

```sql
INSERT INTO public.usuarios (email, nome, senha_hash, role)
VALUES (
  'seu-email@exemplo.com',
  'Seu Nome',
  crypt('SuaSenhaForte123', gen_salt('bf')),
  'superadmin'
);
```

### Migrações disponíveis

| Arquivo | Descrição |
|---------|-----------|
| `setup-supabase.sql` | Banco do zero (salas, mensagens, decisões, RLS, RPCs) |
| `migracao-auth.sql` | Sistema de autenticação (usuários, sessões, RPCs de login/admin) |
| `migracao-seguranca.sql` | Migrar do schema antigo (senha em texto → bcrypt) |
| `migracao-fases.sql` | Fases do projeto |
| `migracao-decisoes.sql` | Decisões |
| `migracao-preview.sql` | Preview URL |
| `migracao-reconectar-preview.sql` | Recriar site Netlify |
| `migracao-deletar-sala.sql` | Deletar sala com cleanup |

## Deploy (Netlify + Git)

Conecte o repositório ao Netlify (**Continuous deployment**). Cada `git push` na branch `master` publica o site.

Variáveis de ambiente necessárias no Netlify:
- `GITHUB_TOKEN` — token do GitHub para criar repos
- `NETLIFY_TOKEN` — token do Netlify para criar sites
- `GITHUB_OWNER` — dono dos repos no GitHub

## Uso

### Como Super Admin

1. Acesse `seusite.com/login.html`
2. Faça login com suas credenciais
3. No painel, clique em **Gerenciar Admins**
4. Crie contas para seus consultores (email + nome + senha)
5. Passe as credenciais para cada consultor

### Como Admin (Consultor)

1. Acesse `seusite.com/login.html`
2. Faça login com as credenciais recebidas
3. **+ Nova Sala** → nome do projeto + senha da sala
4. Envie o **link do cliente** para o cliente
5. Use o **link do consultor** para acessar com edição

### Como Cliente

1. Receba o link da sala do consultor
2. Cole o código e digite seu nome na página inicial
3. Leia o documento e converse pelo chat

## Estrutura do projeto

```
├── index.html              → Entrada (código da sala + nome)
├── login.html              → Login para admin/superadmin
├── admin.html              → Painel do consultor (requer login)
├── superadmin.html         → Gerenciamento de admins (só super admin)
├── sala.html               → Documento + chat
├── fases.html              → Fases do projeto
├── resumo.html             → Resumo da sessão
├── css/style.css
├── js/supabase.js          → Cliente Supabase (sb)
├── js/auth.js              → Autenticação, sessão, roles
├── js/salas.js             → Salas, RPCs, token de consultor
├── js/chat.js              → Mensagens + Realtime
├── js/documento.js         → Markdown + editor
├── netlify/functions/      → Automação GitHub/Netlify
├── setup-supabase.sql      → Banco do zero
├── migracao-auth.sql       → Sistema de autenticação
└── migracao-*.sql          → Outras migrações
```

## Tecnologias

- HTML, CSS, JavaScript
- Supabase (Postgres, RLS, Realtime, RPC `SECURITY DEFINER`)
- marked.js (Markdown)
- Netlify (hospedagem + serverless functions)
