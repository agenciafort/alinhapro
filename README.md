# AlinhaPro — Consultoria em Tempo Real

Portal de consultoria online com documento colaborativo ao vivo e chat em tempo real.

## Como funciona

- **Consultor** cria salas no painel admin
- Envia o link da sala para o **cliente**
- Os dois acessam a mesma sala: documento à esquerda, chat à direita
- O consultor edita o documento ao vivo — o cliente vê as mudanças instantaneamente
- Conversam pelo chat integrado

## Setup rápido

### 1. Configurar o banco (Supabase)

1. Acesse [supabase.com](https://supabase.com) e abra seu projeto **AlinhaPro**
2. No menu lateral, clique em **SQL Editor**
3. Clique em **New Query**
4. Abra o arquivo `setup-supabase.sql` deste projeto, copie todo o conteúdo e cole no editor
5. Clique em **Run** (botão verde)
6. Pronto! As tabelas `salas` e `mensagens` foram criadas

### 2. Deploy no Netlify

1. Acesse [netlify.com](https://netlify.com) e crie uma conta
2. Na tela inicial, arraste a **pasta inteira do projeto** para a área de deploy
3. Aguarde o deploy (30 segundos)
4. Acesse a URL gerada (ex: `https://alinhapro.netlify.app`)

### 3. Deploy no Vercel (alternativa)

1. Acesse [vercel.com](https://vercel.com) e crie uma conta
2. Crie um repositório no GitHub com estes arquivos
3. Importe o repositório no Vercel
4. Deploy automático

## Uso

### Como consultor

1. Acesse `seusite.com/admin.html`
2. Clique em **+ Nova Sala**
3. Preencha o nome do cliente, uma senha de admin e seu nome
4. O sistema gera dois links:
   - **Link do cliente** — envie para ele (sem acesso de edição)
   - **Link do admin** — use este para entrar (com acesso de edição)
5. Entre na sala, edite o documento e converse pelo chat

### Como cliente

1. Receba o link do consultor
2. Acesse e digite seu nome
3. Leia o documento e converse pelo chat

## Estrutura do projeto

```
├── index.html          → Página de entrada
├── sala.html           → Sala de consultoria (documento + chat)
├── admin.html          → Painel do consultor
├── css/style.css       → Estilos
├── js/supabase.js      → Conexão com Supabase
├── js/chat.js          → Chat em tempo real
├── js/documento.js     → Editor de documento
├── js/salas.js         → Gerenciamento de salas
└── setup-supabase.sql  → SQL para criar as tabelas
```

## Tecnologias

- HTML, CSS, JavaScript (sem frameworks)
- Supabase (banco de dados + realtime)
- marked.js (renderização de Markdown)
- Netlify ou Vercel (hospedagem gratuita)
