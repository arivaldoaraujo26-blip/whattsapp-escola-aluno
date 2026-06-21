# Sistema de Notificações Escolares via WhatsApp

Backend que permite professores enviarem notificações individuais ou coletivas a responsáveis de alunos diretamente pelo WhatsApp, usando linguagem natural — sem apps adicionais.

O professor escreve "Fulano faltou hoje" no WhatsApp; o sistema identifica o aluno via IA, localiza o responsável e entrega a mensagem. Toda a interação acontece no próprio WhatsApp do professor.

## Documentação

- [Documento Técnico](docs/documentation.md) — arquitetura, decisões e escopo completo
- [Runbook Operacional](docs/operator-runbook.md) — operação do dia a dia

## Desenvolvimento

```bash
npm install
npm run dev            # servidor com live-reload
npm test               # suite de testes
npm run test:coverage  # cobertura
npm run typecheck      # verificação de tipos TypeScript
```

## Arquitetura

- **Fastify 5** — servidor HTTP com rotas de webhook, roster e healthz
- **SQLite** via `better-sqlite3` — banco local em `./data/whatsapp-bot.sqlite`
- **Meta Cloud API** (Graph v20.0) — transporte oficial WhatsApp Business
- **Google Gemini** — identificação de alunos por linguagem natural e reescrita de mensagens

## Comandos disponíveis para o professor

| Entrada | Comportamento |
|---|---|
| `Fulano faltou hoje` | Identifica o aluno via IA e envia mensagem ao responsável |
| `Para o 1A: aviso de reunião` | Envia mensagem a todos os responsáveis da turma 1A |
| `Para todos: escola fechada amanhã` | Envia mensagem a todos os responsáveis |
| `/revisar <texto>` | Reescreve o texto com IA e apresenta botões de seleção |
| `/status` | Exibe status do último envio (entregue, lido, confirmado) |
| `/status <id>` | Exibe status de um envio específico |
| `/ajuda` | Lista os comandos disponíveis |

## Banco de Dados

As migrações rodam automaticamente na inicialização. O esquema está em `migrations/`.

Todas as funções de repositório exigem `teacher_id`, garantindo isolamento de dados por professor na camada de persistência.

## Testes

```bash
npm test
```

O isolamento por professor é verificado em `src/db/repositories/repositories.test.ts` no bloco `"Integration: per-teacher isolation"`. Esse teste não deve ser removido — é a prova em execução de que o escopo por `teacher_id` previne vazamento de dados entre professores.

## Docker

```bash
docker compose up
```

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha os valores.

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão: `3000`) |
| `HOST` | Interface de bind (padrão: `0.0.0.0`) |
| `LOG_LEVEL` | Nível de log Pino (padrão: `info`) |
| `META_ACCESS_TOKEN` | Token de acesso do sistema no Meta Developer Portal |
| `META_PHONE_NUMBER_ID` | ID do número de telefone no painel Meta |
| `META_BUSINESS_NUMBER` | Número E.164 divulgado para professores e responsáveis |
| `META_WEBHOOK_VERIFY_TOKEN` | Token secreto para registro do webhook na Meta |
| `ADMIN_TOKEN` | Bearer token para rotas administrativas |
| `GEMINI_API_KEY` | Chave da API Google Gemini |
