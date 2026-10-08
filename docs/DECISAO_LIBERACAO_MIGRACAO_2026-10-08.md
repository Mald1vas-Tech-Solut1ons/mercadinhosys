# Liberação para migração da distribuidora/importadora

Decisão de 08/10/2026: **não liberar a substituição integral do ERP do cliente**. Correção publicada não equivale a adequação empresarial comprovada. Também não há, nesta execução, evidência suficiente para liberar um piloto com escrita real no estoque e no financeiro do cliente.

## Evidências disponíveis e o que falta

| Critério | Evidência disponível | Condição para liberar |
|---|---|---|
| Integridade dos incrementos | D-01..D-14 e ENT-01 publicados; CI da ENT-01: 450 SQLite e 152 PostgreSQL aprovados | Demonstrar todos os processos incluídos na migração, inclusive falhas, retentativas e reconciliação |
| Compras/estoque | Recebimento parcial e custo testados; vínculo XML/pedido em implementação COM-02A | Compra, nota, recebimento, lotes, custo e dívida reconciliados; reserva, expedição, unidades e depósitos conforme escopo |
| Fiscal | Serviço de saída atual emite modelo 65; leitura de XML de entrada modelo 55 | Modelo de saída necessário, regime e operações do cliente homologados com provedor real; rejeição, timeout, cancelamento e contingência demonstrados |
| Financeiro/contabilidade | Pagamentos e CMV corrigidos; DRE usa alíquota efetiva única | Bancos e cobrança conciliados; fechamento e contabilidade definidos; saldos iniciais e recebíveis/pagáveis reconciliados |
| HCM | Cálculos e ponto corrigidos; IRRF de rescisão ainda ausente | Definir sistema oficial de folha; validar competências e integrações necessárias antes de substituí-lo |
| CX, maior peso no objetivo | Carteira e crédito corrigidos; entrega/acerto publicados | Pedido com disponibilidade/prazo, ocorrência, devolução parcial, troca/reembolso e acompanhamento demonstrados; marketing e comissão conforme escopo |
| Recuperação | Backup validado, clone de deploy e rollback de imagem | Restaurar banco e anexos em ambiente limpo; demonstrar cópia externa e medir RPO/RTO. Clone e rollback de imagem não comprovam recuperação da empresa |
| Capacidade/disponibilidade | Health e smoke de publicação aprovados | Carga pela rede no pico representativo, p95/p99/erros/locks/memória; alarmes e procedimentos de suporte exercitados |
| Segurança | Correções de tenant e permissões com testes nos pontos alterados | Matriz transversal de papéis e segregação, acesso a anexos/jobs e auditoria validados no escopo empresarial |
| Migração | Importação de clientes corrigida; deploy preservou a base existente | Dois ensaios da base do cliente, igualdade de saldos e composição, corte/retorno com deltas e operações externas, aceite dos responsáveis |

O parecer anterior contém seções históricas com defeitos posteriormente corrigidos e expressões como “pronto” ou “piloto agora”. Elas não são uma autorização vigente de migração. Prevalecem os critérios acima e os gates do plano CTO.

## Trabalho sem contato com o cliente

O responsável informou que ainda não possui os dados da empresa e não pode contatá-la agora. Isso não bloqueia desenvolvimento independente. Usaremos cenários sintéticos explicitamente identificados, incluindo compras nacionais, uma nota cobrindo o pedido com cargas parciais, falta/avaria, venda à vista/a prazo, atraso, cancelamento, isolamento e concorrência. Não inventar regime, carga, arquitetura empresarial, SLA ou aprovação do cliente.

Continuar: COM-02A; PED-01; pós-venda parcial; reconciliação; recuperação e testes de capacidade. Escolhas fiscais e dimensionamento final ficam pendentes dos dados. Funcionalidade ausente no escopo deve ser implementada ou continuar em sistema oficial com responsabilidade definida e coexistência controlada.

## Comunicação comercial autorizável hoje

“Temos incrementos publicados e testados. A substituição integral do seu ERP ainda não está liberada. Vamos demonstrar os processos necessários, ensaiar os dados e o corte e validar os resultados antes de mudar a operação.”

Não prometer ausência de falhas, ausência de litígios, equivalência com SAP/TOTVS ou garantia integral com base em contagem de testes. Esta decisão técnica não é parecer jurídico nem assinatura profissional de responsabilidade.
