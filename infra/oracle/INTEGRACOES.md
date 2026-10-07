# Verificações da implantação Oracle

Verificado em 05/10/2026 (America/Sao_Paulo). Backend e PostgreSQL estão na VM Oracle; frontend permanece na Vercel. Nenhum upgrade de assinatura, compra de créditos ou transação financeira foi realizado.

| Recurso | Resultado observado | Limite da verificação |
|---|---|---|
| API HTTPS e banco | Health respondeu com banco conectado; login SUPERADMIN e admin1 HTTP 200 | Não equivale a auditoria de todas as funcionalidades do ERP |
| DeepSeek | Geração real retornou resposta; RAG global e de loja HTTP 200 | Usa saldo/créditos da conta; não é um serviço gratuito garantido |
| Groq | HTTP 200; headers de quota: 1.000 requisições/dia e 8.000 tokens/minuto | Compatíveis com Free GPT-OSS 20B; o plano de faturamento deve ser conferido em Billing |
| Cloudinary | Ping autenticado OK | Não foi enviado arquivo novo |
| Efí homologação e produção | Autenticação OAuth HTTP 200; certificados presentes | Não foram criadas cobranças nem pagamentos; ambiente configurado continua sandbox |
| SMTP | Não configurado | Não foi testado envio de e-mail |
| Backup PostgreSQL | Dump e restauração em banco temporário passaram, com 2.834 vendas | Backup diário na própria VM; falta cópia externa independente |

## Groq somente gratuito

Não foi realizado upgrade para Developer nem adicionada forma de pagamento. A aplicação não escolhe o plano da organização: esse plano é controlado no painel Groq. Os headers observados são compatíveis com a quota gratuita, mas não constituem uma consulta ao faturamento da conta.

Quando o Groq retorna 429, não há repetição automática nem transferência para o DeepSeek pago. O recurso exibe seu aviso ou template existente. Manter a organização no Free evita cobrança do Groq; qualquer futuro upgrade precisa ser uma decisão explícita do titular.

Fontes: [faturamento e upgrade](https://console.groq.com/docs/billing-faqs), [quotas gratuitas](https://console.groq.com/docs/rate-limits).

## RAG validado com o seed

- SUPERADMIN: geração de insights globais com fonte `geral` respondeu HTTP 200.
- admin1: chat de estoque respondeu 101 produtos ativos. O banco confirmou 101 produtos ativos na loja 2; as demais lojas tinham 8, 10 e 14.
- Mesmo enviando header de seleção da loja 3 com o token de admin1, a consulta continuou na loja 2. A visão global é exclusiva do SUPERADMIN.
- Foi corrigido o registro de quota/auditoria global: o valor `all` não é gravado nem consultado como chave estrangeira inteira; usa-se o estabelecimento real do funcionário autenticado.
- Os 12 testes em `test_llm_client.py` e `test_consultor_rag.py` passaram em container descartável com SQLite em memória, sem alterar dados de produção.

Os textos do modelo ainda precisam de conferência: citar uma fonte não garante exatidão. O envelope global contém resumos de vários assuntos, e o modelo pode nomear esses assuntos nas citações. Para conferir a origem técnica, usar também o campo `fontes` da resposta da API.

Scripts reproduzíveis: `verify-integrations.py`, `verify-rag-api.py` e `verify-groq-limits.py`. Executar os scripts que usam variáveis privadas dentro do container backend; nunca copiar chaves para comandos, documentação ou frontend.
