# Consultor M-IA: RAG, provedores e controle de consumo

O Consultor recupera evidências estruturadas do PostgreSQL antes de chamar a IA. O LLM não escreve SQL nem executa ações no ERP. Esse é um RAG de dados operacionais; não é uma busca vetorial de PDFs. Uma base documental futura requer ingestão, indexação e avaliação próprias.

## Divisão de tarefas

| Tarefa | Provedor | Modelo | Limite |
|---|---|---|---|
| Chat do Consultor com RAG | DeepSeek | `deepseek-flash` | 1.024 tokens de saída |
| Insights do Consultor | DeepSeek | `deepseek-flash` | 512 tokens de saída |
| Texto curto/CRM | Groq Free | `openai/gpt-oss-20b` | Limite do chamador, normalmente 300 tokens |

Não há envio duplicado nem fallback automático entre provedores. Gemini não está ativo. Se Groq responder 429, o chamador usa o aviso/template existente; não encaminha silenciosamente ao DeepSeek pago. Nenhum plano foi atualizado para Developer. O código não pode impedir cobrança caso o titular altere posteriormente o plano da organização no painel do provedor.

Chaves: `DEEPSEEK_API` e `GROQ_API_KEY`, somente no backend privado. Nunca usar prefixo `VITE_` para elas. `.env.example` e `demo.env.example` não contêm tokens reais.

## Recuperação e isolamento

1. A API exige autenticação JWT e valida o plano e papel.
2. O estabelecimento vem do JWT; seleção de outra loja ou `all` é exclusiva de SUPERADMIN.
3. Os especialistas recuperam financeiro, vendas, estoque, compras, RH, clientes ou auditoria por consultas definidas no código.
4. Perguntas ao especialista geral selecionam até dois assuntos pelo texto; sem correspondência, usam o resumo geral. Isso é roteamento determinístico, não um classificador semântico treinado.
5. Cache de cinco minutos separado por especialista, loja e permissão; máximo 256 entradas. A visão global usa uma chave distinta.
6. Listas enviadas à IA são limitadas a dez registros; a resposta não deve tratar essa lista como universo completo. Totais agregados são preservados. Até duas fontes, cada uma limitada a 12.000 caracteres.
7. O prompt diferencia dados de instruções, exige fontes e período, proíbe inventar números e informa quando faltam evidências. Ausência de evidências aborta a geração.
8. Operadores não recebem contexto estratégico de financeiro/auditoria; custos e margens são removidos dos contextos operacionais restritos.
9. O retorno inclui `fontes` e `provider`; as interações são registradas no banco. A visão global registra o consumo no estabelecimento do SUPERADMIN.

Citações do modelo são auxílio à conferência, não uma prova automática de exatidão. Os cálculos dependem dos builders existentes. O sistema não é imune a alucinação só por usar RAG; revisar respostas e comparar os números com as fontes continua necessário.

## Controle de custo e operação

`DEEPSEEK_MAX_TOKENS=1024`, DeepSeek sem thinking, Groq com reasoning baixo. Uma chamada por tarefa; timeout 45 segundos, sem repetição automática paga. O Consultor tem limites existentes de 40 chats e 20 insights por dia por loja; esses limites não cobrem todos os recursos genéricos de CRM nem constituem um teto monetário na conta DeepSeek.

Uso de tokens é registrado sem chave, prompt ou resposta nos logs. A conta DeepSeek precisa de saldo/créditos válidos. Não houve compra ou recarga nesta configuração.

Groq publica para GPT-OSS 20B no Free: 30 requisições/minuto, 1.000/dia, 8.000 tokens/minuto e 200.000/dia (consultado em 05/10/2026; limites da organização prevalecem).

Fontes oficiais: [API DeepSeek](https://api-docs.deepseek.com/), [preços DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/), [limites Groq Free](https://console.groq.com/docs/rate-limits), [upgrade Groq](https://console.groq.com/docs/billing-faqs).

Testes: `backend/tests/test_llm_client.py` cobre roteamento, limites e falhas sem fallback; `test_consultor_rag.py` cobre separação por loja/permissão, visão global, evidências relevantes e ausência de dados. Resultados reais estão em `INTEGRACOES.md`.
