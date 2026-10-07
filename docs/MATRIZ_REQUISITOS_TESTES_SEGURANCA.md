# Matriz requisito → teste — MercadinhoSys

Atualizada em 06/10/2026. Esta matriz documenta as regras encontradas no código e as evidências executadas. Inventário estático: 319 handlers, 15 handlers com SQL direto e 9 com upload; `scratch/security-route-inventory.json`. Inventário não significa revisão semântica integral de cada endpoint.

| Requisito/regra | Evidência | Situação |
|---|---|---|
| Leitura de produtos/clientes por loja, exclusão lógica, paginação | `test_tenant_isolation.py`, `test_security_audit.py` | Automatizado |
| Update/delete em lote mantém escopo da loja | `test_tenant_isolation.py` | Automatizado |
| Conta desativada não continua usando JWT antigo ou refresh | `test_security_audit.py`: revogação, refresh e três rotas fora do mapa | Automatizado |
| Papel atual prevalece sobre papel antigo no JWT | Middleware + testes de revogação | Automatizado |
| RH não promove funcionários a administrador | `test_rh_cannot_promote_account` | Automatizado |
| Bootstrap público não cria administrador | `test_security_audit.py` | Automatizado |
| Sync sem segredo falha; restore global exige superadmin e caminho restrito | `test_security_audit.py`, `test_sync_hybrid.py` | Automatizado |
| Operador da venda vem da identidade autenticada | `test_security_audit.py` | Automatizado nas duas APIs |
| Cliente/produto da venda pertence à loja | `test_security_audit.py`, `test_vendas_multi.py` | Automatizado |
| Quantidades/preços/pagamentos finitos, totais coerentes | Validador comum + `test_security_audit.py` | Automatizado |
| Limite de carrinho e paginação evitam pedidos sem limite | `test_security_audit.py` | Automatizado |
| Desconto usa permissão do funcionário e limites já definidos da loja | `test_checkout_enforces_discount_including_hidden_price_reduction`, 6 casos | Automatizado; aplica política existente do PDV |
| Administrador tem limite de 100%, conforme configuração atual do PDV | `validate_pricing`; preserva a exceção existente | Política preservada; aprovação de mudança comercial não inferida |
| Política de aumento/alteração de preço de catálogo e preços especiais por lote | Há caminhos de cadastro, importação e lotes com regras próprias | Falta especificação comercial única e matriz completa dessas mutações |
| Estoque não fica negativo com checkout concorrente | 6 vendas para 5 unidades: 5 aprovadas, 1 rejeitada | PostgreSQL real, duas APIs |
| Crédito não excede limite com vendas simultâneas | 5 vendas de R$10 para limite R$30: 3 aprovadas, 2 rejeitadas | PostgreSQL real, duas APIs |
| UUID offline repetido gera só uma venda | 4 tentativas: 1 criação, 3 respostas idempotentes; estoque/caixa debitados uma vez | PostgreSQL real, duas APIs |
| Lotes consumidos na ordem de validade, como regra FIFO existente | Quantidade 4 nos lotes 3 e 2 → saldos 0 e 1 | PostgreSQL real, duas APIs; algoritmo ordena validade, equivalente a FEFO |
| Cancelamento requer PIN/papel atual e não pode ser repetido | `test_cancellation_restores_lots_and_cash_once`, duas APIs | Automatizado SQLite e PostgreSQL |
| Cancelamento repõe lotes rastreados e estorna dinheiro | Mesmo teste acima; fechamento sem quebra de gaveta | Automatizado |
| Cancelamento de fiado estorna todas as contas abertas | `test_cancellation_multiple_credit_payments_clears_all_open_debt`, duas APIs | Dois pagamentos fiados cancelados; parcelas já liquidadas exigem regra explícita |
| Troco não aumenta saldo do caixa indevidamente | `test_cash_change_reconciles_with_closing`, duas APIs | Automatizado |
| Fechamento simultâneo com checkout | Mesma ordem de lock no caixa | Falta teste dedicado de corrida fechar/vender |
| Webhook só confirma notificação consultada no provedor | 200/502/503 testados com provedor simulado | Automatizado |
| Repetir eventos paid/settled não renova assinatura novamente | `test_payment_notification_replay_does_not_renew_subscription_again` | Automatizado SQLite e PostgreSQL |
| Migração da idempotência é reversível e upgrade é repetível | `test_payment_event_migration_round_trip_and_repeated_upgrade` | SQLite e PostgreSQL |
| Criar, consultar e cancelar cobrança Efí | `verify-payment-sandbox.py`: três HTTP 200 | Sandbox real; cobrança de R$1 cancelada |
| Pagamento efetivo, assinatura recorrente e notificação HTTP entregue pela Efí | Não executados neste ciclo | Pendente; sandbox de cobrança não prova liquidação/recorrência |
| Logo tem conteúdo válido e MIME derivado da imagem | HTML disfarçado rejeitado; PNG legítimo aceito mesmo com MIME falso | Automatizado |
| Planilha compactada não consome memória sem limite | XLSX acima de 50MB descompactados rejeitado; leitura limitada a 10 mil linhas | Automatizado |
| XML fiscal não admite DTD/entidades | `test_xml_rejects_entity_expansion` | Automatizado |
| Documentos pessoais locais exigem conta ativa e loja correta | `test_private_document_requires_current_user_and_matching_store` | Duas rotas; anônimo, outra loja, conta desativada e traversal |
| Novos documentos pessoais não são publicados no Cloudinary | Upload de CNH/CRLV/atestados usa volume privado; UI usa requisição autenticada | Implementado; URLs públicas antigas precisam ser inventariadas/migradas antes de dados reais |
| Busca SQL auxiliar de produto/funcionário mantém tenant | Helpers corrigidos; teste de produto estrangeiro e reaproveitamento do usuário atual | Automatizado parcialmente; inventário dos demais SQLs mantido |
| SFA: cliente, vendedor e produto pertencem à loja; valores finitos e códigos únicos no mesmo lote | `test_sfa_rejects_foreign_product_reference`, `test_sfa_validates_numeric_items_and_preserves_valid_orders`, 6 casos | Automatizado |
| Compras e recebimento | `test_pedido_compra_itens.py` | Cobertura existente aprovada; não é prova de todas as políticas possíveis |
| Fiscal simulado: emissão/cancelamento/importação | `test_fiscal_nfce.py`, 10 testes | Aprovado; não prova autorização SEFAZ |
| Fiscal externo em homologação | Todas as 5 lojas com gateway simulado; zero tokens configurados | Bloqueado por ausência de configuração externa; nenhuma emissão real certificada |
| RH, ponto, rescisão | `test_rh_rescisao.py`, `test_pin_seguranca.py`, `test_ponto_config_cache.py` | Cobertura existente aprovada |
| Delivery, clientes/RFM, despesas | `test_delivery_multi.py`, `test_customers_rfm.py`, `test_despesas_dashboard_reconciliation.py` | Cobertura existente aprovada |
| Métricas de estoque/ABC/giro | Suites `test_metrics_*`, ABC, Hub | Cobertura existente aprovada |
| Consultor, RAG e quotas | Suites consultor/LLM | Cobertura existente aprovada; preservado Groq sem fallback pago automático |
| Login, dashboard, produtos, clientes, vendas e PDV na UI | `smoke.cy.ts`, login real do seed e navegação | Aprovado no navegador; não é venda completa emitida pela UI |
| Scanner EAN-13 e acesso público | `security-regression.cy.ts`, 3 testes | Aprovado no navegador |
| Cache e pool sob carga | 101 e 5.000 produtos, concorrência 1/4/8, 100 amostras por rota | PostgreSQL/Redis na Oracle; WSGI direto, sem rede/Caddy/Gunicorn |
| Capacidade HTTP completa e todas as jornadas comerciais em navegador | Ainda não mensuradas integralmente | Pendente antes de certificar capacidade/publicação |

Nenhuma regra comercial nova de preço foi inventada. A proteção de descontos executa os limites que o PDV já apresentava. Pendências comerciais e integrações externas ficam explícitas, sem transformá-las em testes fictícios.
