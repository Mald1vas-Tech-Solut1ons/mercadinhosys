# Relatório de Sprint Review & Planning — UX/UI do MercadinhoSys
## De: Scrum Master | Para: Project Manager
**Data:** 2026-10-31
**Produto:** MercadinhoSys — ERP/PDV para mercadinho de bairro
**Marco:** Semana de preparação do go-live do cliente piloto
**Base de evidência:** análise do código (frontend ~9.500 linhas lidas na íntegra, backend rotas/models/services auditados), jornadas do piloto, e julgamento PO da promessa de venda. Fontes no repositório: `docs/ANALISE_UX_UI_PILOTO_2026-10-31.md`.

---

## 1. RESUMO EXECUTIVO (o que o PM precisa decidir)

O piloto **não está pronto para go-live amanhã**, e a razão não é nenhum bug — é que a promessa que o produto vende ("em 2 meses você sabe exatamente o que está na prateleira e o que está sumindo") **não tem uma tela no sistema**. Temos cadastro, venda, caixa e auditoria maduros para o nicho; não temos a interface que responde à única pergunta que o cliente pagou para responder.

A decisão que o PM tem na mesa é uma só: **entramos no piloto com o que temos e corremos o risco conhecido, ou atrasamos 2 semanas e entramos com a promessa cumprida.** Minha recomendação está na Seção 8. O resto do relatório existe para você julgar.

---

## 2. O QUE O PILOTO ESPERA vs. O QUE ELE VAI ENCONTRAR

A regra de negócio que você assinou com ele:
- Controle de estoque + gestão. Não fiscal, não maquininha, não entrega.
- Dono próprio faz o inventário bipando. Operadora leiga no caixa.
- Suporte = você, via WhatsApp, com hora declarada.

O que ele vai encontrar no go-live se for amanhã (avaliação PO, não técnica):

| Ele espera | Ele encontra | Impacto |
|---|---|---|
| Aprender sem você ao lado | Menu com 23 módulos + tour de 13 passos | Liga para você no 1º dia |
| Abrir o caixa e vender | PDV deixa montar a venda TODA e só avisa no fim que precisava abrir o caixa | Venda travada com cliente na fila |
| "O que sumiu esta semana" | **Não existe a tela** | A promessa não se cumpre — churn no fim do trial |
| Cadastrar o pallet às 5h | 90 segundos por produto, 5 campos obrigatórios | Desiste no 5º, cadastro morre |
| Fechar o dia certo | Caixa esquecido aberto mistura 2 turnos e ninguém o impede | Noite de sexta contando gaveta com desconfiança |
| Sua equipe no caixa sem errar | Turno compartilhado: vendedora B vende "como" A | O "quem vendeu" sai errado — problema de RH e de confiança |

**Veredicto:** as 4 primeiras linhas são fricção treinável em 2 semanas de piloto; a 5ª é a que decide o contrato; a 6ª é a que explode no primeiro fechamento com funcionário.

---

## 3. PERSONAS E PSICOLOGIA DO USUÁRIO (a lente das decisões)

Sem persona, qualquer priorização é gosto. As três abaixo governam o backlog da Seção 6.

### Dono (admin da loja) — a decisão de pagar é dele
- 50+, primeiro sistema, notebook 1366×768 + celular.
- **Psicologicamente:** ele não lembra o que o sistema sabe. Cada vez que a tela pede um dado que ele já informou (troco de ontem, limite de desconto, o caixa de sexta), ele sente que o sistema "não presta" — e não diz, só desiste aos poucos.
- **O que o fideliza:** uma surpresa positiva por semana. O produto só tem uma prevista (a IA). O resto é invisível para ele.

### Caixa — a confiança diária vem dela
- Leiga, fila na sexta, sol na tela às 14h.
- **Psicologicamente:** ela opera em piloto automático. Toda ação irreversível exige freio visual grande; todo aviso que não impede nada vira ruído que ela aprende a ignorar (alarm fatigue: o alerta de sangria que dispara todo dia treina ela a ignorar o alerta de produto vencido da próxima venda).
- **O que a quebra:** mudança de contexto. Modal de peso que some, tecla que não responde, PIN que ela nunca ouviu falar.

### Você (super admin / suporte / dev / vendedor)
- Cada fricção do piloto vira 20 minutos seus de WhatsApp. 1 piloto = ~2h/semana; 10 pilotos = sua semana é suporte e o produto para de evoluir.
- **A métrica que importa para você nesta fase não é NPS: é horas de WhatsApp por piloto por semana.**

---

## 4. O QUE A TARDE REAL DO SÁBADO FAZ COM O SISTEMA

Casos de uso testados contra o código. O que aguenta e o que não:

| A realidade pergunta | O sistema responde |
|---|---|
| 2 caixas vendem o último iogurte juntas | ✅ Lock pessimista correto (`pdv.py:1080 with_for_update`) |
| Internet cai no clique de finalizar | ✅ Enfileira + idempotência (`usePDV.ts:532`) |
| Caixa esquecido aberto 29h | ❌ Texto amber de 12px que ninguém lê (`CaixaHeader.tsx:142`) |
| Funcionária sai, outra senta no mesmo tablet | ❌ SessionStorage é do navegador: B vende "como" A |
| Impressora trava no fechamento | ⚠️ Falha silenciosa — dono vai embora sem o papel |
| Balança etiqueta frios com EAN+peso | ❌ PDV procura o código literal e não acha (`pdv.py:576`) |
| Auditoria pergunta "quem excluiu o cliente?" | ⚠️ Campo existe; uma rota grava NULL conforme formato do JWT (`clientes.py:1013`); falha ao gravar é engolida com `except: pass` (`models.py:2470`) |

Duas coisas aguentam o sábado; quatro não. O piloto vai viver nas quatro.

---

## 5. A FALHA QUE NENHUM ACHADO ANTERIOR TOCOU E QUE DERRUBA O CONTRATO

A tela **"O que sumiu esta semana"** não existe. É a resposta da sua promessa de venda.

Hoje, para saber o que some, o dono precisa fazer inventário total de 3h e comparar na calculadora. Ele não vai fazer. No fim dos 2 meses grátis, você pergunta "cumpriu o critério que combinamos?" e a resposta é "não sei" — e o trial acaba sem conversão.

A feature não é cosmética: **contagem cíclica por seção** (uma gôndola por semana), 20 minutos do dono bipando a prateleira, e o sistema responde com a diferença (estoque esperado × contado). É a única peça que transforma o dado que já existe no valor que você vendeu. Detalhes em Parte 13.5 do documento técnico.

---

## 6. BACKLOG PRIORIZADO — 3 SPRINTS (com story points em dias-dev)

Sprint de 10 dias úteis, 1 dev (você). Pontos em dias estimados.

### Sprint 1 — "Não se machuque" (go-live seguro): 9 pts
| Item | Pontos | Por que é desta sprint |
|---|---|---|
| PDV bloqueado sem caixa aberto (não deixa montar o carrinho) | 1 | A regra mais barata com o maior ganho de confiança |
| Caixa >14h → modal bloqueante no primeiro toque do PDV | 1 | Mata o "2 turnos misturados" |
| Abertura de caixa sugere o fechamento de ontem | 1 | Acaba o erro de memória do dono |
| Trocar operador no mesmo tablet (lock rápido por PIN) | 2 | O "quem vendeu" errado é problema de RH e de confiança |
| Peso cancelado avisa alto (toast pendente) | 1 | Perda de venda toda semana |
| Parser único de data de validade (3 pontos) | 1 | Vencido não pode entrar |
| Desconto chama `validarDescontoPermitido` + PIN | 1 | Limite configurado é decorativo hoje |
| Estorno pergunta por item: "volta ao estoque / perda" | 1 | Leite aberto não volta pra gôndola |

Saída do sprint: o sistema **não se machuca sozinho** e o primeiro fechamento com funcionário não explode.

### Sprint 2 — "Aprenda sem mim" (TTFV): 8 pts
| Item | Pontos |
|---|---|
| Modo Pallet: bipa → preço+quantidade → Enter (subcategoria revisa depois) | 3 |
| Menu por persona do piloto (4 módulos na home; resto em "Mais") | 1 |
| Onboarding executável: 4 cards que FAZEM (abrir caixa, cadastrar 1º produto, vender, fechar) — não explicam | 2 |
| Dashboard: default "Hoje", 3 cards com ação ("Repor", "Cobrar") | 1 |
| Auditoria: preencher sempre `usuario_id`; falha na gravação vira log visível | 1 |

Saída do sprint: o primeiro cliente faz a primeira venda em **< 20 minutos sem você**. É a única sprint que vende o próximo cliente por boca-a-boca.

### Sprint 3 — "A promessa" (o que vende o contrato): 5 pts
| Item | Pontos |
|---|---|
| Tela "O que sumiu": contagem cíclica por seção + divergência | 3 |
| Insight da IA com botão de ação (Repor/Cobrar/Promocionar) via deep-links do Hub | 2 |

Saída: o dono abre uma tela e lê "esta semana sumiram 4 iogurtes e 1 azeite". Nesse dia o produto se paga na cabeça dele.

**Total: 22 dias-dev ≈ 3 sprints ≈ 5-6 semanas corridas.**

---

## 7. RISCOS AO PLANO (registro para o PM)

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Entrar no piloto antes do Sprint 3 e a promessa não se cumprir | Alta | **Perde o contrato e o depoimento** | Entrar no piloto só com Sprints 1+2 prontos e a tela de Sprints 3 prometida e datada |
| O piloto começar antes do Sprint 1 | Média | Fechamento com funcionário explode | Go-live não acontece sem Sprint 1, ponto |
| Modo Pallet pressionar o guardião | Média | Cadastro vira lixo de novo | Guardião no dado, não no fluxo: marca "para revisar" em lote |
| Trabalho visual (cores, fontes) consumir sprint de operação | Alta | Anda devagar e não move churn | Visual só depois do Sprint 2, se sobrar ponto |
| O escopo do piloto escapar (fiscal, entrega, maquininha) | Média | Atraso de meses | Regra do PM: fora do plano é add-on pago, escrito no piloto |

---

## 8. RECOMENDAÇÃO DO SCRUM MASTER

**Não entre no piloto amanhã.** A proposta para o dono, por escrito:

- **Semanas 1-2** (Sprint 1): sistema seguro. Go-live no fim com a rotina de caixa provada.
- **Semanas 3-4** (Sprint 2): ele aprende sozinho. TTFV medido na prática.
- **Semanas 5-6** (Sprint 3): a tela "O que sumiu" entra. No fim dos 2 meses grátis, o critério combinado ("você sabe o que some") está visível numa tela com o nome dele.

Entramos com o critério de sucesso do piloto **amarrado a uma feature com data**, não a uma esperança. O cliente piloto de R$ 99,90 com um depoimento é o canal de venda do cliente #2 — perder ele por entrar cedo demais custa mais que as 5 semanas.

Assinado, Scrum Master — materiais-base em `docs/ANALISE_UX_UI_PILOTO_2026-10-31.md` (evidências com arquivo:linha).

---

*Fim do relatório. Nenhum arquivo de código foi modificado.*
