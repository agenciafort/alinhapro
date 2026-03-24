# AlinhaPro — Consultoria em Tempo Real

Portal de consultoria online com documento colaborativo ao vivo e chat em tempo real.

## Como funciona

- **Consultor** cria salas no painel admin
- Envia o link da sala para o **cliente**
- Os dois acessam a mesma sala: documento à esquerda, chat à direita
- O consultor edita o documento ao vivo — o cliente vê as mudanças instantaneamente
- Conversam pelo chat integrado

## Segurança (versão atual)

- A **senha de administrador** é guardada no banco só como **hash (bcrypt)** — não dá para ler o texto da senha pela API.
- O **link do consultor** usa `?consultor=1` e **não leva a senha na URL**. A senha é digitada no modal e gera uma **sessão de 8 horas** (token em `sessionStorage` neste navegador).
- **Atualizar o documento** só é permitido via função no Postgres (`rpc_atualizar_documento`), validando o token da sessão. O cliente anônimo **não** pode dar `UPDATE` direto na tabela `salas`.
- **Concluir / reativar sala** no painel pede a senha de novo (confirmação).
- Compatibilidade: se alguém abrir um link antigo com `?admin=SENHA`, o sistema faz login, grava o token e **remove a senha da barra de endereços**.

## Setup do banco (Supabase)

### Projeto novo (banco vazio)

1. **SQL Editor** → **New Query**
2. Cole o conteúdo de **`setup-supabase.sql`** → **Run**

### Você já tinha o AlinhaPro com `senha_admin` em texto

1. Faça **deploy do front-end** deste repositório (Git → Netlify).
2. No Supabase, **SQL Editor** → cole **`migracao-seguranca.sql`** inteiro → **Run** (uma vez).
3. Teste criar sala e editar documento.

### Botão **Recriar site** (Netlify 404 / site apagado)

1. No Supabase, **SQL Editor** → rode **`migracao-reconectar-preview.sql`** (uma vez).
2. Faça **deploy** deste repo no Netlify (para publicar a função `reconectar-site`).
3. No **admin**, na sala do cliente: **Recriar site** → senha da sala → confirme ou ajuste o nome do repo (`cliente-...`). Isso cria ou reaproveita o site na Netlify ligado ao GitHub e **atualiza o preview** da sala.

## Deploy (Netlify + Git)

Conecte o repositório ao Netlify (**Continuous deployment**). Depois, cada `git push` na branch `master` publica o site.

## Uso

### Como consultor

1. Acesse `seusite.com/admin.html`
2. **+ Nova Sala** → nome, senha e seu nome
3. **Link do cliente** — só isso vai para o cliente (sem edição do documento).
4. **Link do consultor** — seu acesso; ao abrir, digite a senha no modal (ou use sessão já ativa no mesmo navegador).
5. **Concluir** uma sala no painel pede a senha da sala para confirmar.

### Na tela da sala

- **Sair da sala** — volta ao início (`index.html`) para entrar em outro código.
- **Painel** e **Sair do modo consultor** — aparecem só quando há sessão de consultor (token válido neste navegador). O painel leva a `admin.html` (criar salas, listar, concluir).
- O logo **AlinhaPro** também leva ao início.

### Como cliente

1. Receba só o link da sala (`?id=...`, sem `consultor=1`)
2. Digite seu nome na entrada
3. Leia o documento e use o chat (sem botão Editar)

## Estrutura do projeto

```
├── index.html              → Entrada (código da sala + nome)
├── sala.html               → Documento + chat
├── admin.html              → Painel do consultor
├── css/style.css
├── js/supabase.js          → Cliente Supabase (sb)
├── js/salas.js             → Salas, RPCs, token de consultor
├── js/chat.js
├── js/documento.js
├── setup-supabase.sql      → Banco do zero (com segurança)
└── migracao-seguranca.sql  → Quem já tinha o schema antigo
```

## Tecnologias

- HTML, CSS, JavaScript
- Supabase (Postgres, RLS, Realtime, RPC `SECURITY DEFINER`)
- marked.js (Markdown)
- Netlify (hospedagem)
