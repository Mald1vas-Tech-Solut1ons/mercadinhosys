# Evidências de infraestrutura e motores matemáticos

Data: 07/10/2026. Complementa o [plano de implementação](PLANO_CTO_SCRUM_DISTRIBUIDORA_2026-10-07.md) e a [auditoria funcional](AUDITORIA_MIGRACAO_ERP_DISTRIBUIDORA_2026-10-07.md). Distingue observação ao vivo, comportamento executado localmente e proposta futura. Nenhuma alteração foi aplicada ao servidor neste trabalho.

## 1. Onde o sistema está funcionando

| Camada | Evidência e estado atual | Implicação |
|---|---|---|
| Frontend | `https://mercadinhosys.vercel.app/`; hospedagem Vercel documentada; HTTP 200 verificado do servidor às 19:00 UTC / 16:00 de Brasília. Fonte local: React 19, TypeScript, Vite 7 e PWA | O HTTP 200 não certifica os fluxos autenticados, nem comprova qual revisão de frontend foi publicada |
| API | `https://mercadinhosys-api.144.22.151.18.sslip.io/api`; VM Oracle; `/health` HTTP 200; Caddy 2 em 80/443 | Nome provisório associado ao IP; health não é teste de negócio |
| Host | SSH confirmou `mercadinhosys-vnic`; 954 MiB RAM, aproximadamente 45 GB disco, 2 GB swap. No instante medido: 698 MiB utilizados, 255 MiB disponíveis, 252 MiB swap utilizados | Ambiente atual de demonstração; não existe certificação de carga empresarial. Os números são uma fotografia, não série histórica |
| Forma/região/SO | Documentação da instalação: OCI `VM.Standard.E2.1.Micro`, São Paulo, Ubuntu 24.04 x86/AMD | Shape, região e versão do SO vêm da documentação, não foram reconsultados no console OCI neste ciclo |
| Backend | Docker `oracle-backend-1`, Flask/Gunicorn, comando ativo confirmado: 1 worker, 4 threads, timeout 120 s, reciclagem a cada 300 requisições + jitter; limite 512 MiB; porta 5000 somente localhost | Quatro threads não significam quatro processadores. Um processo também concentra caches e falhas |
| Banco | Docker `postgres:15-alpine`, limite 256 MiB, sem porta pública; `max_connections=25`; 8 conexões no instante consultado | Pool da aplicação: 2 + 1 de overflow. Aumentar workers sem revisar pools pode esgotar banco/memória |
| Redis | Docker `redis:7-alpine`, limite do container 64 MiB; `maxmemory=24 MiB`, `noeviction`; sem porta pública | Atua no limitador. `REDIS_URL` ausente no backend publicado: cache Flask não está configurado para Redis |
| Caches analíticos | `SimpleCache` no Flask sem Redis; `SmartCache`, ABC e giro têm dicionários em memória próprios | Configurar Redis no Flask não migra automaticamente os caches próprios. Vários processos podem divergir até expiração/invalidação |
| Armazenamento/backup | Documentação: volumes locais, backup diário e retenção de 7 dias na mesma VM. Timer ativo confirmado; última execução agendada registrada em 07/10 às 03:03 UTC | Timer executado não prova sucesso do backup. Não revalidei o último dump nem restauração neste ciclo; ausência de cópia externa é risco de perda conjunta |
| Fiscal | Consulta agregada ao banco: 5 estabelecimentos em gateway simulado/homologação, nenhum token fiscal configurado | Não há prova de operação fiscal real nesse banco |
| Dados | Consulta atual: 133 produtos ativos em quatro lojas; documentação do seed: 2.834 vendas geradas em quatro meses | Dados simulados não representam histórico nem volume da empresa que pretende migrar |

Snapshot reproduzível: `scratch/cto-infra-snapshot-2026-10-07.json`; script somente leitura: `infra/oracle/cto-readonly-snapshot.py`. Outro inventário agregado foi obtido por `infra/oracle/security-readonly-snapshot.py`. Nenhum deles imprime credenciais nem dados pessoais.

### Publicado versus local

Comparei SHA-256 dos arquivos efetivamente instalados no container com o workspace, evitando presumir que código local é código publicado:

| Arquivo | Resultado |
|---|---|
| `app/dashboard_cientifico/models_layer.py` | Igual: `697c919450251f35e3dd3c111c709347445161c2babcdd13e6fb18248cea5b0e` |
| `app/dashboard_cientifico/orchestration.py` | Igual: `f494d3512116b95436c595bcaba7576e35191dc44fe7dbe5fedf7823acb72c3e` |
| `app/routes/fornecedores.py` | Diferente: correção local não está no container examinado |
| `app/models.py` | Diferente; não extrapolar todas as correções/regras locais para produção |

A listagem de fornecedores sem credencial respondeu 401, como esperado. Isso **não reproduz nem resolve** o erro original autenticado. O fallback local foi corrigido e testado; a exceção que dispara a consulta principal continua a exigir diagnóstico por log/revisão de schema. O release deve registrar revisão, digest da imagem, migrações e teste autenticado.

## 2. Como funcionam as engrenagens

O caminho principal do dashboard científico é: rota autorizada por estabelecimento → `DashboardOrchestrator` → consultas SQL em `DataLayer` → validação em `StatsValidator` → regras em `PracticalModels` / `TemporalAnalysis` → serialização → cache → frontend. É um conjunto de agregações SQL, estatística descritiva e heurísticas em Python/NumPy; não identifiquei pipeline de treinamento, registro de modelos e validação preditiva contínua nesse caminho.

`orchestration.py:24` usa executor com até três tarefas em paralelo e sessões próprias. Com pool ativo de duas conexões mais uma de overflow, um dashboard frio pode disputar todas as conexões disponíveis com vendas. É um risco arquitetural identificado; ainda precisa de reprodução com tráfego concorrente no PostgreSQL isolado. O plano propõe limitar concorrência e mover agregações caras para jobs/materializações depois de medir a necessidade.

## 3. Matemática existente, limitações e regra proposta

### Financeiro, margem e custo médio

Atualmente, consultas somam vendas finalizadas; CMV utiliza `quantidade × custo_unitario` de itens. As identidades gerenciais são:

$$Receita = \sum_i total_i; \quad CMV = \sum_i q_i c_i$$
$$LucroBruto = Receita - CMV; \quad MargemBruta = LucroBruto/Receita$$

Para a empresa real, especificar antes o tratamento de devoluções, tributos, descontos, taxas e reconhecimento por competência. O número gerencial não substitui escrituração. O custo da saída deve ser histórico e rastreável, e receita zero exige resultado indefinido para a margem, não divisão por zero.

**Executado:** PDV grava item sem `custo_unitario` no caso auditado; agregações podem inflar lucro. O custo médio trunca quantidades fracionadas: 1,5 unidades a R$10 + 0,5 a R$20 deveria resultar em R$12,50, mas permanece em R$10.

Regra de custo médio ponderado (quando essa política for escolhida):

$$C_{novo}=\frac{Q_{antes}C_{antes}+Q_{entrada}C_{entrada}}{Q_{antes}+Q_{entrada}}$$

Usar Decimal, escalas próprias para moeda/unidade/custo, política de arredondamento e tratamento explícito de estoque negativo. Custo de importação deve incorporar somente componentes aprovados da nacionalização e tratar tributos recuperáveis conforme validação fiscal/contábil. Rateios precisam fechar exatamente no total, inclusive centavos residuais.

O dashboard também chama de ROI uma razão entre lucro do período e valor do estoque atual. É indicador heurístico; estoque atual não é capital médio investido. Renomear ou definir denominador e período antes de apresentar retorno financeiro ao CEO.

### ABC, giro e reposição

`PracticalModels.analyze_inventory_abc:285` ordena `valor_total` e classifica pelo acumulado em 80%/95%. A variável depende da consulta chamadora; especificar se representa faturamento, consumo em custo ou capital em estoque. Não são métricas intercambiáveis.

$$s_i=r_i/\sum_j r_j; \quad A_i=\sum_{j\leq i}s_j$$

A implementação considera o acumulado **após** adicionar o SKU. Um único SKU responsável por 100% recebe C. A política de fronteira precisa incluir o item dominante na classe prioritária e ter exemplos aprovados. Há chamadas com top 50, janelas diferentes e margem calculada com custo atual: padronizar universo, janela e custo histórico antes de decidir compras.

`Produto.calcular_giro_metrica:1183` calcula venda média diária e cobertura. Há método legado com quantidade vendida acumulada/estoque atual, diferente de giro contábil:

$$VMD=Q_{vendida}/dias; \quad Cobertura=EstoqueDisponivel/VMD$$
$$GiroContabil=CMV/EstoqueMedioEmCusto$$

`ponto_ressuprimento:1275` usa `VMD × lead_time × 1,5`. O fator 1,5 é uma decisão heurística; não mede probabilidade de ruptura. Relatório usa só sete dias e projeção linear simples.

Proposta, depois de limpar dados/calendário e medir fornecedor:

$$Posicao=SaldoElegivel-Reservas+EntradasFirmes$$
$$PontoPedido=\bar d L+EstoqueSeguranca$$

Para demanda diária independente com desvio $\sigma_d$ e prazo constante $L$, uma aproximação é $SS=z\sigma_d\sqrt L$. Se prazo variar, sob independência entre demanda e prazo: $SS=z\sqrt{\bar L\sigma_d^2+\bar d^2\sigma_L^2}$. São hipóteses a testar; demanda intermitente, rupturas, MOQ e múltiplos de embalagem exigem tratamento específico. `z` deve refletir uma política de nível de serviço documentada, não um valor universal.

### RFM e crédito

`RFMService` consulta vendas finalizadas de uma janela de 180 dias:

$$R=diasDesdeUltimaCompra;\quad F=numeroCompras;\quad M=valorCompras$$
$$Score=0,4R_s+0,3F_s+0,3M_s$$

Os escores 1..5 vêm de faixas fixas: recência 30/60/90/120 dias, frequência 2/4/7/10 compras, monetário R$50/200/500/1000. Um distribuidor tem valores e ciclos distintos do varejo; essas faixas não foram calibradas para o cliente.

Existe **outra implementação**, `Cliente.calcular_rfm:862`, usada pelo dashboard/listagem: usa campos acumulados do cliente, percentis de frequência/ticket e segmentos diferentes; o parâmetro `days` não transforma os acumulados em histórico daquela janela. Também há risco/limite de crédito por regras fixas. Não apresentar esse score como probabilidade de inadimplência. Unificar um contrato de métricas por tenant e separar segmentação de marketing de decisão de crédito com alçada humana.

### Tendência, previsão e intervalos

`detect_sales_trend` exige sete dias, calcula MAD, suavização e médias aparadas como diagnósticos, mas classifica tendência pelo contraste das **medianas brutas** das duas metades. Limiares de 20%/50% e confiança por tamanho da série são heurísticos. Campos chamados `avg_*` podem representar mediana.

`generate_forecast:453` ajusta regressão linear aos últimos até 14 valores:

$$m=\frac{\sum(x_i-\bar x)(y_i-\bar y)}{\sum(x_i-\bar x)^2};\quad c=\bar y-m\bar x;\quad \hat y_h=\max(0,mx_h+c)$$

Os limites são simplesmente $0,8\hat y_h$ e $1,2\hat y_h$. Não são intervalos de previsão calibrados: não usam resíduos, horizonte, distribuição ou cobertura observada. Séries não regulares ainda tratam cada linha como um dia consecutivo.

**Executado / ANA-01:** série vazia gera R$1.500, R$1.650 e R$1.800 para três dias, mesmo solicitando sete. `method=insufficient_data` não torna esses valores observações ou previsões fundamentadas. Bloquear esses valores no produto.

Proposta: resultado vazio com motivo sem histórico; calendário completo por fuso; baseline ingênuo/sazonal; avaliação por origem móvel sem usar futuro no treino; seleção somente se houver benefício comprovado para o horizonte de compras. Registrar versão, corte de dados e erros:

$$MAE=\frac1n\sum|y_i-\hat y_i|;\quad WAPE=\frac{\sum|y_i-\hat y_i|}{\sum|y_i|}$$

Se o denominador do WAPE for zero, marcar indisponível. Para intervalos, medir cobertura e largura por horizonte em dados fora do ajuste. Os fundamentos estão nas referências dos autores sobre [validação temporal](https://otexts.com/fpp3/tscv.html) e [intervalos de previsão](https://otexts.com/fpp3/prediction-intervals.html).

### Correlação e significância

Pearson deve usar pares observados e alinhados:

$$r=\frac{\sum(x_i-\bar x)(y_i-\bar y)}{\sqrt{\sum(x_i-\bar x)^2\sum(y_i-\bar y)^2}}$$

`calculate_correlations:551` usa NumPy, mas a série de despesas é construída com média constante e ruído artificial de 1% a 4%, em vez de datas observadas. Quando faltam resultados, injeta coeficientes -0,77, 0,17 e 0,01. O campo `significancia=0.05` é constante, não p-valor calculado; há ainda coeficientes fixos 0,95/0,99 para insights.

**Executado / ANA-02:** vendas e despesas vazias geram três supostas correlações Pearson. O mesmo arquivo foi confirmado no container publicado. Esta é uma falha de integridade analítica P0, não apenas melhoria de sofisticação.

Proposta: pares reais, janela comum, tratamento explícito de ausências, n mínimo e variância não nula; relatar n e método. Para séries temporais, considerar tendência, autocorrelação e testes múltiplos antes de afirmar evidência estatística. Correlação não autoriza texto causal como “gera maior faturamento”. Não preencher ausência com demonstração dentro do ambiente operacional.

### Anomalias, confiança e saúde

`detect_anomalies:817` aplica z robusto:

$$MAD=mediana(|x-mediana(x)|);\quad z_r=0,6745(x-mediana(x))/MAD$$

Marca $|z_r|>2,5$, severidade maior acima de 3,5; MAD zero não produz alertas. Porém descarta faturamento ≤R$1 como “dia fechado” sem consultar calendário. Pode esconder ruptura, falha de captura ou indisponibilidade real. Introduzir calendário operacional, monitoramento de dados faltantes e comparação sazonal antes de interpretar quedas.

`StatsValidator` remove observações além de três desvios padrão e atribui níveis de confiança por n e CV. “High” a partir de 30 observações não é confiança estatística de 95%. Crescimento é truncado entre -100% e 500%; base zero retorna 100% por convenção; `is_significant` significa variação maior que 10%, não teste de hipótese. Não apagar valor real para caber no card; separar valor, alerta e apresentação.

`calculate_health_score:884` começa em 70, ajusta pela margem e limita a 0..100. Sem finanças também retorna 70. Não mede solvência, inadimplência, caixa ou saúde operacional completa. Definir “indisponível” sem dados e explicar componentes antes de uso comercial.

### Temporal, afinidade, simulação e LLM

Há agregações reais por hora/categoria e concentração das três maiores horas. Em `data_layer.py:942`, matriz produto/horário, afinidade de produtos e comportamento horário do cliente retornam listas vazias: não certificar market basket implementado. Se priorizado, suporte/confiança/lift exigem cesta e universo definidos, devoluções tratadas e validação real.

O seed usa perfis, sorteios e distribuição de quantidades/cestas para gerar história simulada. Ele é ferramenta de demonstração/teste, não modelo de previsão de demanda, nem evidência de aderência ao importador.

Consultor: cliente de LLM e RAG com seleção por tema/palavras, contexto SQL autorizado por tenant e limites de tamanho. Documentação ativa cita DeepSeek e Groq; não chamei provedores neste ciclo. Não identifiquei busca vetorial nesse caminho. Texto do LLM deve citar dados/momento, passar por revisão e nunca alterar sozinho crédito, saldo, cálculo fiscal ou lançamento financeiro.

## 4. Contrato obrigatório para cada indicador

Cada métrica publicada deve ter: nome/unidade; fórmula; versão; tabela e campos de origem; período/fuso; estados elegíveis; tratamento de cancelamentos/devoluções; tenant; atualização; qualidade/amostra; limites de interpretação; exemplos reconciliados; dono da regra; teste com resultado esperado. Dados simulados precisam de identificação visível. Falta de informação deve produzir indisponibilidade explicada.

Os dois novos testes em `backend/tests/test_analytics_acceptance_audit.py` falharam com `--runxfail`, confirmando ANA-01/02. Permanecem `xfail(strict=True, raises=AssertionError)` para rastrear dívida conhecida. **Xfail não conta como requisito aprovado.** A liberação dos motores exige remover a marca e tornar a aceitação aprovada após corrigir o comportamento.

Validação deste complemento: seleção de ABC, RFM, giro por período e fornecedores resultou em **8 passed, 2 xfailed** (os dois xfailed são ANA-01/02), em 17,92 segundos. Log: `scratch/cto-regressao.log`; falhas explícitas: `scratch/cto-analytics-falhas.log`. São testes locais em SQLite isolado e não uma certificação do PostgreSQL publicado. Foram emitidos avisos de API legada e de chave JWT de fixture curta; nenhuma credencial real foi alterada. A suíte inteira não foi repetida neste complemento.

## 5. Recuperação e capacidade propostas

A única VM atual é um ponto de falha para API, banco e backups. Propor staging separado, armazenamento de cópias externas cifradas, restauração ensaiada e observabilidade; separar banco/aplicação conforme custo e resultados de carga. Recuperação pontual exige estratégia de backup base e arquivamento WAL, não apenas um dump diário; consultar a [documentação PostgreSQL 15](https://www.postgresql.org/docs/15/continuous-archiving.html).

Metas iniciais para negociação: RPO ≤15 minutos, RTO ≤2 horas, disponibilidade 99,9% mensal. São **metas propostas**, não garantias do sistema atual. Uma VM maior melhora capacidade; não elimina ponto de falha nem garante esses objetivos. Dimensionamento final depende de picos, volumes e testes pela rede com API, banco, fiscal e analytics concorrentes.
