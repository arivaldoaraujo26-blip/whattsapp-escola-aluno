# Sistema de Notificações Escolares via WhatsApp

**Documento Técnico de Projeto**
**Versão:** 0.1.0
**Data:** junho de 2026
**Autor:** Iago Araújo

---

## Sumário

1. [Resumo Executivo](#1-resumo-executivo)
2. [Introdução](#2-introdução)
3. [Contexto e Motivação](#3-contexto-e-motivação)
4. [Objetivos de Negócio](#4-objetivos-de-negócio)
5. [Escopo da Solução](#5-escopo-da-solução)
6. [Arquitetura e Tecnologias Utilizadas](#6-arquitetura-e-tecnologias-utilizadas)
7. [Casos de Uso e Fluxos Operacionais](#7-casos-de-uso-e-fluxos-operacionais)
8. [Decisões Tomadas e Justificativas](#8-decisões-tomadas-e-justificativas)
9. [Restrições, Premissas e Riscos](#9-restrições-premissas-e-riscos)
10. [Benefícios e Resultados Esperados](#10-benefícios-e-resultados-esperados)
11. [Conclusão](#11-conclusão)
12. [Referências](#12-referências)

---

## 1. Resumo Executivo

O presente documento descreve o Sistema de Notificações Escolares via WhatsApp, solução de software desenvolvida para viabilizar a comunicação direta, privada e rastreável entre professores e responsáveis por alunos do ensino básico. A solução permite que o professor envie notificações individuais ou coletivas aos responsáveis utilizando o próprio WhatsApp como interface de comando, sem necessidade de acesso a sistemas ou aplicativos adicionais.

O sistema é implementado sobre a Meta Cloud API — canal oficial de envio de mensagens do WhatsApp Business —, elimina o risco de bloqueio do número do professor e integra modelos de linguagem de grande escala (Google Gemini) para interpretação de linguagem natural e revisão de mensagens. O resultado operacional comprovado em validação completa ponta a ponta é a entrega de notificações ao responsável, com confirmação de leitura e resposta registradas no banco de dados, tudo acionado por uma única mensagem do professor em linguagem natural.

---

## 2. Introdução

Este documento tem por finalidade registrar formalmente os aspectos de negócio, arquitetura, tecnologia e decisões da iniciativa denominada Sistema de Notificações Escolares via WhatsApp, abrangendo o ciclo completo de concepção, desenvolvimento e validação do produto mínimo viável (MVP).

O documento consolida exclusivamente as informações relativas à solução final aprovada e em operação, omitindo abordagens descartadas durante o ciclo de desenvolvimento. Destina-se a servir como registro oficial do projeto, referência para futuras evoluções e base para decisões de escalonamento e governança.

A estrutura do documento segue as diretrizes das normas ABNT NBR 14724, NBR 6023 e NBR 10520, adaptadas ao formato de documentação técnica de projeto de software.

---

## 3. Contexto e Motivação

### 3.1 Cenário de Negócio

A comunicação entre professores e responsáveis por alunos no ensino básico enfrenta limitações estruturais que comprometem a eficiência, a privacidade e a rastreabilidade das interações. As modalidades predominantes — ligação telefônica direta, mensagens manuais pelo WhatsApp pessoal e uso de grupos de turma — apresentam deficiências distintas, porém convergentes no impacto negativo sobre a experiência do professor e a qualidade da comunicação.

A ligação telefônica consome tempo proporcional ao número de contatos, exige disponibilidade simultânea de professor e responsável e não produz registro verificável da interação. As mensagens manuais pelo WhatsApp pessoal do professor expõem o número pessoal do docente, não oferecem rastreabilidade de entrega e dependem integralmente da memória do professor para gestão dos contatos. Os grupos de turma, por sua vez, tornam públicas informações que deveriam ser privadas, criando exposição indevida do aluno e do conteúdo da comunicação perante todos os membros do grupo.

### 3.2 Problema Central

O problema central identificado é a ausência de um canal de comunicação escolar que seja simultaneamente eficiente do ponto de vista operacional para o professor, privado do ponto de vista do conteúdo transmitido ao responsável e rastreável do ponto de vista administrativo e pedagógico. A ausência desse canal resulta em comunicações fragmentadas, atrasos no repasse de informações críticas — como faltas, ocorrências disciplinares ou avisos de saúde — e dificuldade de comprovação de que a comunicação foi efetivamente realizada.

### 3.3 Oportunidade Identificada

O WhatsApp é o canal de comunicação mais utilizado no Brasil, com adoção transversal entre professores e responsáveis em diferentes faixas etárias e perfis socioeconômicos. A existência da Meta Cloud API — canal oficial para automação de mensagens via WhatsApp Business — abre a possibilidade de construir um sistema que utilize a infraestrutura familiar do WhatsApp como interface, eliminando a necessidade de adoção de um novo aplicativo por parte dos professores.

---

## 4. Objetivos de Negócio

### 4.1 Objetivo Estratégico

Prover às instituições de ensino básico um canal de comunicação escolar digitalizado, privado e rastreável, operado integralmente via WhatsApp Business, que reduza o tempo e o esforço do professor para notificar responsáveis e amplie a rastreabilidade das comunicações pedagógicas.

### 4.2 Objetivos Operacionais

O sistema visa atender aos seguintes objetivos operacionais mensuráveis:

**Redução do tempo de notificação.** O professor deve conseguir notificar o responsável de um aluno em linguagem natural, sem consultar agenda ou aplicativo externo, em tempo inferior a quinze segundos a partir do momento em que decide realizar o comunicado.

**Confirmação de entrega rastreável.** Cada mensagem enviada deve gerar um registro persistente com o identificador único da mensagem, o estado de entrega pelo provedor de comunicação (enviado, entregue, lido) e a confirmação explícita do responsável, quando ocorrida.

**Comunicação em escala com controle de ritmo.** O sistema deve permitir a notificação em lote de todos os responsáveis de uma turma ou de todas as turmas, com controle de cadência para respeitar os limites da plataforma de mensageria.

**Operação sem treinamento adicional.** O professor deve operar o sistema exclusivamente pelo próprio WhatsApp, sem necessidade de aprender nova interface, novo aplicativo ou novo fluxo de trabalho.

### 4.3 Indicadores de Sucesso

Os indicadores primários de sucesso do MVP são: entrega confirmada de mensagem ao responsável dentro da janela de sessão ativa, registro de confirmação de leitura pelo responsável e disponibilidade do histórico de envios consultável pelo professor via comando direto no WhatsApp.

---

## 5. Escopo da Solução

### 5.1 Escopo Incluído

O sistema abrange os seguintes componentes e funcionalidades na versão 0.1.0:

A **interface de comando via WhatsApp** é o único canal de interação do professor com o sistema. Toda operação — envio de notificação, consulta de status, revisão de mensagem e broadcast por turma — é iniciada por uma mensagem de texto enviada pelo professor ao número de WhatsApp Business da instituição.

O **módulo de processamento de linguagem natural** interpreta a mensagem do professor, identifica o aluno referenciado em linguagem coloquial, determina o responsável correspondente e extrai o conteúdo da notificação, utilizando modelo de linguagem de grande escala.

O **módulo de despacho de mensagens** executa o envio da notificação ao responsável via Meta Cloud API, persiste o estado do envio no banco de dados e notifica o professor com a confirmação do despacho, incluindo o identificador único da mensagem.

O **módulo de broadcast** estende o despacho individual para envio em lote a todos os responsáveis de uma turma específica ou de todas as turmas cadastradas, com controle de cadência de três segundos entre envios consecutivos.

O **módulo de revisão assistida por IA** permite ao professor submeter um rascunho de mensagem para reescrita pelo modelo de linguagem antes do envio, apresentando as versões original e revisada com botões de seleção interativos diretamente no WhatsApp.

O **módulo de rastreamento de entrega** recebe e persiste os eventos de status da Meta Cloud API (entregue, lido) e registra a confirmação explícita do responsável quando este responde ao número com o código de confirmação.

A **API administrativa** expõe endpoints REST autenticados para cadastro de professores e importação de listas de alunos, responsáveis e turmas no formato CSV.

### 5.2 Escopo Excluído

Não fazem parte do escopo da versão 0.1.0: interface web ou aplicativo móvel para professores; portal para responsáveis; integração com sistemas de gestão escolar (SGE/SIS); uso de templates de mensagens aprovados pela Meta; autenticação federada; e qualquer mecanismo de notificação fora do ecossistema WhatsApp.

---

## 6. Arquitetura e Tecnologias Utilizadas

### 6.1 Visão Geral da Arquitetura

A solução adota uma arquitetura monolítica modular, adequada ao porte do MVP e à necessidade de baixa complexidade operacional. O backend é uma aplicação Node.js containerizada que expõe endpoints HTTP, consome a Meta Cloud API como serviço externo de mensageria e persiste dados em banco SQLite local. A comunicação bidirecional com a plataforma Meta é estabelecida via webhook registrado, que entrega ao backend todos os eventos de entrada — mensagens dos professores, mensagens dos responsáveis e atualizações de status de entrega.

```
┌─────────────────────────────────────────────────────────┐
│                    WhatsApp (Professor)                  │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Meta Cloud API (Graph v20.0)            │
│              POST /webhook/meta  ◄──────────────────────┤
│              (eventos: mensagens + status)               │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Backend — Node.js / Fastify 5               │
│                                                         │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │  Webhook     │  │   Dispatcher   │  │  Broadcast  │ │
│  │  Handler     │  │  (Individual)  │  │  Dispatcher │ │
│  └──────┬───────┘  └───────┬────────┘  └──────┬──────┘ │
│         │                  │                   │        │
│  ┌──────▼───────────────────────────────────────────┐  │
│  │                  Domain Layer                    │  │
│  │  AckMatcher · StatusQuery · RevisarHandler       │  │
│  └──────────────────────────┬───────────────────────┘  │
│                             │                           │
│  ┌──────────────────────────▼───────────────────────┐  │
│  │               SQLite (better-sqlite3)             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────┐      ┌────────────────────────┐  │
│  │  MetaCloudClient │      │   GeminiLlmClient      │  │
│  │  (WhatsAppClient │      │  (identify + rewrite)  │  │
│  │   interface)     │      └────────────────────────┘  │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Tecnologias Adotadas

**Plataforma de execução.** A aplicação é executada sobre Node.js versão 22 com TypeScript versão 5 e sistema de módulos ECMAScript (ESM). A escolha do TypeScript garante tipagem estática em toda a base de código, reduzindo erros em tempo de compilação e aumentando a rastreabilidade das interfaces entre módulos.

**Framework HTTP.** O Fastify versão 5 é utilizado como framework HTTP, escolhido pela sua performance superior em benchmarks de servidores Node.js, suporte nativo a plugins isolados por contexto e modelo de ciclo de vida assíncrono adequado à integração com APIs externas.

**Banco de dados.** O SQLite é utilizado via biblioteca `better-sqlite3`, que expõe uma API síncrona e de alta performance para operações de leitura e escrita. A base de dados é persistida em volume Docker dedicado, garantindo durabilidade dos dados entre reinicializações do container. O esquema é versionado por migrações SQL numeradas sequencialmente, executadas automaticamente na inicialização da aplicação.

**Serviço de mensageria.** A Meta Cloud API (Graph API versão 20.0) é o único provedor de transporte de mensagens WhatsApp utilizado na solução final. Toda comunicação com a API é realizada via requisições HTTP autenticadas com token de acesso do sistema, sobre HTTPS.

**Modelo de linguagem.** O Google Gemini, acessado por meio do SDK oficial `@google/genai`, é utilizado para dois propósitos distintos: identificação do aluno e responsável a partir de mensagem em linguagem natural do professor, e reescrita de rascunhos de mensagens com tom mais formal e adequado à comunicação escolar.

**Containerização.** Docker e Docker Compose são utilizados para encapsular a aplicação e garantir reprodutibilidade do ambiente entre desenvolvimento e produção. A imagem é construída em processo multi-stage, separando o ambiente de compilação TypeScript do ambiente de execução, reduzindo o tamanho final da imagem.

**Testes.** Vitest é o executor de testes adotado, com cobertura de 272 casos de teste, desenvolvidos segundo a metodologia de desenvolvimento orientado a testes (TDD). Os testes cobrem unidades de domínio, repositórios, rotas HTTP e integrações entre componentes, utilizando banco SQLite em memória para isolamento.

**Validação de esquema.** Zod é utilizado para validação de dados em entradas externas.

### 6.3 Modelo de Dados

O banco de dados é composto por oito tabelas relacionais que modelam os atores e eventos do domínio escolar:

A tabela `teachers` armazena os professores cadastrados, com identificador único, nome, número de telefone em formato E.164, referência de instância de transporte e controle de envio da mensagem de boas-vindas. A tabela `students` registra os alunos vinculados a cada professor, com identificador de turma e referência externa para integração com sistemas escolares. A tabela `guardians` contém os responsáveis, com número de telefone, papel (pai, mãe, responsável) e estado de ativação. A tabela `student_guardians` materializa a relação muitos-para-muitos entre alunos e responsáveis.

A tabela `dispatched_messages` é o registro central de cada mensagem despachada, contendo o rascunho original, o texto enviado, o identificador do provedor, o estado (pendente, enviado, falhou) e as marcações temporais de criação e envio. A tabela `delivery_events` registra os eventos de status recebidos da Meta Cloud API (entregue, lido). A tabela `acknowledgements` registra a confirmação explícita do responsável. A tabela `inbound_messages` persiste todas as mensagens recebidas, tanto de professores quanto de responsáveis.

### 6.4 Interfaces de Integração

**Webhook Meta Cloud API.** O endpoint `GET /webhook/meta` realiza a verificação de registro do webhook com o portal Meta, comparando o token de verificação por meio de comparação de tempo constante (`timingSafeEqual`) para mitigar ataques de temporização. O endpoint `POST /webhook/meta` recebe todos os eventos de mensagens e status enviados pela plataforma Meta, sem verificação de cabeçalho de autenticação, uma vez que a plataforma Meta não envia tal cabeçalho nesse contexto.

**API Administrativa.** Os endpoints `POST /admin/teachers` e `POST /admin/roster` são protegidos por token estático via cabeçalho `Authorization: Bearer`, com validação por comparação de tempo constante. Esses endpoints destinam-se à integração com sistemas de gestão escolar ou operação manual pela equipe de suporte.

**Interface de transporte (`WhatsAppClient`).** A camada de domínio depende exclusivamente de uma interface TypeScript abstrata que declara os métodos `sendText` e `sendInteractiveButtons`. A implementação concreta `MetaCloudClient` realiza as chamadas à Meta Cloud API. Essa abstração é essencial para a testabilidade do sistema e para eventual substituição do provedor de mensageria sem alteração da lógica de domínio.

---

## 7. Casos de Uso e Fluxos Operacionais

### 7.1 Atores do Sistema

O sistema envolve três atores: o **professor**, que interage com o bot via WhatsApp para envio de notificações e consultas; o **responsável**, que recebe as notificações e pode confirmar o recebimento; e o **administrador do sistema**, que cadastra professores e importa listas de alunos via API REST.

### 7.2 Caso de Uso 1 — Despacho Individual por Linguagem Natural

O professor envia ao número de WhatsApp Business uma mensagem em linguagem natural que mencione o nome do aluno e o motivo da notificação. O sistema extrai o texto, constrói o contexto do modelo de linguagem com o nome e papel de todos os responsáveis cadastrados para aquele professor, e submete a requisição ao Gemini. O modelo retorna o aluno identificado, o responsável correspondente, o conteúdo reformulado e um índice de confiança.

Caso a confiança seja superior a setenta por cento e a intenção seja inequívoca, o sistema persiste o registro da mensagem no banco de dados, realiza o envio ao responsável via Meta Cloud API com a instrução de confirmação ("Responda 1 para confirmar"), atualiza o estado da mensagem para "enviado" e retorna ao professor a confirmação com o identificador único da mensagem. Caso a identificação seja ambígua, o sistema solicita ao professor uma especificação adicional, apresentando a lista de candidatos identificados.

Em caso de falha de transporte, o sistema realiza até três tentativas com espera exponencial de um segundo, três segundos e nove segundos entre cada tentativa antes de declarar a falha e notificar o professor.

### 7.3 Caso de Uso 2 — Broadcast por Turma ou Global

O professor envia uma mensagem no formato `Para o <turma>: <conteúdo>` ou `Para todos: <conteúdo>`. O sistema identifica todos os responsáveis ativos associados aos alunos da turma informada — ou de todas as turmas, no caso do comando global — e realiza o despacho sequencial, respeitando um intervalo de três segundos entre envios consecutivos por meio de um limitador de cadência por professor. Cada mensagem despachada gera um registro individual no banco com o identificador do grupo de broadcast para consulta agregada posterior.

### 7.4 Caso de Uso 3 — Revisão Assistida por IA

O professor envia o comando `/revisar <rascunho>`. O sistema submete o texto ao Gemini para reescrita com linguagem formal e adequada ao contexto escolar. O sistema então envia ao professor uma mensagem interativa com os botões "Enviar original" e "Enviar revisado". Ao selecionar um botão, o professor confirma a versão desejada, que é encaminhada ao fluxo de despacho individual padrão.

### 7.5 Caso de Uso 4 — Consulta de Status

O professor envia `/status` para consultar o último envio ou `/status <id>` para consultar um envio específico. O sistema retorna, para cada responsável impactado, o estado de leitura (confirmado pela Meta Cloud API) e o estado de confirmação explícita (ACK registrado pelo responsável).

### 7.6 Caso de Uso 5 — Confirmação pelo Responsável

Quando o responsável responde com o valor "1" ao número de WhatsApp Business, o sistema localiza a mensagem despachada mais recente para aquele responsável dentro de uma janela de vinte e quatro horas, verifica a ausência de confirmação anterior e registra o reconhecimento (ACK) em uma transação atômica no banco de dados. O professor pode consultar essa confirmação por meio do comando `/status`.

### 7.7 Caso de Uso 6 — Onboarding do Professor

Na primeira mensagem enviada pelo professor ao número de WhatsApp Business, o sistema verifica a ausência do registro de boas-vindas, envia uma mensagem estruturada informando o número de alunos cadastrados e os comandos disponíveis, e registra permanentemente que a mensagem de boas-vindas foi enviada para evitar reenvios.

### 7.8 Caso de Uso 7 — Cadastro e Importação via API Administrativa

O administrador realiza o cadastro de professores via `POST /admin/teachers`, informando nome e número de telefone em formato E.164. Para importação de alunos, responsáveis e turmas, o administrador envia um arquivo CSV via `POST /admin/roster`, com as colunas obrigatórias: `teacher_external_id`, `student_external_id`, `student_name`, `class_id`, `guardian_name`, `guardian_role` e `guardian_phone_e164`. O sistema valida cada linha do arquivo, rejeita linhas inválidas com mensagens de erro descritivas e persiste as linhas válidas em transação atômica.

---

## 8. Decisões Tomadas e Justificativas

### 8.1 Decisão Arquitetural — Adoção da Meta Cloud API como Único Canal de Mensageria

**Decisão:** o sistema utiliza exclusivamente a Meta Cloud API (Graph API v20.0) como provedor de envio e recebimento de mensagens WhatsApp, descartando integrações baseadas em emulação do cliente WhatsApp Web.

**Justificativa:** abordagens baseadas em automação do protocolo WhatsApp Web violam os Termos de Serviço da Meta e expõem o número utilizado a bloqueio permanente sem aviso prévio, inviabilizando o serviço do ponto de vista operacional. A Meta Cloud API é o canal oficial para automação de mensagens WhatsApp Business, com suporte documentado, SLA implícito de plataforma e ausência de risco de bloqueio por violação contratual.

**Trade-off:** a Meta Cloud API impõe a janela de sessão de vinte e quatro horas: mensagens do sistema para responsáveis que não tenham iniciado uma conversa com o número nas últimas vinte e quatro horas requerem o uso de templates de mensagens pré-aprovados pela Meta. No MVP, essa restrição é mitigada operacionalmente pela instrução ao responsável de enviar ao menos uma mensagem inicial ao número.

### 8.2 Decisão Arquitetural — Arranjo de Número Compartilhado (A1)

**Decisão:** todos os professores de uma instituição utilizam o mesmo número de WhatsApp Business. A identificação do professor emitente é realizada pelo número de telefone do remetente da mensagem recebida no webhook.

**Justificativa:** a alternativa de um número exclusivo por professor exigiria o registro de múltiplos números WhatsApp Business, com custo proporcional ao número de docentes e complexidade de gestão correspondente. O modelo de número compartilhado reduz o custo fixo da solução, simplifica o onboarding e mantém a experiência do professor idêntica.

**Trade-off:** o número institucional deve ser amplamente divulgado para que os responsáveis o salvem em suas agendas. A associação entre mensagem recebida e professor é interna ao sistema, invisível ao responsável, que interage com um número único independentemente do professor que originou o contato.

### 8.3 Decisão de Produto — Ausência de Templates de Mensagem no MVP

**Decisão:** o MVP não utiliza templates de mensagens aprovados pela Meta, operando integralmente dentro da janela de sessão de vinte e quatro horas.

**Justificativa:** o processo de criação e aprovação de templates pela Meta envolve custo, tempo de aprovação variável e restrições de conteúdo. Para o MVP, o fluxo de operação dentro da janela de sessão é suficiente, dado que o contexto escolar garante interações frequentes entre a instituição e os responsáveis.

**Trade-off:** o sistema não consegue iniciar comunicações com responsáveis que não tenham interagido com o número nas últimas vinte e quatro horas. A mitigação operacional adotada é a instrução explícita ao responsável para enviar uma mensagem inicial ao número no momento do onboarding.

### 8.4 Decisão de Segurança — Ausência de Autenticação no POST do Webhook

**Decisão:** o endpoint `POST /webhook/meta` não realiza verificação de cabeçalho de autenticação.

**Justificativa:** a Meta Cloud API não envia cabeçalho `Authorization` nas requisições de webhook. A implementação de verificação de token nesse endpoint resultaria em rejeição (HTTP 401) de todos os eventos legítimos enviados pela plataforma. A autenticidade do emissor é verificada na etapa de registro do webhook pelo mecanismo de challenge-response com token de verificação.

### 8.5 Decisão de Segurança — Comparação de Tempo Constante

**Decisão:** todas as comparações de tokens de segurança (token de verificação do webhook Meta e token administrativo) utilizam a função `timingSafeEqual` da biblioteca nativa `crypto` do Node.js.

**Justificativa:** comparações de strings por igualdade direta (`===`) têm duração variável dependendo do ponto de divergência entre os valores comparados, o que possibilita ataques de temporização para inferência do token correto. A comparação de tempo constante elimina essa superfície de ataque.

### 8.6 Decisão de Persistência — SQLite com better-sqlite3

**Decisão:** o banco de dados relacional SQLite é utilizado com a biblioteca `better-sqlite3`, que expõe uma API síncrona, em arquivo local persistido em volume Docker.

**Justificativa:** para o porte do MVP, o SQLite oferece zero overhead de infraestrutura externa, eliminando a necessidade de um servidor de banco de dados separado, com todas as garantias de atomicidade transacional necessárias. A API síncrona do `better-sqlite3` simplifica o código de repositório e elimina a complexidade de gerenciamento de pool de conexões.

**Trade-off:** o SQLite não suporta escritas concorrentes de múltiplos processos. Para escalonamento horizontal futuro, a camada de persistência precisará ser migrada para um banco de dados cliente-servidor, como PostgreSQL.

### 8.7 Decisão Arquitetural — Interface de Transporte Abstrata

**Decisão:** toda a lógica de domínio depende exclusivamente de uma interface TypeScript de transporte (`WhatsAppClient`), declarando os métodos `sendText` e `sendInteractiveButtons`. A implementação concreta `MetaCloudClient` é injetada no momento de composição da aplicação.

**Justificativa:** a abstração desacopla o domínio do provedor de mensageria, permitindo troca de provedor sem alteração da lógica de negócio. A injeção de dependência por interface é o mecanismo central de testabilidade do sistema: nos testes, a interface é implementada por um dublê de teste controlado por Vitest, permitindo validação do comportamento de domínio sem chamadas reais à Meta Cloud API.

### 8.8 Decisão Operacional — Rate Limiting no Broadcast

**Decisão:** o módulo de broadcast implementa um limitador de cadência de três segundos entre envios consecutivos, instanciado por professor.

**Justificativa:** o envio simultâneo de múltiplas mensagens pode acionar mecanismos de throttling da Meta Cloud API, resultando em falhas de entrega. O limitador de cadência distribui os envios ao longo do tempo de forma controlada, reduzindo a probabilidade de rejeição pela plataforma.

### 8.9 Decisão Operacional — Retry com Backoff Exponencial no Despacho Individual

**Decisão:** o módulo de despacho individual realiza até três tentativas de envio em caso de falha de transporte (`transport_failed`), com intervalos de espera de um segundo, três segundos e nove segundos entre as tentativas.

**Justificativa:** falhas transitórias de rede ou de disponibilidade temporária da Meta Cloud API não devem resultar em perda definitiva da mensagem. O backoff exponencial evita sobrecarga do serviço remoto em cenários de degradação parcial.

### 8.10 Decisão de Produto — Janela de Reconhecimento de 24 Horas

**Decisão:** o mecanismo de reconhecimento de mensagem pelo responsável considera apenas mensagens despachadas nas últimas vinte e quatro horas para o match com a resposta "1" do responsável.

**Justificativa:** o vínculo entre a resposta do responsável e uma mensagem específica é realizado por proximidade temporal, não por identificador explícito. A janela de vinte e quatro horas corresponde à janela de sessão da Meta Cloud API e representa o horizonte razoável de resposta a uma notificação escolar urgente.

---

## 9. Restrições, Premissas e Riscos

### 9.1 Restrições

**Janela de sessão Meta Cloud API.** A plataforma Meta permite que o sistema envie mensagens ao responsável somente se o responsável tiver enviado uma mensagem ao número nas últimas vinte e quatro horas. Fora dessa janela, o envio de mensagens de formato livre é bloqueado pela plataforma e exige o uso de templates pré-aprovados, não implementados no MVP.

**Número único de WhatsApp Business.** O sistema opera com um único número, o que implica que qualquer professor cuja mensagem seja mal classificada quanto à origem pode inadvertidamente acionar fluxos de outro professor. O isolamento é garantido pelo mapeamento do número de telefone do remetente ao registro de professor no banco de dados.

**SQLite sem concorrência de escritas.** A arquitetura atual não suporta múltiplas instâncias do backend operando simultaneamente sobre o mesmo banco de dados, restringindo o escalonamento horizontal.

**Dependência de ngrok para webhook em ambiente de desenvolvimento.** Em ambiente local, o webhook da Meta Cloud API requer uma URL pública acessível. A solução de desenvolvimento utiliza o serviço ngrok para exposição temporária do servidor local, o que implica que a URL do webhook deve ser atualizada no painel Meta a cada nova sessão ngrok.

### 9.2 Premissas

O projeto opera sobre as seguintes premissas: o professor possui um número de telefone WhatsApp cadastrado no sistema e utiliza o WhatsApp regularmente; os responsáveis possuem números de telefone válidos no formato E.164 cadastrados no banco de dados; a instituição registrou e configurou um número WhatsApp Business no painel Meta Developer; o responsável realizou ao menos uma interação inicial com o número de WhatsApp Business antes de receber a primeira notificação do sistema; e a chave de acesso à Meta Cloud API e à API Gemini são válidas e mantidas atualizadas pela equipe de operação.

### 9.3 Riscos

**Expiração do token de acesso Meta.** O token de acesso da Meta Cloud API tem prazo de validade. A expiração do token sem substituição oportuna interrompe integralmente o funcionamento do sistema de envio de mensagens. Mitigação: implementar monitoramento de validade do token e processo de renovação periódica.

**Esgotamento da cota gratuita do Gemini.** O Google Gemini possui limites de requisições por minuto e por dia no nível gratuito. Em cenários de alto volume de despachos simultâneos, o sistema pode atingir o limite e degradar a capacidade de identificação de alunos. Mitigação: o sistema retorna mensagem de erro compreensível ao professor em caso de falha do modelo, sem interromper outros fluxos.

**Ausência de responsável ativo na janela de sessão.** Responsáveis que nunca interagiram com o número de WhatsApp Business não podem receber mensagens do sistema sem o uso de templates. Esse cenário é gerenciável no MVP por meio de orientação operacional, mas requer solução técnica definitiva (templates) para uso em produção em escala.

**Perda de dados por ausência de backup.** O banco SQLite em volume Docker não possui estratégia de backup automatizado na versão atual. A perda do volume implica perda integral dos dados do sistema. Mitigação a implementar: backup periódico do arquivo de banco de dados para armazenamento externo.

**Ausência de ambiente de produção permanente.** O sistema atualmente opera em ambiente local com exposição via ngrok. A dependência de um computador local e de uma sessão ngrok ativa representa risco de indisponibilidade. Mitigação: migração para plataforma de computação em nuvem com disponibilidade contínua (Railway, Render, Fly.io ou equivalente).

---

## 10. Benefícios e Resultados Esperados

### 10.1 Benefícios Operacionais

O sistema reduz o esforço operacional do professor para comunicação com responsáveis de minutos para segundos por ocorrência, eliminando a necessidade de consulta de agenda, discagem de telefone ou composição manual de mensagem com localização de contato. A interface de linguagem natural elimina a curva de aprendizado e permite que o professor comunique ocorrências de forma imediata, no momento em que a informação é relevante.

O broadcast por turma, combinado com o rate limiting automático, permite que o professor notifique simultaneamente dezenas de responsáveis com um único comando, sem o risco de sobrecarga da plataforma de mensageria e sem exposição coletiva do conteúdo da comunicação.

### 10.2 Benefícios para a Gestão Escolar

A rastreabilidade integral do ciclo de comunicação — desde o envio pelo professor até a confirmação de leitura e o ACK do responsável — cria um registro auditável de cada comunicação pedagógica, contribuindo para a transparência administrativa e para a comprovação de cumprimento de deveres de comunicação em eventual contexto de contestação.

### 10.3 Benefícios para os Responsáveis

Os responsáveis recebem notificações individuais e privadas no canal que já utilizam cotidianamente, sem necessidade de instalar aplicativos adicionais. A presença do botão de confirmação simplifica o registro do recebimento e sinaliza à instituição que a comunicação foi efetivamente processada.

### 10.4 Resultado Alcançado no MVP

O fluxo ponta a ponta foi validado em ambiente de produção: o professor enviou uma mensagem em linguagem natural mencionando o aluno, o sistema identificou corretamente o aluno e o responsável por meio do modelo Gemini, enviou a notificação ao responsável via Meta Cloud API, o responsável recebeu a mensagem e confirmou o recebimento, e o sistema registrou os eventos de entrega e confirmação no banco de dados. A consulta de status via `/status` refletiu corretamente o estado final da comunicação.

### 10.5 Próximos Passos

O roteiro de evolução imediata da solução compreende as seguintes iniciativas prioritárias:

**Implantação em ambiente de produção permanente.** A migração do sistema para uma plataforma de computação em nuvem com disponibilidade contínua é o requisito mais urgente para operação em produção. Plataformas como Railway, Render ou Fly.io suportam deployment containerizado com zero infraestrutura gerenciada, compatíveis com a arquitetura atual.

**Implementação de templates de mensagens WhatsApp.** O registro e aprovação de templates junto à Meta permitirá a eliminação da restrição de janela de sessão de vinte e quatro horas, habilitando o sistema a iniciar conversas com responsáveis que nunca interagiram com o número.

**Estratégia de backup do banco de dados.** A implementação de backup automatizado do arquivo SQLite para armazenamento externo é necessária para garantir continuidade do serviço em caso de falha do ambiente de hospedagem.

**Monitoramento e alertas operacionais.** A instrumentação do sistema com métricas de taxa de sucesso de envio, latência do modelo de linguagem e erros de transporte, com alertas para a equipe de operação, é necessária para operação sustentável em produção.

**Suporte a múltiplas instituições.** A arquitetura atual suporta múltiplos professores em um mesmo banco de dados, com isolamento por `teacher_id`. A extensão para múltiplas instituições requereria o isolamento adicional por instituição e uma camada de administração multi-tenant.

---

## 11. Conclusão

O Sistema de Notificações Escolares via WhatsApp representa uma solução pragmática e tecnicamente sólida para o problema de comunicação individualizada entre professores e responsáveis no contexto do ensino básico. A adoção da Meta Cloud API como canal oficial de mensageria elimina o principal risco operacional de soluções concorrentes baseadas em automação não oficial do WhatsApp, ao mesmo tempo em que mantém a experiência do professor idêntica à do uso comum do aplicativo.

A arquitetura modular, com separação clara entre camadas de transporte, domínio e persistência, e a cobertura de testes superior a 272 casos proporcionam uma base de código com qualidade adequada para evolução controlada. A validação ponta a ponta realizada em ambiente com credenciais reais confirma a viabilidade técnica e operacional da solução.

Os próximos passos identificados — implantação em nuvem, templates de mensagens e backup de dados — são requisitos diretos para a operação sustentável em produção e não representam obstáculos arquiteturais, dado o grau de desacoplamento já presente na solução atual.

---

## 12. Referências

META PLATFORMS, INC. **Meta Cloud API — WhatsApp Business Platform Documentation**. Disponível em: https://developers.facebook.com/docs/whatsapp/cloud-api. Acesso em: jun. 2026.

GOOGLE LLC. **Gemini API Documentation**. Disponível em: https://ai.google.dev/gemini-api/docs. Acesso em: jun. 2026.

FASTIFY TEAM. **Fastify — Fast and low overhead web framework for Node.js**. Versão 5. Disponível em: https://fastify.dev. Acesso em: jun. 2026.

KRIASOFT LLC. **better-sqlite3 — The fastest and simplest library for SQLite3 in Node.js**. Disponível em: https://github.com/WiseLibs/better-sqlite3. Acesso em: jun. 2026.

ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. **NBR 14724**: Informação e documentação — Trabalhos acadêmicos — Apresentação. Rio de Janeiro: ABNT, 2011.

ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. **NBR 6023**: Informação e documentação — Referências — Elaboração. Rio de Janeiro: ABNT, 2018.

ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. **NBR 10520**: Informação e documentação — Citações em documentos — Apresentação. Rio de Janeiro: ABNT, 2002.
