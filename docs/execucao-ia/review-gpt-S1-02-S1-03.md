# Revisão independente GPT — S1-02 e S1-03

Data: 2026-10-07. Base: `f055cbeae35b95f1ce4f8de43d6ffff07345221d`, com snapshot dos diffs locais. Revisão de código e execução local, sem deploy ou acesso ao banco de produção nesta revisão. Os handoffs do Gemini são declarações do autor; os resultados abaixo são verificação independente.

## S1-02 / FIN-01: correção parcial, aceite financeiro pendente

A rota `pagar_boleto` aceita status aberto/parcial, acumula `Decimal`, rejeita pagamento negativo ou acima do saldo e usa `with_for_update()`. Os dois testes do autor cobrem pagamento sucessivo e excesso. Os aceites antigos ERP-02/03 também passaram: suas marcações xfail foram removidas nesta branch, pois causavam XPASS estrito.

Três provas adicionais em `backend/tests/test_devops_finance_review.py`, executadas com `--runxfail`, falharam como segue:

| Prova | Comportamento exigido | Comportamento observado |
|---|---|---|
| `NaN` | HTTP 400, sem movimentação | HTTP 500 |
| Texto não numérico | HTTP 400, sem movimentação | HTTP 500 |
| Retry com a mesma chave e R$ 10,00 | Uma baixa de R$ 10,00 | Valor pago acumulado em R$ 20,00 |

A rota não persiste chave de idempotência e não mantém uma entidade de histórico de baixas. O teste de retry falha na asserção do valor pago, antes da asserção que exige uma única despesa. A marcação xfail estrita registra a pendência; não representa aprovação. Saída independente: `3 failed`, exit 1, em 28,99 segundos.

O lock escrito no código não comprova concorrência: o ambiente local desta revisão usa SQLite. O daemon Docker estava indisponível e não foi possível executar PostgreSQL local. A evidência exigida é teste real com conexões/transações distintas ao banco usado pelo sistema, verificando saldo, despesas e replay após conclusão da primeira transação.

Próxima fatia: validar entrada finita, precisão monetária e data antes dos efeitos; definir contrato de idempotência persistente por tenant, chave e payload; criar migration e histórico auditável se aprovados no desenho; comprovar rollback e concorrência real. Não basta acrescentar um header que a rota ignora.

**Decisão:** acumulação serial e rejeição de excesso confirmadas; encerramento do aceite financeiro para migração não aprovado.

## S1-03 / SUP-01: comportamento local confirmado

Os cinco casos de `test_fornecedores_listing_response.py` passam: resposta primária, fallback, filtros/soft delete, falha dupla com JSON e exclusão de outro tenant. A parametrização explica cinco casos com quatro funções de teste. A rota devolve uma resposta válida nos caminhos exercitados.

O handoff chama falha de joins/unaccent/migração de "Causa Raiz Publicada". Não há nessa revisão log do servidor, SQL falho ou estado do schema que demonstre tal causa. É uma hipótese. O traceback fornecido pelo usuário demonstra uma view sem resposta válida, mas não identifica o erro de banco anterior que teria ativado esse caminho.

**Decisão:** aceites locais de SUP-01 confirmados. Validar migration/schema e a rota autenticada no ambiente Oracle após publicação autorizada; diagnóstico causal de produção continua pendente.

## Regras de coordenação

Não iniciar nova alteração nos mesmos arquivos até consumir este review. Para cada correção, entregar diff, contrato, teste que falhava antes e passa depois, comando, ambiente e exit code. Não comunicar "sprint concluída" enquanto houver aceite obrigatório pendente. Os demais sete bloqueios ERP da suíte de migração continuam registrados e não foram corrigidos por esta revisão DevOps.
