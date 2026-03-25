# AlinhaPro — Especificação Completa: Widget de Chat + CRM + Comunicação ao Vivo

> Documento de referência para implementação. Cada seção contém descrição funcional, especificação técnica, UX e critérios de aceite. Atualizado em 24/03/2026.

---

## 1. Visão do Produto

### O que é

Um sistema integrado que transforma qualquer site em um **canal de vendas ao vivo**: o visitante conversa, o consultor apresenta, negocia, fecha e acompanha o projeto — **tudo sem o visitante sair da página**.

### Jornada completa (início ao fim)

```
MINUTO 0   → Visitante chega na página (SEO)
MINUTO 1   → Digita no chat embutido
MINUTO 2   → Consultor é notificado, responde
MINUTO 5   → Liga áudio, conversa ao vivo
MINUTO 8   → Compartilha tela, mostra portfólio/Figma
MINUTO 15  → Envia proposta de valor no chat
MINUTO 16  → Visitante aceita
MINUTO 17  → Visitante paga (PIX/cartão) ali dentro
MINUTO 18  → Sala vira projeto com fases e documento
DIA 2+     → Acompanhamento na mesma sala
```

### O que já existe no AlinhaPro (não precisa refazer)

| Módulo | Arquivos | Funcionalidade |
|---|---|---|
| Supabase client | `js/supabase.js` | Conexão, helpers (`showToast`, `getParam`, `formatTime`) |
| Chat Realtime | `js/chat.js` | `enviarMensagem`, `carregarMensagens`, `ouvirMensagens`, vistos de leitura |
| Salas | `js/salas.js` | `criarSala`, `buscarSala`, `listarSalas`, `adminLogin`, `ouvirMudancasSala` |
| Propostas + Pagamento | `js/pagamento.js` | `criarProposta`, `responderProposta`, `carregarPagamento`, disputas |
| Cobrança Asaas | `netlify/functions/criar-cobranca.js` | Gera cobrança PIX/cartão |
| Webhook | `netlify/functions/webhook-asaas.js` | Confirma pagamento |
| Documento Markdown | `js/documento.js` | Editor com preview |
| Auth | `js/auth.js` | Login/logout, sessões, roles |
| Fases do projeto | `fases.html` | Fluxo de aprovação por etapas |
| Preview iframe | `sala.html` | Mostra qualquer URL no painel esquerdo |
| FAB do chat | `css/style.css` | `.sala-chat-fab` com halo animado |
| Banco | `setup-supabase.sql` | Tabelas: `salas`, `mensagens`, `decisoes`, `admin_sessions`, RLS |

---

## 2. Widget Embarcável (`widget.js`)

### 2.1 Instalação

Uma única linha em qualquer site:

```html
<script src="https://SEU-SITE.netlify.app/widget.js" data-key="SUA_SUPABASE_KEY" async></script>
```

Funciona em: WordPress, Shopify, Wix, Squarespace, Blogger, HTML puro, React, Next.js, ou qualquer plataforma que aceite HTML.

### 2.2 Requisitos técnicos

| Requisito | Especificação |
|---|---|
| Tamanho | < 30 KB (minificado + gzip) |
| Carregamento | `async` — não bloqueia a página |
| Dependências | Supabase JS (carregado sob demanda via CDN no primeiro clique) |
| Isolamento | Todo CSS em shadow DOM ou com prefixo único — não conflita com CSS do site hospedeiro |
| Cache | `Cache-Control: public, max-age=86400` — navegador cacheia por 24h |
| Compatibilidade | Chrome 80+, Firefox 78+, Safari 14+, Edge 80+ |

### 2.3 Comportamento (lazy loading)

```
Página carrega
  ↓
Só o FAB aparece (< 5 KB de CSS inline + SVG)
Supabase NÃO é carregado ainda
  ↓
Visitante clica no FAB
  ↓
Carrega Supabase JS do CDN (~40 KB gzip)
Abre janela do chat
Mostra formulário pré-chat
```

### 2.4 Apresentação visual

#### Estado 1: FAB fechado

```
                                                    ┌───┐
Página normal do site...                            │ 💬│ ← FAB 48×48px
                                                    │Chat│   canto inf. direito
                                                    └───┘   halo pulsando
```

- Posição: `fixed`, `bottom: 20px`, `right: 20px`
- Z-index: `999999`
- Halo animado (gradiente azul pulsando)
- Badge "Chat" abaixo do ícone
- Em telas ≤ 380px: só o ícone, sem badge

#### Estado 2: Formulário pré-chat (primeiro acesso)

```
┌────────────────────────────┐
│ AlinhaPro              ✕   │
├────────────────────────────┤
│                            │
│  👋 Olá! Fale com um      │
│  especialista agora.       │
│                            │
│  Seu nome                  │
│  [______________________]  │
│                            │
│  WhatsApp ou e-mail *      │
│  [______________________]  │
│                            │
│  [    Iniciar conversa   ] │
│                            │
└────────────────────────────┘
```

- Campos: **nome** (opcional) e **WhatsApp ou e-mail** (obrigatório)
- Validação: formato de telefone BR ou e-mail válido
- Dados salvos em `localStorage` — na próxima visita, pula direto pro chat

#### Estado 3: Chat ativo

```
┌────────────────────────────┐
│ AlinhaPro              ✕   │
├────────────────────────────┤
│                            │
│  👋 Olá João! Como posso   │
│  ajudar?                   │
│                            │
│              Quero um site │
│              pro meu       │
│              negócio   ✓✓  │
│                            │
│  Ótimo! Que tipo de        │
│  negócio você tem?         │
│                            │
├────────────────────────────┤
│ [Digite sua mensagem...]   │
│                   [Enviar] │
└────────────────────────────┘
```

- Janela: `width: 370px`, `height: 520px`, `border-radius: 16px`
- Sombra grande para destacar da página
- Responsivo: em telas ≤ 480px, ocupa tela inteira
- Scroll suave automático para última mensagem
- Vistos de leitura (✓✓ azul) quando o consultor lê

#### Estado 4: Seção fixa na página (opcional, para landing pages)

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   Conteúdo SEO da página...                               │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │                                                        │ │
│ │  💬 Fale agora com um especialista                     │ │
│ │                                                        │ │
│ │  ┌────────────────────────────────────────────────┐    │ │
│ │  │  Chat aberto inline (mesma funcionalidade)     │    │ │
│ │  │  ...                                           │    │ │
│ │  │  [Digite sua mensagem...]            [Enviar]  │    │ │
│ │  └────────────────────────────────────────────────┘    │ │
│ │                                                        │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                            │
│   Mais conteúdo da página...                              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- Quando o visitante rola para fora da seção, o chat vira FAB e a conversa continua
- `IntersectionObserver` detecta visibilidade da seção

### 2.5 Criação automática de sala

| Evento | Ação |
|---|---|
| Visitante envia primeira mensagem | Criar sala via RPC com `tipo = 'lead'` |
| Sala criada | Salvar `sala_id` em `localStorage` do visitante |
| Visitante volta ao site | Ler `sala_id` do `localStorage`, retomar conversa |
| Visitante limpa cache | Nova sala criada na próxima mensagem |

### 2.6 Dados capturados automaticamente

| Dado | Origem |
|---|---|
| Nome | Campo do formulário pré-chat |
| WhatsApp ou e-mail | Campo obrigatório do formulário |
| URL da página de origem | `window.location.href` |
| Referrer | `document.referrer` |
| User-agent / dispositivo | `navigator.userAgent` |
| Data/hora da primeira mensagem | Timestamp do banco |
| Todas as mensagens | Tabela `mensagens` |

### 2.7 Migração SQL necessária

```sql
-- Novos campos na tabela salas
ALTER TABLE salas ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'projeto'
  CHECK (tipo IN ('projeto', 'lead'));
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_nome TEXT;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_contato TEXT;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_pagina_origem TEXT;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_referrer TEXT;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_user_agent TEXT;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'novo'
  CHECK (lead_status IN ('novo', 'conversando', 'proposta', 'negociando', 'fechado', 'perdido'));
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_notas TEXT DEFAULT '';
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_followup_em TIMESTAMPTZ;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS lead_pipeline TEXT DEFAULT 'geral';
ALTER TABLE salas ADD COLUMN IF NOT EXISTS consultor_online BOOLEAN DEFAULT false;

-- RPC para criar sala de lead (sem senha, acesso público)
CREATE OR REPLACE FUNCTION rpc_criar_sala_lead(
  p_nome TEXT,
  p_contato TEXT,
  p_pagina TEXT DEFAULT '',
  p_referrer TEXT DEFAULT '',
  p_user_agent TEXT DEFAULT ''
) RETURNS JSON AS $$
DECLARE
  v_sala salas%ROWTYPE;
BEGIN
  INSERT INTO salas (nome, tipo, lead_nome, lead_contato, lead_pagina_origem,
                     lead_referrer, lead_user_agent, senha_admin_hash)
  VALUES (
    COALESCE(p_nome, 'Lead ' || to_char(now(), 'DD/MM HH24:MI')),
    'lead',
    p_nome,
    p_contato,
    p_pagina,
    p_referrer,
    p_user_agent,
    crypt(gen_random_uuid()::text, gen_salt('bf'))
  )
  RETURNING * INTO v_sala;

  RETURN json_build_object('ok', true, 'sala_id', v_sala.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION rpc_criar_sala_lead TO anon;

-- RLS: permitir que anon insira mensagens em salas do tipo lead
CREATE POLICY "anon_insert_msg_lead" ON mensagens FOR INSERT TO anon
  WITH CHECK (EXISTS (
    SELECT 1 FROM salas WHERE salas.id = sala_id AND salas.tipo = 'lead'
  ));

-- RLS: permitir que anon leia mensagens de salas do tipo lead
CREATE POLICY "anon_select_msg_lead" ON mensagens FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM salas WHERE salas.id = sala_id AND salas.tipo = 'lead'
  ));
```

---

## 3. Sistema de Notificações

### 3.1 Nível 1 — Som + Badge + Título (implementar primeiro)

**Requisito:** painel admin (`admin.html`) aberto em qualquer aba do navegador.

| Notificação | Comportamento |
|---|---|
| **Som** | Bip curto (Web Audio API, arquivo .mp3 embutido em base64) ao receber mensagem de lead não lida |
| **Badge** | Aba "Leads" mostra counter vermelho: `Leads (3)` |
| **Título da aba** | Alterna entre `💬 (2) Nova mensagem` e `AlinhaPro — Admin` a cada 1.5s |
| **Parar** | Quando o consultor abre a conversa, para de piscar e zera o badge daquela conversa |

**Implementação:** Supabase Realtime já ouve a tabela `mensagens`. Filtrar por `sala.tipo = 'lead'` e comparar com `consultor_lida_ate`.

**UX:** som não toca se a aba estiver focada na conversa do lead (ele já está lendo). Só toca se estiver em outra aba ou outra conversa.

### 3.2 Nível 2 — Push Notification (Web Push API)

| Aspecto | Especificação |
|---|---|
| Funciona com navegador fechado? | Sim (precisa de Service Worker) |
| Funciona no celular? | Sim (Chrome Android, Safari iOS 16.4+ via PWA) |
| Custo | R$ 0 (OneSignal free tier até 10k subscribers, ou implementação própria) |
| Conteúdo | "Novo lead: [nome] — [primeira mensagem]" |
| Ação ao clicar | Abre `admin.html` direto na conversa do lead |

### 3.3 Nível 3 — Telegram / WhatsApp (futuro)

Enviar alerta via bot quando chegar lead. Custo: R$ 0 (Telegram), ~R$ 0,50/msg (WhatsApp Business API).

---

## 4. CRM de Leads

### 4.1 Aba "Leads" no painel admin

Nova aba em `admin.html`, ao lado de "Salas":

```
┌──────────────────────────────────────────────────────────────┐
│  [Salas]    [Leads (3 novos)]                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Filtros: [Todos ▾]  [Pipeline: Geral ▾]  [🔍 Buscar...]    │
│                                                              │
│  (lista ou kanban, conforme modo selecionado)                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Modo Lista (implementar primeiro)

```
┌──────────────────────────────────────────────────────────────┐
│ 🔴  João Silva         📱 (15) 99999-9999     há 2h   NOVO  │
│     "Quero um site para minha barbearia"                     │
├──────────────────────────────────────────────────────────────┤
│ 🔴  Maria Santos       📧 maria@email.com     há 5h   PROP. │
│     "Quanto custa um aplicativo?"                            │
├──────────────────────────────────────────────────────────────┤
│ 🟢  Ana Costa          📱 (11) 88888-8888     agora   NOVO  │
│     "Olá, bom dia!"                                         │
└──────────────────────────────────────────────────────────────┘
```

- 🔴 = mensagem não respondida pelo consultor
- 🟢 = lead online agora (conectado ao Realtime)
- Clique na linha → abre conversa + ficha do lead

### 4.3 Modo Kanban (evoluir depois)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  NOVO    │ CONVERS. │ PROPOSTA │ FECHADO  │ PROJETO  │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │
│ │Pedro │ │ │João  │ │ │Maria │ │ │Ana   │ │ │Carlos│ │
│ │📱(15)│ │ │📱(11)│ │ │R$3k  │ │ │R$5k  │ │ │Fase2 │ │
│ │Site  │ │ │App   │ │ │Site  │ │ │Pago✅│ │ │60%   │ │
│ │há 2h │ │ │há 1d │ │ │há 3d │ │ │      │ │ │      │ │
│ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │
│ ┌──────┐ │          │          │          │          │
│ │Lucas │ │          │          │          │          │
│ │📱(19)│ │          │          │          │          │
│ │Loja  │ │          │          │          │          │
│ │🟢now │ │          │          │          │          │
│ └──────┘ │          │          │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

- Drag & drop (HTML5 Drag API ou biblioteca leve ~5 KB)
- Arrastar card entre colunas → atualiza `lead_status` no banco
- Contadores por coluna
- Scroll horizontal em mobile

### 4.4 Ficha do lead (ao clicar no card)

```
┌───────────────────────────────────────────────────────┐
│ João Silva                                    [✕]     │
├───────────────────────────────────────────────────────┤
│                                                       │
│  📱 (15) 99999-9999            [Abrir WhatsApp]       │
│  📧 joao@email.com             [Abrir E-mail]         │
│  💬 12 mensagens               [Abrir Chat]           │
│                                                       │
│  Veio de: /criacao-de-sites                           │
│  Chegou em: 20/03/2026 às 14:30                       │
│  Última msg: 22/03/2026 às 09:15                      │
│                                                       │
│  Status: [Conversando ▾]                              │
│  Pipeline: [Criação de Sites ▾]                       │
│                                                       │
│  Follow-up: [26/03/2026] 📅                           │
│                                                       │
│  Notas:                                               │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Quer site para barbearia.                       │  │
│  │ Orçamento: até R$ 2.000.                        │  │
│  │ Referência: site do concorrente X.              │  │
│  └─────────────────────────────────────────────────┘  │
│  [Salvar notas]                                       │
│                                                       │
│  [💬 Abrir conversa]  [🚀 Converter em projeto]       │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**UX crítica:**
- **Botão WhatsApp** → abre `https://wa.me/5515999999999` (link direto, funciona no desktop e celular)
- **Botão E-mail** → abre `mailto:joao@email.com`
- **Botão Chat** → abre a sala do lead (igual `sala.html`)
- **Status** → dropdown com as colunas do Kanban
- **Notas** → textarea com autosave (salva ao sair do campo, sem botão)
- **Follow-up** → date picker, gera lembrete no painel
- **Converter em projeto** → muda `tipo` de `lead` para `projeto`, libera fases/documento/proposta/pagamento

### 4.5 Pipelines customizáveis

Pipelines são conjuntos de colunas para o Kanban:

```
Pipeline "Criação de Sites":
NOVO → CONVERSANDO → PROPOSTA → NEGOCIANDO → FECHADO → PRODUÇÃO → ENTREGUE

Pipeline "Consultoria":
NOVO → QUALIFICANDO → REUNIÃO → PROPOSTA → FECHADO

Pipeline "Manutenção":
NOVO → DIAGNÓSTICO → ORÇAMENTO → APROVADO → CONCLUÍDO
```

**Implementação:** tabela `pipelines` com `id`, `nome`, `colunas` (JSON array). Campo `lead_pipeline` na sala referencia qual pipeline usar.

### 4.6 Lembretes de follow-up

No topo do painel admin, banner de lembretes:

```
┌──────────────────────────────────────────────────────────────┐
│ 🔔 Lembretes de hoje (2)                                     │
│                                                              │
│ • Maria Santos — "Retornar sobre proposta de app"            │
│   📱 (11) 99999-9999  [Abrir WhatsApp] [Abrir Chat] [✓ Feito]│
│                                                              │
│ • Pedro Lima — "Mandar exemplo de portfólio"                 │
│   📧 pedro@email.com  [Abrir E-mail] [Abrir Chat] [✓ Feito]  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- Aparece automaticamente ao abrir o painel
- "Feito" remove o lembrete (limpa `lead_followup_em`)
- Lembretes atrasados ficam em vermelho

---

## 5. Mensagem Automática (Offline)

### Comportamento

| Condição | Ação |
|---|---|
| Consultor **online** (`consultor_online = true`) | Mensagem vai direto, sem resposta automática |
| Consultor **offline** | Sistema responde instantaneamente com mensagem configurável |

### Mensagem padrão

```
"Olá! Obrigado por entrar em contato! 😊
Nosso horário de atendimento é de seg-sex, 9h às 18h.
Recebemos sua mensagem e vamos responder o mais rápido possível!
Se preferir, deixe seu WhatsApp que retornamos por lá."
```

### Como detectar online/offline

- Ao abrir `admin.html`: setar `consultor_online = true` via Supabase
- Ao fechar/sair: setar `consultor_online = false` (evento `beforeunload` + heartbeat a cada 30s)
- Se heartbeat parar por 60s → considerar offline

### Configuração

Campo no painel admin para editar a mensagem automática. Armazenado em tabela `configuracoes` (chave-valor).

---

## 6. Apresentação ao Vivo

### 6.1 Trocar URL do iframe em tempo real

Na sala, quando o consultor está conversando com o lead:

```
┌──────────────────────────────────────────────────────────────┐
│ [URL: https://exemplo.com_________________] [Abrir] [Limpar]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  (iframe mostra o site)                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- Campo de texto na toolbar do preview
- Consultor cola URL → Enter → iframe atualiza
- Atualiza `preview_url` no banco → cliente vê automaticamente via Realtime
- Aceita qualquer URL que permita iframe

### 6.2 Compartilhamento de tela (WebRTC)

Apresentar tela, janela ou aba ao vivo para o cliente.

**Toolbar do consultor:**

```
[🖥️ Tela]  [🎤 Áudio]  [📹 Câmera]  [⏹️ Parar]
```

Cada botão é **independente** (toggle on/off). Pode ligar qualquer combinação.

**O que o cliente vê:**

```
┌────────────────────────────────┐
│ 🔴 Ao vivo                     │
├────────────────────────────────┤
│                                │
│  (tela do consultor em         │
│   tempo real, Full HD)         │
│                                │
│  🔊 [Ativar meu mic]           │
├────────────────────────────────┤
│  Chat continua funcionando...  │
└────────────────────────────────┘
```

### 6.3 Chamada de áudio (voz bidirecional)

| Aspecto | Especificação |
|---|---|
| Codec | Opus (adaptativo, melhor qualidade de voz disponível) |
| Latência | 50-150ms (imperceptível) |
| Direção | Bidirecional — os dois falam e ouvem simultaneamente |
| Echo cancellation | Nativo do navegador (automático) |
| Noise suppression | Nativo do navegador (automático) |
| Fallback | Se áudio cair, chat de texto continua funcionando |

### 6.4 Câmera / videochamada (opcional)

Mesma tecnologia, mesma conexão. Consultor e/ou cliente podem ativar câmera a qualquer momento.

### 6.5 Sinalização via Supabase Realtime

```
Consultor clica "Apresentar tela"
  ↓
navigator.mediaDevices.getDisplayMedia({ video: true })
  ↓
Cria RTCPeerConnection
  ↓
Envia offer via canal Supabase Realtime (tabela ou broadcast)
  ↓
Cliente recebe offer, responde com answer
  ↓
Troca de ICE candidates via mesmo canal
  ↓
Conexão P2P estabelecida → vídeo/áudio flui direto
  ↓
Supabase sai do caminho (só fez a sinalização inicial)
```

### 6.6 Qualidade técnica

| Aspecto | Valor |
|---|---|
| Resolução da tela | 1080p (Full HD) |
| FPS | 15-30 fps |
| Latência vídeo | 100-300ms |
| Latência áudio | 50-150ms |
| Adaptive bitrate | Sim (reduz qualidade se internet piorar, em vez de travar) |
| Reconnect automático | Sim (se conexão cair 1-2s) |
| ICE restart | Sim (se mudar de rede Wi-Fi → 4G) |

### 6.7 Compatibilidade

| Navegador | Compartilhar tela | Receber tela | Áudio | Câmera |
|---|---|---|---|---|
| Chrome (desktop) | Sim | Sim | Sim | Sim |
| Firefox (desktop) | Sim | Sim | Sim | Sim |
| Edge (desktop) | Sim | Sim | Sim | Sim |
| Safari (desktop macOS 13+) | Sim | Sim | Sim | Sim |
| Chrome (Android) | Não | Sim | Sim | Sim |
| Safari (iOS 15+) | Não | Sim | Sim | Sim |

> O consultor sempre usa desktop. O cliente pode assistir de qualquer dispositivo.

### 6.8 Tratamento de erros (UX à prova de falha)

| Erro | Mensagem para o usuário | Ação automática |
|---|---|---|
| Microfone negado | "Permita o microfone nas configurações do navegador" + seta visual | — |
| Tela negada / cancelada | "Compartilhamento cancelado" (toast discreto) | Volta ao iframe |
| Internet caiu < 5s | Nenhuma mensagem | Reconecta sozinho |
| Internet caiu > 10s | "Reconectando..." com spinner | Tenta reconexão a cada 3s |
| Navegador incompatível | "Use Chrome ou Firefox para apresentação ao vivo" | Mantém chat + iframe |
| Cliente desconectou | "Cliente saiu da apresentação" (toast) | Chat continua disponível |
| Qualquer falha de mídia | — | Chat de texto SEMPRE funciona como fallback |

---

## 7. Custos

### Operação normal (até ~50 leads/mês)

| Serviço | Custo |
|---|---|
| Supabase (banco + Realtime) | **R$ 0** |
| Netlify (hospedagem + functions) | **R$ 0** |
| WebRTC (P2P) | **R$ 0** |
| STUN (Google) | **R$ 0** |
| Widget.js | **R$ 0** |
| **Total** | **R$ 0/mês** |

### Escala (50-200+ leads/mês)

| Serviço | Custo |
|---|---|
| Supabase Pro | ~R$ 130/mês ($25) |
| TURN server (se necessário, ~1% dos casos) | ~R$ 25-80/mês |
| Push notifications (OneSignal) | R$ 0 (free até 10k) |
| **Total máximo** | ~R$ 210/mês |

### Comparativo com mercado

| Solução equivalente | Custo mensal |
|---|---|
| Intercom (chat + leads) | R$ 400-2.000+ |
| JivoChat (chat + voz) | R$ 100-300 |
| Zoom (videochamada) | R$ 70-150 |
| Pipedrive (CRM) | R$ 80-200 |
| Tudo separado (Intercom + Zoom + Pipedrive + Asaas) | R$ 650-2.650 |
| **AlinhaPro (tudo integrado)** | **R$ 0 a R$ 210** |

---

## 8. Taxas de Conversão Esperadas

### Por canal

| Canal | Conversão média | Com tráfego qualificado (SEO) |
|---|---|---|
| Formulário | 2-5% | 5-8% |
| WhatsApp (botão) | 5-10% | 10-15% |
| Chat ao vivo | 8-15% | 15-25% |
| Chat + apresentação + proposta (AlinhaPro) | 12-20% | **20-35%** |

### Funil estimado (100 visitantes qualificados/mês)

| Etapa | Conservador | Otimista |
|---|---|---|
| Visitante → inicia conversa | 10-15 | 20-30 |
| Conversa → lead qualificado | 6-10 | 16-24 |
| Lead → proposta enviada | 3-6 | 11-17 |
| Proposta → fechamento | 1-2 | 5-8 |
| **Total: visitante → cliente** | **1-2%** | **5-8%** |

### Fator decisivo: tempo de resposta

| Tempo | Impacto |
|---|---|
| < 1 minuto | 391% mais conversão vs. 5 min |
| < 5 minutos | 100x mais vs. 30 min |
| > 30 minutos | Lead praticamente perdido |

### Impacto no SEO

- Widget **não prejudica** ranqueamento (Google ignora JS dinâmico de chat)
- Aumenta **tempo na página** e reduz **taxa de rejeição** (sinais positivos)
- Pode estar em **todas as páginas e posts** sem problema

---

## 9. Ordem de Implementação

### Fase 1 — Widget + Captura de Leads (2 sessões)

| # | Tarefa | Entregável |
|---|---|---|
| 1 | Migração SQL (campos de lead, RPC, RLS) | `migracao-widget.sql` |
| 2 | Widget `widget.js` (FAB + chat + lazy load) | `widget.js` |
| 3 | Formulário pré-chat (nome + contato) | Dentro do `widget.js` |
| 4 | Criação automática de sala tipo lead | RPC + lógica no widget |
| 5 | Persistência do visitante (`localStorage`) | Dentro do `widget.js` |

**Resultado:** Widget funcionando, visitantes conversam, salas de lead criadas automaticamente.

### Fase 2 — Painel de Leads + Notificações (2-3 sessões)

| # | Tarefa | Entregável |
|---|---|---|
| 6 | Aba "Leads" no admin (modo lista) | `admin.html` atualizado |
| 7 | Notificação Nível 1 (som + badge + título) | `js/notificacao.js` |
| 8 | Ficha do lead (notas, status, WhatsApp, e-mail) | Painel lateral no admin |
| 9 | Lembrete de follow-up (date picker + banner) | Admin + migração |
| 10 | "Converter em projeto" | Botão que muda `tipo` + libera funcionalidades |
| 11 | Kanban visual (arrastar cards) | Admin com drag & drop |
| 12 | Pipelines customizáveis | Tabela `pipelines` + UI |

**Resultado:** CRM completo com Kanban, follow-up, contato multicanal.

### Fase 3 — Automação + Apresentação (1 sessão)

| # | Tarefa | Entregável |
|---|---|---|
| 13 | Mensagem automática offline | Lógica no widget + config no admin |
| 14 | Detector online/offline do consultor | Heartbeat + `consultor_online` |
| 15 | Trocar URL ao vivo na sala | Campo na toolbar do preview |
| 16 | Seção fixa de chat em landing pages (opcional) | Variante do widget |

**Resultado:** Leads capturados 24h, apresentação visual ao vivo via URL.

### Fase 4 — Comunicação ao Vivo (1 sessão)

| # | Tarefa | Entregável |
|---|---|---|
| 17 | WebRTC: sinalização via Supabase Realtime | `js/rtc.js` |
| 18 | Compartilhamento de tela | `getDisplayMedia` + botão na toolbar |
| 19 | Chamada de áudio bidirecional | `getUserMedia({ audio })` |
| 20 | Câmera / videochamada (opcional) | `getUserMedia({ video })` |
| 21 | Tratamento de erros e reconexão | Fallbacks automáticos |

**Resultado:** Apresentação ao vivo tipo Zoom, integrada ao chat e à negociação.

### Fase 5 — Extras (opcional, sob demanda)

| # | Tarefa |
|---|---|
| 22 | Notificação Nível 2 — Web Push (navegador fechado) |
| 23 | Notificação Nível 3 — Telegram / WhatsApp |
| 24 | Gravação da apresentação/chamada (`MediaRecorder` API) |

---

## 10. Estimativa de Esforço

| Etapa | Complexidade | Sessões |
|---|---|---|
| Migração SQL + widget básico | Média | 1 |
| Formulário pré-chat + persistência | Média | 1 |
| Aba leads (modo lista) + notificação Nível 1 | Média | 1 |
| Ficha do lead + notas + follow-up | Simples | ½ |
| Converter lead em projeto | Simples | ½ |
| Kanban visual (drag & drop) | Média | 1 |
| Pipelines customizáveis | Média | 1 |
| Mensagem automática offline + detector | Simples | ½ |
| Trocar URL ao vivo + seção fixa | Simples | ½ |
| WebRTC: tela + áudio + câmera | Média | 1 |
| Tratamento de erros + reconexão | Simples | ½ |
| Push notification (Nível 2) | Média-alta | 1 |
| Telegram/WhatsApp (Nível 3) | Média-alta | 1 |
| Gravação de chamada | Simples | ½ |
| **Total estimado** | | **~8-10 sessões** |

---

## 11. Princípios de UX (obrigatórios em toda implementação)

| Princípio | Regra |
|---|---|
| **Zero fricção** | O visitante NUNCA precisa criar conta, instalar nada, ou sair da página |
| **Feedback instantâneo** | Toda ação tem resposta visual em < 200ms (loading, toast, animação) |
| **Fallback graceful** | Se áudio/vídeo falhar, chat de texto SEMPRE funciona |
| **Mobile first** | Widget adapta a telas pequenas (full screen ≤ 480px) |
| **Acessibilidade** | `aria-label` em todos os botões, foco visível, contraste WCAG AA |
| **Sem surpresas** | Permissões (mic, câmera) só são pedidas quando o usuário clica no botão |
| **Intuitivo** | Um clique para ligar/desligar qualquer funcionalidade. Sem menus aninhados |
| **Profissional** | Tipografia Inter, cores consistentes, sombras sutis, animações suaves |
| **Performance** | Widget < 30 KB, lazy load de dependências, 0 impacto no Lighthouse |
| **Resiliência** | Reconnect automático, heartbeat, mensagem offline — o sistema nunca "para" |
