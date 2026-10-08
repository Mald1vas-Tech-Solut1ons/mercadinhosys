# Análise do CEO — migrar a distribuidora/importadora para o MercadinhoSys

Data: 08/10/2026. Perspectiva: direção de uma distribuidora/importadora com vários tipos de produtos, hoje num ERP de mercado (SAP, TOTVS ou similar), analisando o sistema de ponta a ponta pelos quatro pilares: **ERP** (caixa e cérebro financeiro), **HCM** (pessoas), **SCM** (logística e estoque) e **CX** (marketing, vendas e service), com peso maior em CX.

## Como foi feita

Leitura do código: modelos (67 classes), rotas (37 módulos; `produtos.py` tem 5.195 linhas), serviços de RH, fiscal, RFM e financeiro, camada de dados do dashboard e as telas de clientes, SFA e recebimento. Cada achado abaixo diz se foi **reproduzido** (rodei o cenário) ou **lido** (visto no código, não executado). Não houve teste de carga, dados reais da empresa nem homologação fiscal.

## Veredito

**Operação comercial (compra, estoque, venda, força de vendas, entrega): viável como piloto agora**, depois das correções de 08/10 (estoque, lote, custo e dinheiro iguais em todos os canais). **Substituir o ERP inteiro: não.** E há um bloqueio anterior ao piloto: **hoje o cliente não consegue trazer a própria base**, porque a importação de clientes falha em 100% das linhas e o cadastro só aceita CPF.

## ERP

| Área | Situação | Evidência |
|---|---|---|
| Venda → estoque → custo | **Pronto.** PDV, venda direta, SFA e entrega baixam o mesmo saldo e lote e gravam custo | `services/estoque_service.py`; 35 testes |
| Compras | **Pronto, com ressalvas.** Recebimento em cargas, falta/avaria/bonificação/frete. Falta vincular o XML ao pedido e devolução parcial ao fornecedor (só existe devolução total, `pedidos_compra.py:581`) | testes |
| CMV | **Três fórmulas diferentes.** Duas consultas somam `custo_unitario × qtd` sem tratar custo vazio (a venda some do CMV e o lucro infla): `data_layer.py:152`, `:699`. O DRE usa `COALESCE` com o custo **atual** do produto, que reescreve o passado: `:1770` | lido |
| DRE | Só receita − CMV − despesas = "lucro líquido" (`despesas.py:1174`). **Sem impostos sobre venda, sem devoluções, sem receita líquida** | lido |
| Fluxo de caixa | A "entrada esperada" é a venda média diária × 7 (`despesas.py:1124`). Para venda a prazo (30/60 dias) isso está errado; **não existe fluxo projetado com contas a receber nem aging** | lido |
| Contas a receber | Baixa por título só pelo fiado, em `float`, sem juros, multa ou desconto; todo recebimento vira "suprimento" do caixa do operador (`clientes.py:1198`). Sem baixa por boleto, Pix ou conciliação bancária | lido |
| Fiscal | NFC-e modelo 65 fixo, "Venda ao consumidor", PIS/COFINS `49` fixos, **sem destinatário** (não sai CPF/CNPJ do cliente), data com `-03:00` fixo (Manaus é -04:00), numeração lida sem trava (`emissao_service.py:143,161,166,192,246`). XML de entrada (modelo 55) funciona. **NF-e de saída não existe** | lido |
| Contabilidade | Plano de contas, centro de custo, livro e fechamento de período: **não existem** (busca no código sem resultado) | lido |

## HCM

Funciona: ponto com foto, justificativas com aprovação, banco de horas, benefícios, holerite com memória de cálculo, rescisão (simular, gerar, cancelar), provisões trabalhistas.

| Problema | Evidência |
|---|---|
| **Dois INSS no mesmo módulo.** O holerite usa a tabela padrão de **2024** (`models.py:747`, IRRF em `:753`); a rescisão usa outra tabela, fixa e em `float`, com valores de **2025** (`rh_calculator_service.py:359`). Não reverifiquei as tabelas oficiais de 2026 | lido |
| IRRF sem dependentes ("dependentes: 0, não rastreado ainda", `rh_calculator_service.py:269`) | lido |
| Vale-transporte desconta 6% do salário sem limitar ao valor do benefício (`:282`) | lido |
| **A "vida do funcionário" do prompt está pela metade.** Existe do cadastro à rescisão, mas **não existem**: contratação e admissão (documentos, exame), férias (programação, aviso, pagamento), plano de carreira e cargos e salários, avaliação de desempenho, treinamento, fechamento imutável de folha e eSocial | busca sem resultado |
| **Rota de teste em produção** que permite ao administrador apagar os registros de ponto do dia, com as fotos (`ponto.py:1075`); o próprio comentário diz que deveria ser removida | lido |

Veredito: **apoio operacional**. A folha oficial continua no sistema de folha atual.

## SCM

Funciona: fornecedor, pedido, recebimento, lote com validade (FEFO), custo médio, giro, curva ABC, entregas, frota e motoristas, catálogo de produtos por EAN.

| Problema | Evidência |
|---|---|
| **Uma unidade e um código de barras por produto.** Sem fator de conversão caixa × unidade, sem EAN de embalagem (`models.py:1056,1064`) | lido |
| Sem depósitos, transferência entre filiais, inventário por contagem, reserva e backorder | busca sem resultado |
| Ajuste manual de estoque exige só um motivo; sem aprovação em dupla nem trilha de contagem (`produtos.py:2229`) | lido |
| Nota do fornecedor: parte de 80 pontos, e **um único pedido no prazo já a mantém em 80 e chega a ~95 com prazo de 30 dias e 5% de desconto**, sem significado estatístico; é gravada dentro de um GET (`fornecedores.py:1604`). Ignora falta e avaria, que agora estão registradas | lido |
| Status de entrega aceita qualquer valor; combustível a R$ 5,80 fixo | lido |
| **Fabricação: não existe** (sem ficha técnica/lista de materiais, ordem de produção, kit ou fracionamento; "kit" é só um rótulo de unidade). Uma distribuidora que monta kits ou fraciona granel não tem como baixar os insumos e dar entrada no produto final | busca sem resultado |

Veredito: **serve a operação de um depósito**; multi-depósito ainda não.

## CX — marketing, vendas e service

### Marketing

- **Quatro classificações de cliente diferentes**: `rfm_service.py` (Campeões, Leais, …), `Cliente.calcular_rfm` (VIP, Premium, Final de Semana, Caçador de Promoções, …, `models.py:862`), `analise_rfm_clientes` (`relatorios.py:120`) e a classificação por valor gasto (`clientes.py:128`, faixas fixas de R$ 1.000, 5.000 e 10.000). As faixas do RFM são de varejo (R$ 50, 200, 500, 1.000).
- **"Atrair o cliente" não tem ferramenta:** não existe portal ou catálogo online para o cliente B2B fazer o próprio pedido, nem cupom, programa de fidelidade, pontos ou cashback (o "cupom" do código é o recibo da venda). Toda venda depende do vendedor ou do balcão.
- A mensagem de IA é escrita para "um mercadinho de bairro" (prompt fixo em `clientes.py`). Para B2B o tom e o conteúdo estão errados.
- **Campanha não existe como processo:** o "envio" é abrir o WhatsApp cliente a cliente ou copiar até 20 mensagens (`CustomersPage.tsx`). Nada registra enviado, entregue, respondido ou convertido, e não há campo de consentimento de contato (LGPD).

### Vendas

Funciona: força de vendas offline, tabela de preço por cliente, preço mínimo, rota, meta, positivação, aprovação do gerente, limite de crédito.

| Problema | Prova |
|---|---|
| **Importação de clientes por CSV falha em todas as linhas** (0 de 3), mesmo sem saldo: o `cep` e o endereço são obrigatórios no banco e a rotina não os preenche. Ela ainda responde `success: true`. Se isso fosse corrigido, as linhas com saldo falhariam porque `ContaReceber` não aceita o campo `descricao` (`clientes.py:2330`) | **reproduzido** |
| Cadastro só PF: `cpf` obrigatório e único; sem CNPJ, razão social ou inscrição estadual | lido |
| **Cliente com título vencido há 90 dias comprou fiado e a venda foi aprovada.** O crédito só compara limite com saldo (`checkout_locking.py:61`) | **reproduzido** |
| **O score de crédito nunca é calculado.** `score_credito` vale 500 para todos e nenhuma rotina grava o campo (`models.py:845`); resultado: todo devedor aparece "risco médio" e a sugestão de limite é sempre zero | lido (busca confirma) |
| Pedido **à vista** da força de vendas é recusado se o cliente tem limite R$ 0 ("Limite excedido") | **reproduzido** |
| A meta do vendedor conta **todo pedido não cancelado, inclusive pendente de aprovação**, e o mês é calculado em UTC (`sfa.py:313,286`) | lido |
| Sem comissão de vendedor (só existe para motorista) e sem promessa de disponibilidade e prazo | busca sem resultado |

### Service (pós-venda)

Existe só rastreamento de entrega e cancelamento integral de venda. **Não existem** chamado, devolução parcial de venda, troca, garantia, reembolso ou SLA. Também não há pesquisa de satisfação nem NPS, então o sistema não mede se o cliente ficou bem atendido. Para uma distribuidora, a reclamação por avaria é parte do contrato com o cliente.

## Risco de segurança financeira (precisa de prova em PostgreSQL)

O recebimento de fiado converte o valor com `float()` e não rejeita `NaN` (`clientes.py:1226`). No teste local (SQLite) o `NaN` foi barrado por acaso, por uma coluna `NOT NULL` no caixa, e a operação deu erro 500 sem alterar títulos. O PostgreSQL aceita `NaN` em numérico; pela lógica do código, os títulos do cliente seriam marcados como pagos. **Não reproduzi** por não haver PostgreSQL nesta máquina. É a mesma classe de falha que FIN-01 corrigiu nos boletos de fornecedor.

## Lista de defeitos novos

| ID | Defeito | Prioridade | Prova |
|---|---|---|---|
| D-01 | Importação de clientes falha em 100% das linhas e diz sucesso | **P0 (migração)** | reproduzido |
| D-02 | Recebimento de fiado sem validação de valor finito, em `float` | **P0 (dinheiro)** | lido; validar em PG |
| D-03 | Inadimplente compra fiado; vencimento nunca bloqueia | P1 | reproduzido |
| D-04 | Score de crédito nunca calculado | P1 | lido |
| D-05 | SFA à vista exige limite de crédito | P1 | reproduzido |
| D-06 | CMV em três fórmulas; DRE com custo atual | P1 | lido |
| D-07 | DRE sem impostos e devoluções | P1 | lido |
| D-08 | INSS/IRRF inconsistentes entre holerite e rescisão | P1 | lido |
| D-09 | Rota de teste apaga ponto em produção | P1 | lido |
| D-10 | NFC-e: data fixa -03:00, sem destinatário | P1 | lido |
| D-11 | Meta SFA conta pendentes e usa UTC | P2 | lido |
| D-12 | Fluxo de caixa usa venda média como entrada | P2 | lido |
| D-13 | Nota do fornecedor com n=1, gravada em GET | P2 | lido |
| D-14 | Vale-transporte sem teto legal | P2 | lido |

## Roteiro para migrar (substitui o anterior)

| Etapa | Entrega | Por quê nesta ordem |
|---|---|---|
| 1 — Trazer a base | D-01, D-02; cliente PJ (CNPJ, IE, endereços de cobrança e entrega); importação de títulos em aberto por documento e vencimento | Sem isso o piloto nem começa |
| 2 — Crédito e cobrança de verdade | Score por pontualidade (aging), bloqueio por vencido, à vista sem limite (D-03, D-04, D-05), baixa por título com juros e desconto | É o dinheiro a receber da distribuidora |
| 3 — Pós-venda | Chamado, devolução parcial por lote, troca, reembolso | Foco de CX; hoje não existe |
| 4 — CX comercial | Segmentação B2B (carteira, frequência de pedido, curva de clientes), campanha rastreada com consentimento, comissão de vendedor | Hoje o marketing é manual e de varejo |
| 5 — Números confiáveis | CMV único, DRE com impostos, fluxo projetado com contas a receber (D-06, D-07, D-12) | Decisão do CEO sai desses números |
| 6 — Fiscal e pessoas | NF-e modelo 55; tabelas e regras de folha (D-08, D-09, D-10, D-14) | Depende do regime tributário e de especialista |
| 7 — Escala | Depósitos, transferência, inventário, conversão caixa × unidade; plano de contas | Só pesa com mais de um depósito |
| 8 — Ciclo completo do prompt | Portal do cliente B2B e fidelidade; pesquisa de satisfação; férias, admissão e carreira; kit e fracionamento | Fecha o que o prompt chama de ERP, HCM, SCM e CX completos |

## Decisões que só o dono pode tomar

1. **Regime tributário da empresa** (Simples, Presumido ou Real): define a matriz da NF-e e o DRE.
2. **Quantos depósitos e filiais** haverá no piloto.
3. **Como a distribuidora cobra** (boleto, Pix, cartão) e se há comissão de vendedor.
4. **Quem mantém folha e contabilidade** durante a coexistência: sistema atual ou este.
