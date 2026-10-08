# Plano CTO — distribuição/importação com um responsável humano e IA

Data: 07/10/2026. Base: workspace MercadinhoSys, auditoria de código e testes, inventário Oracle somente leitura e comparação de arquivos publicados. [Auditoria funcional](AUDITORIA_MIGRACAO_ERP_DISTRIBUIDORA_2026-10-07.md) · [Infraestrutura e matemática](ANEXO_CTO_INFRA_E_MATEMATICA_2026-10-07.md).

## 1. Decisão e objetivo de produto

**Não liberar a migração integral de uma distribuidora/importadora no estado atual.** Há base comercial aproveitável, mas nove defeitos de negócio reproduzidos e duas falhas adicionais de confiança analítica. O ciclo B2B/importação/fiscal/contábil ainda não foi demonstrado de ponta a ponta. A infraestrutura publicada é de demonstração, com uma VM Oracle de aproximadamente 1 GB para API/banco/Redis/proxy.

Objetivo do produto: operar um piloto real delimitado, com cadastro PJ, pedido comercial validado, disponibilidade/reserva, recebimento e expedição rastreáveis, documentos fiscais válidos, títulos e liquidações conciliados, devolução e atendimento vinculados à venda. Cada incremento deve demonstrar esse objetivo sem comprometer o dinheiro ou o estoque.

O diferencial competitivo deve ser mensurável: promessa de entrega confiável, custo/margem explicáveis, rastreabilidade de importação e lote, venda fácil para representantes e resolução de ocorrências. Quantidade de telas e texto de IA não comprovam esses resultados. Não prometemos paridade com SAP/TOTVS sem matriz de processos homologada pelo cliente.

## 2. Modelo de trabalho realista

Você é o único responsável humano. Decide prioridades, fornece contexto da empresa, valida regras e aceita releases. A assistência de IA realiza investigação, especificação, código, testes, revisão e documentação durante as tarefas autorizadas. Nenhum agente se torna aprovador independente apenas por receber outro nome.

Adotar uma **cadência inspirada em Scrum**, com objetivo de produto, backlog único, objetivo por sprint, incremento demonstrável, inspeção e retrospectiva. Isso é uma adaptação à operação solo; não afirmar que agentes de IA constituem a equipe de pessoas definida no [Scrum Guide](https://scrumguides.org/scrum-guide.html). A capacidade deve partir do tempo real disponível e das entregas observadas, sem multiplicar velocidade pelo número de agentes.

Proposta de cadência: sprints de duas semanas; planejamento de até 60 minutos; atualização diária breve do objetivo, evidências e impedimentos; revisão demonstrando o fluxo com dados conhecidos; retrospectiva de até 30 minutos. Refinamento contínuo das próximas histórias. Uma história em implementação e uma em revisão, no máximo; urgência de produção interrompe o trabalho planejado e é registrada.

Exemplo **condicional**, ainda sem sua disponibilidade informada: se houver 30 horas úteis por semana, uma sprint tem 60 horas brutas; planejar até 45 e reservar 15 para suporte, revisão, integração e imprevistos. Se houver 10 horas por semana, a capacidade planejada cai a 15 por sprint. Horas são envelope inicial, não compromisso comercial. Depois de três sprints, usar tempo de ciclo, itens realmente concluídos e variação para fazer previsão em faixas. Sem velocidade inventada.

Uso futuro de vários agentes: tarefas com fronteiras e arquivos definidos, mesma especificação, sem escrita simultânea no mesmo módulo, integração e revisão pelo responsável. Paralelizar investigação pode ajudar; escrita concorrente em estoque/financeiro aumenta risco. O plano não depende de um exército de agentes nem de contratação de uma equipe fictícia.

## 3. Descoberta necessária antes de firmar data e preço

Ainda faltam porte, prazo comercial, disponibilidade semanal e orçamento. Isso não impede corrigir os defeitos já comprovados; impede certificar dimensionamento e prometer data para a operação completa.

Entregáveis de descoberta:

1. **Mapa empresarial:** grupo/CNPJs/filiais/depósitos, centros de custo, países/moedas, canais, usuários/papéis e parceiros externos.
2. **Envelope de carga:** SKUs, lotes, clientes, anos de histórico, pedidos/dia e linhas/pedido; usuários concorrentes no pico, picos de importação e relatórios; tamanhos de anexos e crescimento mensal. Registrar valores reais, p95 e pico, não só médias.
3. **Catálogo de processos:** uma compra nacional, uma importação, uma venda B2B, recebimento/entrega parcial, devolução, cancelamento fiscal, inadimplência e fechamento financeiro reais, com documentos anonimizados e responsável por validar.
4. **Integrações e fonte oficial:** ERP atual, bancos, adquirentes, fiscal, contabilidade, folha, transportadoras, comércio exterior, comunicação. Definir quem escreve cada cadastro, saldo e documento durante coexistência.
5. **Limites do piloto:** uma empresa/depósito/canal/família com volume e data acordados; cobertura obrigatória e processos mantidos no ERP existente. Proibir dois escritores independentes do mesmo saldo.

Criar matriz processo × funcionalidade × evidência × lacuna × aceite. Sem amostras reais, os dados do seed servem apenas a demonstração.

## 4. Arquitetura de implementação

### Decisão A-01: preservar a base e construir um monólito modular

Manter React/TypeScript e Flask/PostgreSQL inicialmente. Não iniciar reescrita completa nem microserviços antes de resolver regras e medir gargalos. Modularizar serviços de domínio e impedir que PDV, SFA e entrega implementem baixas independentes.

Domínios: identidade/organização; cadastro comercial; pedidos/preços/crédito; compras/recebimento; estoque/lotes/depósitos; tesouraria; fiscal; importação; CX; integrações; analytics. HCM oficial e escrituração devem ter estratégia explícita de integração ou implementação homologada; não converter cálculos gerenciais existentes em folha ou contabilidade oficial por nomenclatura.

### Decisão A-02: operações financeiras e de estoque com efeito único

Serviços de aplicação calculam valores no servidor, validam permissões e fazem uma transação para os efeitos locais relacionados. PostgreSQL: locks nas linhas apropriadas, ordem consistente de aquisição, constraints únicas e validação do relacionamento com o tenant. Chave idempotente com escopo e hash da requisição; repetição legítima devolve o resultado original; chave reutilizada com conteúdo diferente é rejeitada.

Uma venda registra pedido, consumo/reserva, custo histórico e obrigação coerentes. Estoque tem movimentos rastreáveis por origem, item, lote, depósito e unidade. Agregados são reconciliáveis com movimentos; reversão gera movimento compensatório vinculado. Não alterar o passado silenciosamente.

Documentos/provedores externos não participam da transação PostgreSQL. Usar outbox transacional, worker com tentativas limitadas, deduplicação, fila de falhas e reconciliação. Entrega pelo menos uma vez exige consumidor idempotente; não prometer “exactly once” entre serviços. Timeouts deixam estado pendente até consultar o provedor, evitando emissão/cobrança duplicada.

### Decisão A-03: organização e depósitos são entidades diferentes

Hoje estabelecimento concentra separação de dados. Evoluir organização/grupo, entidade legal, filial e depósito com migração explícita. Não transformar depósito em outro tenant para contornar falta de modelo. Saldo por produto/lote/depósito, reserva por pedido, transferências com trânsito e conferência; unidade base com fatores de conversão e escalas precisas.

### Decisão A-04: verdade financeira e analítica comum

Decimal do começo ao fim para dinheiro/custo/unidade; escala por campo e arredondamento documentado. Distinguir margem de markup, saldo de valor original, caixa de competência, estoque disponível de físico. Catálogo de métricas com fórmula, janela, fuso, cancelamentos e origem. Caches incluem tenant e versão e são invalidados por eventos relevantes.

LLM auxilia interpretação e redação. Regras de cálculo, permissões, crédito e lançamentos permanecem determinísticos, auditáveis e testados. Valores artificiais ficam somente em ambiente identificado de demonstração.

### Decisão A-05: infraestrutura separada por ambiente e recuperável

Criar staging isolado com PostgreSQL real, integrações em homologação e dados sintéticos/anonimizados. Como ponto de partida de benchmark, avaliar aplicação com 2–4 vCPU e 8 GB, e banco separado ou gerenciado. Isso é hipótese de teste, não requisito mínimo certificado nem solução automática de disponibilidade.

Backup cifrado externo ao host, política de retenção aprovada, recuperação pontual quando exigida e restauração ensaiada. Metas propostas: RPO ≤15 minutos, RTO ≤2 horas, disponibilidade 99,9% mensal. Confirmar custo e capacidade antes de assumir SLA. O banco atual pode continuar em demonstração enquanto o ambiente empresarial é preparado.

Publicação: imagem imutável, revisão/digest conhecidos, migração versionada, verificação de backup, health/readiness, observabilidade e rollback ensaiado. Schema incompatível requer migração expansiva/contrativa; voltar a imagem não desfaz perda de dados nem emissão fiscal.

## 5. Backlog ordenado com aceite verificável

Tamanho S = escopo localizado; M = mais de um fluxo; L = épico que deve ser dividido antes da sprint. Não representam dias ou velocidade. Prioridade P0 = impede integridade/liberação; P1 = requisito do piloto; P2 = expansão após piloto. Dono humano de toda entrega: você. Assistência técnica: IA. Validação especializada dos resultados fiscais, contábeis e de folha: profissional/fornecedor competente definido na descoberta.

| ID / prioridade / tamanho | Entrega e dependências | Critério mínimo de aceite |
|---|---|---|
| FUN-01 / P0 / S | Baseline do release e inventário de mudanças; primeiro passo | Separar alterações anteriores das desta entrega; revisão/digest/schema conhecidos; testes com banco isolado; não incluir mudanças alheias em publicação |
| ANA-01/02 / P0 / S | Retirar números inventados; fonte no anexo | Sem histórico não há previsão; sem pares não há correlação; testes de aceitação passam sem xfail; interface explica falta de dados |
| SUP-01 / P0 / S | Concluir incidente fornecedores; após FUN-01 | Nenhum caminho retorna None; filtros/tenant preservados; schema e exceção principal diagnosticados; teste autenticado em staging; release revisável preparado |
| FIN-01 / P0 / M | Corrigir ERP-02/03: baixas, validações, histórico e saldo | Título 40 aceita baixas 10+30; rejeita -10, NaN/Infinity e excedente indevido; repetição/concorrência não duplica dinheiro; reconciliação fecha em centavos |
| EST-01 / P0 / L | Unificar venda/consumo/custo: ERP-05/06/09; após baseline | PDV/SFA/entrega de 2 unidades reduz 10→8 e lote 10→8; guarda custo histórico; retry não baixa novamente; cancelamento compensa uma vez |
| COM-01 / P0 / M | Recebimento parcial e três documentos; ERP-01; após EST-01 | 10 solicitadas, recebe 3 e depois 7; pendência/status corretos; pedido, recebimentos e XML não duplicam estoque/título |
| CUS-01 / P1 / M | Custo fracionado e rateios; ERP-07; após EST-01 | 1,5@10 + 0,5@20 =12,50; frete/desconto/bonificação têm política; soma de rateios fecha; unidades/lotes suportam escala definida |
| VAL-01 / P1 / S | Elegibilidade FEFO e quarentena; ERP-08 | Lote vencido/bloqueado não disponível para venda; validade ausente é explícita; não inventar data; autorização excepcional auditada se admitida |
| VEN-01 / P0 / M | Preço centralizado SFA; ERP-04; após EST-01 | 2×10 não vira pedido de 1; servidor calcula itens, descontos, frete, total; alçadas/tabela vigentes; payload manipulado rejeitado |
| B2B-01 / P1 / M | PF/PJ, contatos, endereços e condições | Empresa cadastrada por CNPJ e identidade fiscal próprios; contato separado; faturamento/entrega distintos; migração preserva clientes antigos |
| CRE-01 / P1 / M | Crédito e aprovação comercial; após FIN-01/B2B-01 | Exposição inclui dívida e pedidos comprometidos; bloqueio uniforme em canais; exceção por alçada; concorrência respeita limite; RFM não concede crédito sozinho |
| PED-01 / P1 / L | Pedido→reserva→separação→expedição→entrega parcial | Máquina de estados válida; faltas/backorder explícitos; disponibilidade não negativa por concorrência; status e prazo visíveis ao atendimento |
| WMS-01 / P1 / L | Depósitos/endereço, transferências e inventário; após EST-01 | Transferência origem/destino/trânsito reconciliada; inventário por contagem/aprovação sem sobrescrever movimentos; lote localizável |
| FIS-01 / P1 / L | Integração NF-e B2B e eventos aplicáveis; após B2B-01/VEN-01 | Homologar operações reais do cliente, XML/protocolo/eventos e contingências; retry/timeouts sem duplicação; regras e versões validadas; nenhum documento simulado tratado como autorizado |
| TES-01 / P1 / L | Conciliação e fechamento; após FIN-01/CUS-01 | Banco/adquirente/título/liquidação conciliados; taxa/juros/desconto/estorno rastreáveis; fechamento bloqueia alteração indevida; integração contábil ou livro homologado |
| IMP-01 / P1 / L | Processo internacional completo; após COM-01/CUS-01/FIS-01 | Moeda/taxa/data, fornecedor estrangeiro, embarque, documentos, custos e desembaraço vinculados; rateio de nacionalização fecha; variação cambial separada; recebimento nacional conciliado à importação |
| CX-01 / P1 / L | Pós-venda, devolução, troca e atendimento; após PED-01/FIS-01/TES-01 | Chamado com responsável/prazo; devolução parcial rastreia item/lote, recebível, imposto e reembolso externo; cliente acompanha resolução |
| CX-02 / P2 / M | Marketing/fidelização; após catálogo ANA-03 e CX-01 | Segmentação real por janela; preferências de contato; ação rastreável e resultados medidos; nenhuma campanha enviada sem autorização |
| ANA-03 / P1 / L | Catálogo e revisão de todos os indicadores; após custo/financeiro | Receita/CMV reconciliados; RFM único; ABC com fronteira definida; previsão comparada a baseline; confiança e amostra explicadas |
| HCM-01 / P1 / L | Estratégia de folha/contabilidade externas ou módulo homologado | Escopo oficial decidido; competências/versionamento e integrações validadas. Funcionalidades atuais não substituem homologação especializada |
| OPS-01 / P0 / M | Backup externo/restauração e staging; após FUN-01 | Recuperar banco/anexos em ambiente limpo; medir perda/tempo; alertas de falha; cópia fora da VM; plano de incidentes executável pelo único operador |
| SEC-01 / P1 / M | Isolamento/segregação/auditoria; transversal | Matriz de perfis; tentativas cross-tenant falham em escrita/leitura/anexos/jobs; operações sensíveis auditadas; segredos não saem em logs/artefatos |
| CAR-01 / P1 / M | Certificação de carga; após fluxos estabilizados | Tráfego pela rede, mistura representativa de venda/recebimento/analytics; métricas p95/p99/erros/locks/memória; limites testados com pico acordado |
| MIG-01 / P1 / L | Migração/ensaio/piloto; após gates abaixo | Importação repetível, IDs/chaves preservados, reconciliação de todos os saldos, ensaio de cutover/retorno; cliente aceita processos delimitados |

FIS/HCM/IMP/TES são épicos. Exigem amostras e contratos externos antes de estimativa confiável; não entram como uma única tarefa de uma sprint. O backlog deve distinguir conector contratado de desenvolvimento próprio e custo recorrente.

## 6. Primeira sprint proposta

**Objetivo:** dinheiro não sofre baixas inválidas, indicadores não inventam observações e há uma base de release rastreável. A sprint não autoriza migração empresarial.

Envelope ilustrativo de até 45 horas planejadas se a disponibilidade bruta for 60; faixas devem ser revistas na primeira sessão de implementação:

| Ordem | Trabalho | Faixa inicial | Saída revisável |
|---|---|---|---|
| 1 | FUN-01 e separar estado local/publicado | 4–6 h | Inventário de diff, baseline e plano de release sem mudanças alheias |
| 2 | ANA-01/02, contrato de ausência e apresentação | 4–6 h | Dois testes hoje falhos aprovados; UI sem valores inventados |
| 3 | FIN-01: domínio, validações e baixas sucessivas | 12–18 h | Histórico imutável, saldo derivado; testes de negativo, saldo e repetição |
| 4 | SUP-01: causa principal/staging e release preparado | 3–5 h | Listagem autenticada funcional e falhas com resposta JSON válida |
| 5 | PostgreSQL concorrente, regressão e demonstração do objetivo | 6–9 h | Evidências de duas baixas concorrentes/idempotência; review com valores conhecidos |

Total estimativo 29–44 h, sem promessa de execução em uma sprint antes de medir disponibilidade e complexidade. Se faltar capacidade, preservar a integridade do objetivo: terminar a fatia financeira com prova e tirar itens não essenciais; não declarar “Done” sem concorrência relevante. Um problema urgente de publicação pode alterar a ordem.

O inventário ao vivo, a correção local do fallback de fornecedores e os testes de reprodução já existem. Eles são insumos concluídos; homologação/publicação continuam pendentes. Não contabilizar novamente a investigação pronta como implementação entregue.

### Próximos incrementos, em ordem de dependência

1. **Integridade de estoque/compras/venda:** EST-01, COM-01, CUS-01, VAL-01, VEN-01. Dividir por vertical de negócio e aprovar as nove provas ERP após correção.
2. **Operação B2B:** B2B-01, CRE-01, PED-01, WMS-01; demonstrar reserva/separação/expedição/entrega parcial e tratamento de falta.
3. **Documentos e tesouraria:** FIS-01, TES-01, HCM-01 conforme decisão integrar/construir; obrigações oficiais ficam no ERP/provedor vigente até homologação.
4. **Importação e CX:** IMP-01 e CX-01; construir um processo de importação de verdade e uma devolução real completa; CX-02 após dados confiáveis.
5. **Piloto e expansão:** ANA-03, CAR-01, MIG-01; OPS/SEC acompanham todos os incrementos e precisam estar prontos antes do uso real.

Esses incrementos **não equivalem a cinco sprints nem a um prazo contratado**. Uma entrega de fiscal/importação pode demandar várias sprints e calendário de parceiros. Depois de descoberta e três sprints medidas, apresentar prazo em faixas por cenário de escopo. Não prometer substituição total em 30/60/90 dias sem evidência.

## 7. Definition of Ready e Definition of Done

Uma história fica pronta para entrar na sprint quando tem regra/dono definidos, exemplo concreto, fonte de dados, dependências acessíveis, aceite verificável e tamanho dividido. Uma exigência fiscal sem cenário do cliente é discovery, não história de emissão pronta.

Uma história só fica **Done** quando:

- Aceites passaram com evidência; bugs antes reproduzidos passam sem xfail. Teste que só diz “HTTP 200” não basta para saldo/lote/CMV.
- Alterações transacionais foram testadas em PostgreSQL isolado com rollback, retries e concorrência relevantes; SQLite complementa, não certifica locks do PostgreSQL.
- Tenant, papéis, dados inválidos e estados proibidos foram verificados nos pontos alterados.
- Migração preserva dados, tem ensaio e estratégia para incompatibilidade; idempotência e observabilidade foram consideradas quando aplicáveis.
- Interface permite entender pendências e erros sem depender de log técnico. Nenhum campo ausente vira um valor monetário inventado.
- Revisão de código/diff e documentação da regra concluídas; resultados do teste registram revisão e ambiente.
- Incremento demonstrável em staging, com limitações conhecidas. Publicação é decisão separada após apresentação da mudança concreta e dos riscos.

Nenhum xfail/P0 no fluxo liberado. Exceção de escopo só permite piloto se o processo excluído estiver tecnicamente bloqueado e continuar sob fonte oficial definida; não aceitar desvio de integridade como “risco conhecido”.

## 8. Validação técnica e de negócio

**Testes por regra:** Decimal, conversão de unidade, rateios e arredondamento; valores negativos/não finitos; estados; documentação com exemplos aprovados. **Integração:** constraints/locks, entrada duplicada, idempotência, outbox, isolamento e reconciliação. **E2E:** pedido→entrega→recebimento→ocorrência, incluindo parcial, falta, cancelamento e retry. **Provedores:** contratos reais em homologação e reconciliador de estados.

Carga: construir dataset representativo e medir pela rede/TLS/Gunicorn, misturando operações e dashboard. Os benchmarks anteriores de test client não certificam a infraestrutura publicada. Metas iniciais a negociar: operações síncronas centrais p95 ≤500 ms e p99 ≤1 s no pico acordado, excluindo espera de provedor externo; relatórios pesados assíncronos com prazo explícito. Medir saturação e erros, não esconder timeout como resposta bem-sucedida. Valores são metas propostas, não resultados medidos.

Reconciliações obrigatórias: saldo físico = entradas−saídas±ajustes por lote/depósito; reserva ≤saldo elegível salvo política explícita; total do pedido = composição aprovada de itens/descontos/frete/tributos; saldo do título = obrigação ajustada−liquidações válidas; CMV = custo histórico das saídas elegíveis; rateio de importação fecha no custo aprovado. Definir separadamente efeitos comerciais, fiscais, financeiros e bancários.

## 9. Gates para liberar a empresa

| Gate | Evidência exigida | Quem decide |
|---|---|---|
| G0 — escopo | Empresa, processos, fonte oficial, volume, prazo e orçamento definidos | Você + responsável do cliente |
| G1 — integridade | Nove ERP e duas ANA aprovados; concorrência PostgreSQL; saldos reconciliados | Você com evidências técnicas |
| G2 — adequação | PF/PJ, preços/crédito, depósito/pedido, documentos e importação necessários ao piloto homologados | Você + validadores do cliente/provedores |
| G3 — operação | Backup externo/restauração, observabilidade, incidentes, acesso e carga comprovados | Você |
| G4 — migração | Dois ensaios repetíveis, divergências resolvidas, IDs/documentos preservados e cutover ensaiado | Você + financeiro/estoque do cliente |
| G5 — piloto | Período acordado sem divergência material, métricas/atendimento aceitos, saída do piloto definida | Você + direção do cliente |

Não usar média ponderada para compensar gate crítico reprovado com telas bonitas. Migração integral depende também dos processos fora do piloto, não só da aprovação do G5.

## 10. Migração e retorno

Extrair amostras e depois snapshots autorizados do ERP atual; mapear chaves/cadastros/estados/unidades/moedas; importar para staging repetidamente; comparar contagens, totais e composição. Trazer saldos iniciais e abertos, estoque/lotes/custo, pedidos/reservas, obrigações, histórico necessário, anexos e referências fiscais. Não reconstruir custo passado por preço atual sem método e aprovação.

Planejar janela, congelamento dos escritores, captura de deltas, validação de fechamento, cópia externa, ativação de integração e monitoramento. Uma mudança deve ter critério mensurável de abortar antes de liberar usuários. O retorno ao ERP anterior exige replay/reconciliação das operações feitas no novo sistema; após emissão fiscal ou liquidação externa, restaurar backup ou voltar imagem sozinho é insuficiente. Usar eventos e compensações válidas, sem perder/duplicar documento ou pagamento.

Manter ERP anterior consultável conforme contrato e política acordada. Durante coexistência, uma matriz de responsabilidade define qual sistema escreve cada processo. “Rodar os dois e depois conferir” não é plano de migração.

## 11. Riscos, custo e acompanhamento

| Risco | Tratamento e sinal de ação |
|---|---|
| Único operador | Runbook curto, restore executável, alertas acionáveis, WIP baixo, janela de suporte pactuada. Não contratar SLA incompatível com ausência de cobertura |
| Regras divergentes por canal | Serviços comuns e mesmas provas PDV/SFA/entrega; impedir releases que retornem divergência de saldo/custo |
| Dados/estatística enganosos | ANA-01/02 imediatos; métricas reconciliadas, versão/amostra e dados simulados identificados |
| Fiscal/folha/contabilidade/importação subestimados | Amostras/validação especializada; integrar soluções maduras quando adequado; não prometer módulo oficial pelo nome da tela |
| Memória/pool/host único | Benchmark e isolamento; alerta de memória/conexão; reduzir competição analytics; backup fora do host; evolução de HA conforme SLA |
| Diferença local/publicado | Revisão/digest/migrações e teste pós-release; não atribuir correção local a produção |
| Grande volume de mudanças preexistentes | Baseline e diffs pequenos; manter trabalho anterior; publicação não arrasta alterações desconhecidas |
| Dependência de APIs de IA/fornecedores | Fallback explicado, timeout, quota/custo, fila e reconciliação; funções centrais independem de texto de LLM |

Custo mensal a apurar: aplicação+banco+staging+armazenamento/backup+monitoramento+fiscal/banco/mensageria+uso de IA+suporte. Custo de implantação: horas humanas de engenharia/validação/dados, contratos, migração e acompanhamento. Uma VM barata não determina o custo total de um ERP.

Painel de entrega: itens Done, tempo de ciclo, trabalho em curso, defeitos escapados, retrabalho, P0 abertos, gates e consumo de orçamento. Painel operacional: divergências de saldo, títulos não conciliados, fila/retries, disponibilidade/latência, recuperação, ruptura e ocorrência de cliente. Painel de valor: margem com custo válido, fill rate, OTIF com promessa/data/quantidade acordadas, tempo de resolução e conversão/recompra por janela. Definir denominadores antes de publicar.

## 12. O que já foi provado e o que permanece pendente

Concluído neste trabalho: auditoria funcional local; nove falhas de negócio reproduzidas; correção local do fallback fornecedores com cinco testes; leitura da infraestrutura ativa via SSH; confirmação HTTP pública de site/health; comparação de quatro arquivos publicados; duas falhas analíticas reproduzidas, com arquivo analítico igual ao publicado; plano/backlog/arquitetura/aceites documentados.

Não certificado: todos os fluxos visuais/autenticados em produção, causa principal da consulta fornecedores, carga do cliente, sucesso/restauração do backup mais recente, fiscal real, folha oficial, contabilidade oficial, integração de comércio exterior e migração real. Auditoria minuciosa significa explicitar evidências e lacunas; não declarar certeza onde falta verificação.

Próxima execução recomendada: FUN-01 → ANA-01/02 → FIN-01, mantendo o incidente fornecedores no caminho de estabilização e preparando cada release para revisão. O plano é entregável de planejamento; as correções futuras do backlog ainda não foram implementadas nem publicadas.

Referências técnicas: [Scrum Guide](https://scrumguides.org/scrum-guide.html), [validação de previsões por origem móvel](https://otexts.com/fpp3/tscv.html), [intervalos de previsão](https://otexts.com/fpp3/prediction-intervals.html), [backup/PITR PostgreSQL 15](https://www.postgresql.org/docs/15/continuous-archiving.html). Detalhes normativos do cliente serão validados nas fontes oficiais e nos contratos de integração durante a descoberta; este documento não presume uma matriz tributária universal.
