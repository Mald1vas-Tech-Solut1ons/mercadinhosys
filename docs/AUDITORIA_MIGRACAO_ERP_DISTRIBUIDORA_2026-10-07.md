# Parecer de migração ERP — distribuidora/importadora

Data: 07/10/2026. Sistema avaliado: MercadinhoSys, estado local do workspace, incluindo alterações ainda não commitadas. Perspectiva: direção de uma distribuidora/importadora com vários tipos de produtos, canais de venda e funcionários.

Complemento posterior no mesmo dia: [plano CTO/Scrum para um responsável humano com IA](PLANO_CTO_SCRUM_DISTRIBUIDORA_2026-10-07.md) e [evidências ao vivo de infraestrutura e motores matemáticos](ANEXO_CTO_INFRA_E_MATEMATICA_2026-10-07.md). O complemento confirma Oracle/Vercel, compara arquivos publicados e reproduz mais duas falhas analíticas; não certifica toda a operação publicada nem substitui os limites dos testes descritos abaixo.

## Decisão executiva

**Não aprovar a substituição integral do ERP atual neste estado.** Existe uma base aproveitável de gestão comercial de varejo, com PDV, compras, lotes, financeiro gerencial, RH, CRM analítico e entrega. A cobertura de telas é ampla, mas a consistência entre os canais e a cobertura dos processos de distribuição/importação ainda não sustentam a migração da operação central.

Consideraria um piloto delimitado após corrigir os bloqueios transacionais, mantendo o ERP atual como responsável pelos processos ainda não cobertos. Qualquer coexistência exige definir qual sistema é a fonte oficial de cada cadastro, saldo e documento, além de integração e reconciliação; usar dois sistemas sem essas regras aumenta o risco.

O problema principal é que uma operação equivalente segue regras diferentes no PDV, SFA e entrega. Para um CEO, isso significa risco de prometer mercadoria indisponível, cobrar valores incompatíveis, perder rastreabilidade e tomar decisões com margem incorreta. CX depende da confiabilidade desses processos.

## Método e limites

- Leitura dos modelos, rotas, serviços, navegação frontend, testes e documentação de infraestrutura. Fluxos examinados: cadastro → compras → entrada → estoque/custo → venda PDV/SFA/entrega → recebíveis/pagáveis → cancelamento → indicadores; RH, CRM e operação SaaS também foram examinados.
- Testes locais com Flask test client e SQLite em memória, sob as fixtures existentes. Nenhum banco publicado foi alterado. Nenhuma emissão fiscal real ou mensagem para cliente foi realizada.
- 110 casos existentes terminaram aprovados: 108 na primeira execução e dois de documentos privados na repetição, após erro ambiental de criação da pasta temporária. Não é execução da suíte inteira.
- Nove provas novas de aceitação falharam nas regras esperadas e confirmaram defeitos. Foram mantidas como `xfail(strict=True, raises=AssertionError)`; isso registra dívida conhecida, não aprovação da migração. A execução com `--runxfail` mostra as nove falhas explicitamente.
- Concorrência do SFA, recebimentos e baixas financeiras não foi reproduzida em PostgreSQL neste ciclo. Os riscos correspondentes são identificados pela leitura do código e precisam de testes no banco de produção em ambiente isolado.
- Navegação foi inspecionada no código; não houve uma nova homologação visual de todas as telas. Produção, volume real, integrações empresariais e configuração fiscal do cliente não foram certificados.
- “Não identificado” significa ausência de implementação nos arquivos examinados e nas buscas realizadas, e não prova absoluta de inexistência de integração externa.

## Cobertura dos quatro pilares

| Pilar | Base existente | Lacuna para esta empresa | Parecer |
|---|---|---|---|
| ERP financeiro | Caixa, múltiplos pagamentos, contas a pagar/receber, despesas, visão gerencial de DRE e fluxo de caixa | Baixas parciais confiáveis, conciliação bancária/adquirentes, livro contábil, plano de contas estruturado, centros de custo e fechamento de períodos não foram identificados como ciclo completo | Parcial; bloquear migração do financeiro |
| ERP fiscal | Importação de XML de entrada, cadastro fiscal de produto, NFC-e por gateway, bloqueio de gateway simulado em produção | Emissão implementada é modelo 65; fluxo de saída modelo 55 para distribuição, eventos e matriz tributária por operação não foram identificados completos | Insuficiente para o escopo proposto |
| HCM | Funcionários, permissões, ponto, justificativas, benefícios, banco de horas, holerite, rescisão e provisões | Regras vigentes, competência/versionamento da folha, fechamento, dependentes, eventos governamentais e ciclo de recrutamento/carreira não estão cobertos integralmente | Apoio operacional; não homologado como folha oficial |
| SCM | Compras, fornecedores, recebimento, lotes/validade, custo médio, giro/ABC, entregas e frota | Recebimento parcial correto, reserva, múltiplos depósitos/endereço, inventário com aprovação, separação/conferência, transferências e rastreabilidade uniforme | Parcial; bloqueios confirmados |
| Comércio exterior | XML de nota nacional e atributos/cadastro fiscal | Processo de importação de mercadoria, moeda/câmbio, custos de nacionalização, embarque, desembaraço e ligação documental não foram identificados | Não demonstrado |
| CX — Marketing | RFM, segmentação, histórico de compras, mensagens assistidas por IA, ações WhatsApp | Execução/rastreio de campanhas, preferências de contato, atribuição de conversão e histórico de interações | Bom ponto de partida, predominantemente assistido/manual |
| CX — Vendas | PDV, força de vendas offline, tabelas de preço, rotas/metas e aprovação | Cadastro empresarial, cálculo centralizado, alçada de desconto, crédito uniforme, disponibilidade prometida e jornada de pedido completa | Parcial; bloqueios confirmados |
| CX — Service | Rastreamento de entrega, histórico, cancelamento integral | Chamados, SLA por ocorrência, devolução parcial, garantia, troca, reembolso e comunicação de resolução vinculados à venda/lote | Ciclo de pós-venda incompleto |

**Esclarecimento:** importar um arquivo XML não equivale a gerir uma importação internacional. Da mesma forma, um dashboard de DRE não comprova escrituração contábil, e segmentar clientes por RFM não implementa sozinho um programa de fidelidade.

## Defeitos confirmados por execução

Todos os casos abaixo são reproduzíveis em `backend/tests/test_erp_migration_audit.py`. Prioridade P0: impede migração pela integridade do dinheiro/estoque. P1: corrigir e homologar antes de utilizar o processo afetado.

| ID / prioridade | Exemplo observado | Impacto e regra necessária | Evidência |
|---|---|---|---|
| ERP-01 / P0 | Pedido de 10 unidades; recebe 3; pedido vira `recebido` | Saldo de 7 não pode ser recebido pelo mesmo fluxo, que aceita apenas `pendente`. Registrar recebimentos acumulativos, pendências e conclusão calculada por item | `routes/pedidos_compra.py:319`, `:338`, `:438` |
| ERP-02 / P0 | Título de R$40; baixa R$10; tentativa de R$30 retorna 400 “Boleto já foi pago” | Status `parcial` é produzido, mas recusado na próxima baixa. Aceitar saldo residual, acumular pagamentos e manter histórico individual | `routes/pedidos_compra.py:717–728` |
| ERP-03 / P0 | Pagamento de -R$10 é aceito com HTTP 200 | Saldo pode aumentar e despesa negativa ser criada. Exigir valor finito, positivo, dentro do saldo e da política de juros/descontos; transação com lock e idempotência | `routes/pedidos_compra.py:720–745` |
| ERP-04 / P0 | SFA aceita duas unidades de R$10, item R$20 e pedido total R$1 | Fatura/recebível usam total divergente dos itens. Recalcular no servidor; validar tabela vigente, preço mínimo, desconto e alçada | `routes/sfa.py:348–387` |
| ERP-05 / P0 | Entrega vende duas unidades; saldo permanece 10, deveria ser 8 | Rota tenta alterar `estoque_atual`, atributo inexistente no modelo de Produto. Usar a mesma baixa transacional de estoque/lotes e ledger de todos os canais | `routes/delivery.py:620–703` |
| ERP-06 / P0 | SFA fatura duas unidades: Produto cai a 8, lote fica em 10 | Agregado e rastreabilidade divergem; cancelamento não tem consumo do lote para reverter. Centralizar consumo e registrar vínculos dos lotes consumidos | `routes/sfa.py:490`, `services/venda_service.py:149` |
| ERP-07 / P1 | Saldo 1,5 a R$10 + entrada 0,5 a R$20 mantém custo R$10; deveria dar R$12,50 | `int()` descarta frações no custo médio. Preservar Decimal em quantidades e custos do começo ao fim | `models.py:1136–1150`; XML também passa `int(qtd)` |
| ERP-08 / P1 | Lote vencido ontem aparece entre lotes disponíveis para consumo | Para produtos com validade controlada, definir bloqueio/quarentena e autorização conforme política do segmento. O algoritmo atual prioriza validade, mas não exclui vencidos | `models.py:1302` |
| ERP-09 / P0 | Venda PDV de duas unidades a R$10, custo R$4; `VendaItem.custo_unitario` fica `None` | Agregações que usam custo histórico podem subestimar CMV e inflar lucro. Persistir custo da saída em cada item; reconciliar dados legados sem inventar custo histórico | `routes/pdv.py:996`; `dashboard_cientifico/data_layer.py:149–161`, `:699` |

O nome `consumir_estoque_fifo` é impreciso: a seleção ordena por validade, aproximando FEFO. Isso é útil para perecíveis, mas precisa de exclusão/quarentena de vencidos e de regras explícitas para produtos sem validade.

## Outros bloqueios encontrados na leitura

### Distribuição B2B e experiência comercial

O modelo Cliente exige CPF e o cadastro valida exatamente 11 dígitos. Não há campos próprios de pessoa jurídica, CNPJ, razão social ou inscrição estadual no modelo examinado (`models.py:819`; `routes/clientes.py:38–55`). Cadastrar uma empresa usando CPF de um contato compromete identidade comercial, cobrança e faturamento.

Exigir cadastro PF/PJ, múltiplos contatos e endereços, faturamento/entrega separados, vendedor/carteira, regras de crédito e condição de pagamento estruturada. As tabelas de preço já existem e podem ser reaproveitadas, mas a validação de preço deve ocorrer também no servidor do SFA.

No SFA, a aprovação transforma diretamente o pedido em venda finalizada. Não foi identificado ciclo completo de reserva → separação → conferência → expedição → entrega parcial. Isso impede promessas confiáveis de disponibilidade e prazo, essenciais ao CX de uma distribuidora.

### Compras, conferência e custo

O recebimento calcula obrigação como `preco_unitario × quantidade_recebida`, ignorando na recomposição os descontos e frete presentes no pedido (`pedidos_compra.py:434–450`). Uma compra de R$100 com R$10 de desconto e R$20 de frete totaliza R$110 na emissão, mas o recebimento pode sobrescrever o título por R$100. É exemplo deduzido do código, ainda sem teste adicional neste ciclo.

Além disso, o custo ponderado é chamado com o preço bruto do item e a quantidade que inclui bonificações. É necessário definir rateio documentado de desconto, frete, bonificações, avarias e demais componentes de custo, distinguindo valores a pagar de valor incorporado ao estoque.

A entrada via XML cria estoque e contas a pagar sem vincular a nota ao pedido/recebimento (`services/fiscal/entrada_service.py:140–271`). Executar os dois caminhos para a mesma compra pode duplicar estoque e obrigação; a chave única do XML impede repetição daquele XML, mas não liga documentos de origem distintos. Implementar conferência pedido × recebimento × documento do fornecedor com tolerâncias e tratamento de divergência.

Quando não há validade informada, o recebimento inventa um ano de validade (`pedidos_compra.py:397`). Usar “não aplicável” ou “pendente de conferência”, conforme produto; nunca fabricar uma validade operacional.

### Financeiro, custo histórico e governança

O sistema já possui cálculos gerenciais por competência/caixa e medidas para evitar dupla contagem de certas despesas. São recursos aproveitáveis. Falta demonstrar conciliação de títulos e liquidações com banco/adquirentes, tratamento de taxas, juros, chargeback, renegociação, crédito e estorno de valores efetivamente recebidos.

Há uso de float em saldos financeiros no SFA e recebimento de fiado; a consistência deve usar Decimal e arredondamento por regra explícita. O recebimento de fiado lê/atualiza cliente, contas e caixa sem os locks do checkout (`routes/clientes.py:1200–1350`): risco de corrida ainda a reproduzir em PostgreSQL.

O cancelamento comercial e o cancelamento fiscal são operações separadas (`routes/vendas.py:1193`; `services/fiscal/emissao_service.py:252`). Precisa existir uma orquestração que mantenha o estado correto de estoque, recebível, pagamento, documento fiscal e devolução. Um pagamento marcado `estornado` internamente não demonstra reembolso no provedor.

### Fiscal

O emissor efetivo monta modelo 65 e usa endpoint `/v2/nfce`; o comentário genérico “NFC-e/NF-e” do gateway não demonstra emissão de modelo 55. Os códigos PIS/COFINS do payload são fixados em `49`, e a operação usa parâmetros gerais do produto (`emissao_service.py:117–174`). Para distribuição/importação, homologar matriz por operação, produto, origem/destino e regime, com assessoria fiscal e gateway adequado.

O gateway tem método `consultar`, mas no fluxo examinado não foi identificado reconciliador que atualize o documento persistido após resposta `processando`; repetir emissão retorna o registro existente (`:188`). A numeração é lida do estabelecimento sem reserva/lock e avançada apenas ao autorizar (`:192`, `:246`). Reconciliar estado externo, reservar numeração e testar autorização tardia, timeout, retentativa e concorrência.

O bloqueio explícito de gateway simulado em produção e a validação de cadastro fiscal são pontos positivos. Eles não substituem homologação das operações reais da empresa.

### HCM

Há bom material para gestão operacional de pessoas, mas a folha não pode ser homologada apenas porque o holerite é gerado. Os defaults de IRRF em `models.py:753` divergem da tabela oficial de 2026, e `calcular_irrf`/holerite não contemplam a redução mensal de 2026 nem dependentes (`rh_calculator_service.py:69`, `:269`). As faixas são editáveis, mas editar faixas não implementa a redução em função do rendimento tributável.

A Receita Federal publica para 2026 tabela mensal e redução que pode zerar o imposto até R$5.000 e decresce até R$7.350. Fonte consultada em 07/10/2026: [Tributação de 2026 — Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026).

Exigir parametrização por vigência/competência, regras de rubrica, memória de cálculo, fechamento imutável e revisão dos casos por especialista de folha. Integração com sistema HCM existente é uma opção; reconstruir todos os subsistemas não é condição necessária se uma integração confiável cobre o processo.

### Comércio exterior

Não foi identificado processo de compra em moeda estrangeira com invoice, embarque, custos de nacionalização, documentos aduaneiros e rastreabilidade até lote e obrigação financeira. O Portal Único/Siscomex possui processos de importação e tratamento administrativo conforme operação/produto; decidir integração direta ou cobertura por solução especializada. Fonte: [Tratamento Administrativo na Importação — Siscomex](https://www.gov.br/siscomex/pt-br/informacoes/tratamento-administrativos/tratamento-administrativo-na-importacao).

O requisito de negócio é rastrear invoice/moeda → embarque → despesas → desembaraço → custo final por SKU/lote → financeiro/contabilidade. A implantação exata depende do mix, modalidade e regimes da empresa; não foi feito enquadramento tributário neste parecer.

### CX, com prioridade ao pós-venda

O CRM possui RFM, carteira, históricos, geração de texto e ações WhatsApp. Em `CustomersPage.tsx:887–916`, a ação copia texto ou abre WhatsApp; copiar um lote de mensagens é assistência ao operador, não prova de campanha enviada, entregue, respondida ou convertida. Não foi identificado histórico estruturado de conversas/campanhas atrelado à venda.

O processo de entrega aceita o novo status diretamente (`delivery.py:556`), sem uma máquina de estados visível, e repetir `entregue` pode incrementar estatísticas novamente. O caixa do fluxo unificado pode receber o total da venda quando há qualquer pagamento dinheiro/Pix, independentemente da composição (`:747–761`); por leitura, venda R$50 com R$20 dinheiro + R$30 cartão pode somar R$50 à gaveta se houver caixa aberto. Precisa de reprodução e correção antes do piloto.

Para Service, exigir ocorrência vinculada a cliente/pedido/item/lote, responsável, prazo, anexos, motivo, troca/devolução parcial, reembolso/nota correspondente e confirmação de solução. Medir tempo de resolução, reincidência e satisfação depois de resolver. Um cadastro de cliente e um botão de cancelamento integral não cobrem esse ciclo.

### Operação, continuidade e migração de dados

Há isolamento por estabelecimento, RBAC, auditoria, migrações, scripts de backup e documentação de um restore anterior. Isso merece ser preservado. A arquitetura multi-tenant não demonstra, por si, consolidação contábil e operações entre filiais de um mesmo grupo.

`infra/oracle/DEMO.md:108–110` registra backups na mesma VM e cobertura apenas de banco. A inspeção do script de verificação mostra restore e comparação de quantidade de vendas; é evidência útil, mas insuficiente para certificar recuperação empresarial. Exigir cópia externa, arquivos/certificados, monitoramento de backup, reconciliação de saldos após restore e RPO/RTO aprovados. Não foi verificada a execução atual do timer neste ciclo.

Importadores CSV/XLSX/XML são base para migração de cadastros; não foi identificado pacote integral de saldos iniciais, títulos abertos, estoque por lote/depósito, vínculos de documentos e histórico com validação e reconciliação de origem. Volumes, integrações e desempenho devem ser medidos com o tamanho real da distribuidora. Benchmarks/documentos anteriores não certificam esses fluxos.

## Sequência de evolução recomendada

| Etapa | Entrega concreta | Critério de conclusão |
|---|---|---|
| 1 — Integridade | Serviço transacional comum para PDV/SFA/entrega; custo histórico; lotes; pagamentos e recebimentos parciais; valores finitos; idempotência | Nove provas passam sem xfail; cenários de troco/múltiplos pagamentos/estorno reconciliam; concorrência validada em PostgreSQL |
| 2 — Distribuição | Cadastro PF/PJ, preço/alçada, crédito, reserva, depósitos, conversão caixa/unidade/kg, recebimento acumulativo e conferência de nota | Executar compra/venda parcial e impedir estoque/título duplicado pelos diferentes canais |
| 3 — CX completo | Promessa de disponibilidade/prazo; acompanhamento; contatos/campanhas; chamados, troca, devolução e reembolso | Uma reclamação pode ser acompanhada e resolvida com todos os efeitos financeiro/fiscal/estoque rastreáveis |
| 4 — Fiscal, financeiro e HCM | Emissão compatível com operações da empresa, reconciliação bancária, contabilidade ou integração, folha vigente ou integração | Conferência com ERP atual e especialistas, fechamentos por competência e exceções testadas |
| 5 — Importação e corte | Comércio exterior próprio/integrado, ensaios de migração, backup externo e retorno operacional | Saldos/documentos reconciliados e plano de corte/retorno ensaiado e aprovado |

As etapas representam dependências, não estimativa de prazo. Estimar depois de conhecer volumes, filiais, mix, integrações e escopo coberto por terceiros. CX pode evoluir em paralelo ao núcleo, mas só deve prometer o que estoque e financeiro garantem.

## Provas exigidas para autorizar a migração

1. Comprar 100 unidades, receber 60 e depois 40, com avaria/bonificação e dois documentos: saldo, custo e títulos corretos, sem duplicidade por XML.
2. Comprar/vender por caixa e unidade, kg fracionário, produto sem validade e produto perecível: conversões e custo preservados; vencido segregado.
3. Dois vendedores disputarem a última unidade e o mesmo limite de crédito: apenas operações cobertas por disponibilidade e crédito são aprovadas; repetir UUID não duplica a operação.
4. Pedido SFA com tabela/desconto/prazo → reserva → separação → entrega parcial → faturamento/recebível: totais e estados reconciliados.
5. Pagamento misto com troco, Pix/cartão, taxas e recebimento de título em várias datas: gaveta, banco, títulos e indicadores conciliam.
6. Documento fiscal com resposta tardia/rejeição/timeout e cancelamento comercial: nenhuma autorização ou numeração perdida/duplicada; regras tributárias homologadas por operação.
7. Reclamação por produto avariado: devolver parte da compra, identificar lote, trocar ou reembolsar, ajustar estoque/financeiro/fiscal e encerrar ocorrência com comunicação ao cliente.
8. Folha de duas competências com faixas diferentes, dependentes, faltas, extras e rescisão: memória e valores conferidos, sem recalcular silenciosamente folha fechada.
9. Uma importação representativa: custos documentados até SKU/lote e câmbio/obrigações reconciliados com a solução de origem.
10. Ensaio completo de migração: quantidade/custo por depósito/lote, pagar/receber por documento, caixa/bancos e amostra de histórico conciliados. Tolerâncias de arredondamento aprovadas; nenhuma divergência sem explicação.
11. Recuperar backup externo em ambiente isolado, validar documentos/arquivos e reconciliar os saldos. Operadores exercitam corte e retorno dentro das metas aprovadas.

O piloto só recebe processos aprovados nessas provas. A retirada do ERP anterior exige os ciclos críticos cobertos e ao menos um fechamento completo reconciliado conforme o período operacional definido pela empresa.

## Artefatos e rastreabilidade

- Testes de aceitação novos: `backend/tests/test_erp_migration_audit.py`.
- Suíte existente: `scratch/auditoria-erp-testes.log`.
- Repetição dos dois testes ambientais: `scratch/auditoria-erp-documentos.log`.
- Falhas explícitas das nove regras: `scratch/auditoria-erp-falhas-confirmadas.log`.
- Execução final das nove provas como xfail: `scratch/auditoria-erp-reproducoes.log`.

Referências de mercado e legislação não foram usadas para afirmar paridade com uma versão/licença específica de SAP ou TOTVS. Como referência conceitual, a documentação SAP conecta movimentação física e atualização de valores financeiros: [Inventory Management — SAP Help](https://help.sap.com/docs/SAP_ERP/75c4b203fca64320b998cc04e2eb1468/2bdcc4530b29b44ce10000000a174cb4.html). A decisão deste parecer decorre principalmente do código e das reproduções locais.

## Correção adicional solicitada durante a auditoria: fornecedores

O usuário apresentou um erro do endpoint publicado `/api/fornecedores/`: a view retornava `None`. Na leitura foi confirmado que o código da consulta alternativa estava indentado dentro do primeiro `except` interno. Quando a consulta principal falhava e a preparação do fallback funcionava, nenhum retorno era executado.

Corrigido localmente em `backend/app/routes/fornecedores.py`: rollback antes da segunda consulta, projeção mínima dos campos, preservação de busca/status/classificação e escopo de estabelecimento, exclusão lógica, paginação limitada no fallback e resposta JSON 500 caso a alternativa também falhe. Logs agora guardam o traceback da exceção original para investigar o motivo que ativou o fallback.

`backend/tests/test_fornecedores_listing_response.py` cobre resposta normal, falha induzida da consulta principal, filtros/exclusão lógica, falha das duas consultas e isolamento entre lojas. Uma rodada com os primeiros quatro casos mais compras e isolamento aprovou 25 testes; a rodada final dos cinco casos de fornecedores é registrada em `scratch/fornecedores-regressao-final.log`.

A correção elimina o caminho sem retorno. Não foi determinado neste ciclo qual erro original de consulta/serialização ocorre no servidor publicado; o traceback apresentado mostra o efeito secundário. A correção não foi publicada, nem foi alterado o banco remoto. Os nove bloqueios de negócio do parecer permanecem registrados e sem correção funcional.
