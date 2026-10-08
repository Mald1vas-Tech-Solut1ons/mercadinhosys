# Parecer do CEO — migrar a distribuidora/importadora para o MercadinhoSys

Data: 08/10/2026. Perspectiva: direção de uma distribuidora/importadora com vários tipos de produtos, hoje atendida por um ERP de mercado (SAP, TOTVS ou similar). Complementa a [auditoria de 07/10](AUDITORIA_MIGRACAO_ERP_DISTRIBUIDORA_2026-10-07.md) e o [registro de execução](EXECUCAO_SPRINTS_DISTRIBUIDORA.md).

## Decisão

**Migrar a operação comercial (compra, estoque, venda, força de vendas, entrega e financeiro operacional): viável como piloto, hoje.** **Substituir o ERP inteiro: ainda não.** O sistema não tem contabilidade, NF-e de saída, depósitos, devolução, atendimento pós-venda nem importação. Esses blocos continuam no ERP atual até serem construídos e provados.

O que mudou desde o parecer anterior: a principal razão de não migrar era dinheiro e estoque divergirem conforme o canal de venda. Isso foi corrigido e está provado por testes (ver abaixo). Não é mais a razão de bloqueio.

## Como verifiquei

Leitura do código e execução de testes locais (SQLite) e do CI com PostgreSQL 15 real; busca por capacidades no backend (`models`, `routes`, `services`). "Não existe" significa ausência nessas buscas, não prova de que nenhuma integração externa exista. Não houve teste de carga, dados reais da empresa nem homologação fiscal.

## Pilar por pilar

### ERP — o caixa e o cérebro financeiro

| Área | Funciona hoje (verificado) | Falta | Veredito |
|---|---|---|---|
| Venda → estoque → custo | PDV, venda direta, força de vendas e entrega baixam o mesmo saldo e o mesmo lote; custo do momento fica no item; cancelamento devolve exatamente o que saiu | Reserva de estoque para pedido futuro | **Pronto para piloto** |
| Compras | Recebimento em várias cargas; falta e avaria reduzem o boleto; frete e bonificação entram no custo; fração (kg) preservada | Vínculo da nota XML com o pedido (hoje as duas entradas podem duplicar estoque e título) | **Pronto, com a ressalva do XML** |
| Contas a pagar/receber | Baixa parcial e sucessiva; valor inválido recusado; repetição e concorrência protegidas em PostgreSQL | Conciliação com banco e adquirente | Parcial |
| Fiscal | Importa XML de entrada (modelo 55); emite NFC-e (modelo 65) por gateway | **NF-e de saída modelo 55**, eventos, matriz tributária por operação | **Bloqueia distribuição B2B** |
| Contabilidade | DRE e fluxo de caixa gerenciais | Plano de contas, centro de custo, livro, fechamento de período: **não existem** | **Bloqueia substituição total** |

### HCM — pessoas

Funciona: cadastro, ponto, justificativas, banco de horas, benefícios, holerite, rescisão, provisões.
Falta: as faixas de INSS e IRRF padrão do código são as de 2024 (comentário no `models.py` diz "2024/2025"); são editáveis por loja, mas ninguém garante que estejam atualizadas, e a regra de 2026 citada no parecer anterior não está implementada. Não há fechamento imutável da folha nem eventos do eSocial.
Veredito: **apoio operacional**. Folha oficial continua no sistema de folha atual ou em um provedor.

### SCM — logística e estoque

Funciona: fornecedores, pedido de compra, recebimento, lotes com validade (FEFO), custo médio, giro e curva ABC, entregas, frota, motoristas.
Falta, com busca confirmando ausência: **depósitos/endereços, transferência entre filiais, inventário com contagem, reserva, backorder, devolução parcial ao fornecedor** (só existe devolução total do pedido).
Veredito: **serve uma operação de um depósito**. Distribuidora com mais de um depósito ainda não.

### CX — experiência do cliente (foco principal)

| Frente | Funciona hoje | Falta | Veredito |
|---|---|---|---|
| **Marketing** | Segmentação RFM, histórico de compras, mensagem sugerida por IA, abertura do WhatsApp | Campanha enviada, entregue, respondida e medida; preferência de contato; o envio hoje é manual | Bom começo, só assistido |
| **Vendas** | Força de vendas offline, tabela de preço por cliente, preço mínimo, rota, meta, aprovação do gerente, limite de crédito, pedido que baixa estoque e gera título | **Cliente PJ (CNPJ, razão social, IE)**: o cadastro só aceita CPF; comissão de vendedor (só existe para motorista); promessa de disponibilidade e prazo; alçada de desconto por perfil no pedido B2B (o PDV tem; a força de vendas só tem o preço mínimo) | **Parcial; CNPJ é o primeiro bloqueio** |
| **Service** | Rastreamento de entrega e cancelamento de venda | **Chamado, devolução parcial, troca, garantia, reembolso, SLA**: não existem | **Ausente** |

Hoje o sistema vende bem, mas não atende o cliente depois da venda. Para um distribuidor, o atendimento pós-venda (reclamação de avaria, devolução, troca) é parte do contrato com o cliente.

### Comércio exterior

Não existe: invoice, moeda e câmbio, embarque, desembaraço, custo de nacionalização. Importar um XML nacional não é gerir uma importação. **Ausente.**

## O que foi provado e o que não foi

Provado (CI PostgreSQL e testes locais): integridade de estoque, custo, lote e dinheiro entre canais; recebimento parcial; baixas financeiras; isolamento entre lojas; resposta válida da listagem de fornecedores.
Não provado: carga de um distribuidor real; fiscal real; recuperação de desastre (backup fica na mesma VM); folha oficial; qualquer processo listado como ausente.

## Roteiro para migrar, por prioridade

| # | Entrega | Por quê nesta ordem | Aceite |
|---|---|---|---|
| 1 | **Cliente PJ** (CNPJ, razão social, IE, contato, endereços de cobrança e entrega) | Sem CNPJ a distribuidora não cadastra os próprios clientes; destrava crédito e NF-e | Empresa cadastrada por CNPJ; clientes antigos preservados; busca e PDV mostram o documento certo |
| 2 | **Pós-venda**: chamado, devolução parcial com lote, troca e reembolso | É o foco de CX e hoje não existe | Reclamação por avaria resolvida com efeito correto em estoque, financeiro e cliente |
| 3 | **Pedido B2B**: reserva, separação, expedição, entrega parcial, comissão de vendedor | Hoje a aprovação já vira venda, sem disponibilidade prometida | Duas vendedoras disputando a última unidade: só uma é atendida |
| 4 | **NF-e de saída (modelo 55)** com o gateway fiscal | Necessária para vender a empresas; depende do cadastro PJ | Nota autorizada em homologação com a matriz tributária do cliente |
| 5 | **Depósitos, transferência e inventário** | Só importa com mais de um depósito | Transferência e contagem reconciliam saldo por lote |
| 6 | **Conciliação, plano de contas, importação, backup externo** | Substituição total e continuidade | Fechamento mensal reconciliado; restauração ensaiada |

## Recomendação comercial

Vender agora como **complemento** ao ERP que o cliente já tem: força de vendas, pedidos, estoque e CRM, com o fiscal e a contabilidade ficando no sistema atual. A substituição total vem depois de 1 a 4 provados com dados reais do cliente.
