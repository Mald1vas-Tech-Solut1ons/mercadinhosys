# Handoff Gemini - S1-02 (FIN-01)

## ID / Objetivo
**ID:** S1-02 (FIN-01)
**Objetivo:** Correção do fluxo de pagamentos sucessivos de boletos, garantindo baixas acumulativas com saldo correto, efeitos únicos e concorrência segura (transação ACID no PostgreSQL).

## Base / Manifesto
**Base:** Repositório local após conclusões da Sprint S1-01 (ANA-01/02).
**Manifesto:**
- `backend/app/routes/pedidos_compra.py`: Lógica de pagamento de boleto atualizada (`pagar_boleto`).
- `backend/tests/test_fin01_boleto_payments.py`: Novo teste para cobertura do caso (pagamento parcial e sucessivo).

## Arquivos Lidos e Mapa de Fluxo
- `backend/app/routes/pedidos_compra.py`: Contém a rota de pagamentos `/boletos/<int:conta_id>/pagar`.
- `frontend/mercadinhosys-frontend/src/features/products/purchaseOrderService.ts`: Serviço de frontend para checar payload da requisição.
- Fluxo: Usuário submete pagamento → Valida status do boleto (`aberto` ou `parcial`) → Aplica lock na linha usando `with_for_update()` → Acumula o valor pago (`valor_pago`) e subtrai do `valor_original` para obter o `valor_atual` correto → Atualiza o status → Persiste na ContaPagar e cria Despesa.

## Causa Raiz
A rota `pagar_boleto` originalmente permitia pagamento apenas se `status == 'aberto'`, barrando múltiplos pagamentos. Quando aceito, não acumulava o valor, sobrescrevendo `conta.valor_pago = valor_pago`, e `conta.valor_atual` perdia a consistência original. Não havia lock pessimista na linha, gerando concorrência.

## Contrato Antes/Depois
- **Antes:** Não suportava baixas parciais sucessivas (erro status != aberto); sobrescrevia pagamentos e calculava saldo erradamente. Sem atomicidade.
- **Depois:** Aceita pagamento se status `aberto` ou `parcial`. Atualiza atomicamente usando `with_for_update()`. `valor_pago` é acumulado. `valor_atual` é `valor_original - valor_pago`. Retorna `parcial` se saldo > 0 ou `pago` se saldo 0.

## Aceites e Evidências
| ID | Cenário | Esperado | Resultado e Evidência |
|----|---------|----------|-----------------------|
| 1 | Pagamento Parcial (10 sobre 40) | Saldo=30, Pagos=10, Status=parcial | APROVADO - `test_sucessive_payments_boleto` |
| 2 | Segundo Pagamento (30 sobre 30) | Saldo=0, Pagos=40, Status=pago | APROVADO - `test_sucessive_payments_boleto` |
| 3 | Pagamento que excede o saldo (50 sobre 40) | Rejeitado (HTTP 400) | APROVADO - `test_payment_exceeds_current_value` |

## Comandos, Logs e Execução
**Comando:** `pytest backend/tests/test_fin01_boleto_payments.py -v`
**CWD:** `C:/Users/rafae/Dev/mercadinhosys`
**Exit Code:** 0
**Contagem:** 2 passed, 43 warnings.

## Riscos / Pendências
- O frontend não envia `idempotency_key`, dependendo do estado real da `ContaPagar` para barrar pagamento extra. Como a concorrência bloqueia na linha de DB, isso mitiga double-spends instantâneos.
- Depende de driver PostgreSQL para eficácia total do lock `with_for_update()`. (No SQLite o teste funciona em modo serializado).

## Status
Status Local: AGUARDA_REVISAO
