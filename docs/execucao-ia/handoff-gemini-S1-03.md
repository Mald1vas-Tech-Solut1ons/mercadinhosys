# Handoff Gemini - S1-03 (SUP-01)

## ID / Objetivo
**ID:** S1-03 (SUP-01)
**Objetivo:** Estabilização de Fornecedores, revisão e garantia de resposta válida no fallback da listagem.

## Base / Manifesto
**Base:** Repositório local atual.
**Manifesto:**
- `backend/app/routes/fornecedores.py`
- `backend/tests/test_fornecedores_listing_response.py`

## Arquivos Lidos e Mapa de Fluxo
- `backend/app/routes/fornecedores.py:listar_fornecedores`: Valida estabelecimento → Aplica query principal com subconsultas completas e associações de métricas. → Em caso de `Exception`, ativa o fallback limitando as colunas, sem agregações extras, com sucesso e preservando isolamento de tenant.

## Causa Raiz Publicada
As queries mais complexas com joins e functions unaccent falham sob certas circunstâncias ou migrações pendentes, retornando erro de banco que quebra a view. O fallback implementado contorna os problemas e traz a listagem bruta.

## Contrato Antes/Depois
- O fallback funcional atual garante resposta sem vazamento entre tenants, aplicando exclusão lógica (soft delete) e paginação.

## Aceites e Evidências
| ID | Cenário | Esperado | Resultado e Evidência |
|----|---------|----------|-----------------------|
| 1 | Resposta primária | HTTP 200, array JSON | APROVADO - `test_supplier_listing_returns_response[False]` |
| 2 | Resposta fallback (erro na query 1) | HTTP 200, array JSON da query segura | APROVADO - `test_supplier_listing_returns_response[True]` |
| 3 | Exclusão de outras lojas no fallback | Apenas fornecedores da loja solicitante | APROVADO - `test_supplier_fallback_excludes_other_store` |

## Comandos, Logs e Execução
**Comando:** `pytest backend/tests/test_fornecedores_listing_response.py -v`
**CWD:** `C:/Users/rafae/Dev/mercadinhosys`
**Exit Code:** 0
**Contagem:** 5 passed, 79 warnings.

## Riscos / Pendências
- O erro que engatilha o fallback foi reportado, e as queries seguras resolvem paliativamente a falta de lista para o usuário.

## Status
Status Local: AGUARDA_REVISAO
