# Feature Spec — "O que sumiu" (contagem cíclica de estoque)
## A tela que sustenta a promessa de venda do piloto

**Origem:** decisão PO registrada em `docs/CONTEXTO_SESSAO_UX_PILOTO_2026-10-31.md` (Partes E.1, E.5) e `docs/RELATORIO_SM_PM_UX_PILOTO_2026-10-31.md` (Sprint 3).
**Responsável:** Scrum Master propõe; PM autoriza.
**Data:** 2026-10-31
**Status:** Spec pronta. Nenhum código escrito.

---

## 1. A PROMESSA

O contrato do piloto tem uma frase — "em 2 meses você sabe exatamente o que está na prateleira e o que está sumindo". O sistema hoje registra venda e estoque. Nenhuma tela responde à segunda metade.

Esta feature entrega: o dono bipa a prateleira uma vez por semana (20 minutos), e o sistema responde **a diferença entre "deveria ter" e "tem"**. Não é inventário total de fim de ano — é uma pergunta semanal de resposta imediata, formulada como o dono formularia na mesa do bar: "a gôndola 3 tá certa?".

## 2. POR QUE ESTA E NÃO OUTRA

- É a única feature que transforma o dado que já existe (`Venda`, `MovimentacaoEstoque`, `Produto.quantidade`) na valor que o contrato vende.
- O plano de go-live já manda o dono fazer inventário **bipando** — o hardware é o leitor USB, não um app novo. Esta tela é o lugar onde essa bipagem acontece.
- Sem ela, o critério combinado com o piloto ("você sabe o que some") vira conversa de WhatsApp, não tela. Com ela, é uma linha de divergência.

## 3. O QUE O DONO FAZ (fluxo inteiro, em 6 passos)

1. Abre **Estoque → Contagem cíclica** no menu. Uma tela com as seções que ele mesmo definiu ("Gôndola 1 — Mercearia", "Gôndola 2 — Bebidas", "Prateleira — Padaria").
2. Toca na seção da semana. O sistema mostra: "esta seção deveria ter 34 produtos. Comece a bipar."
3. Ele anda pela seção e bípa cada produto uma vez por unidade que vê na prateleira. Cada bip sobe um contador na tela: "Café 3 Corações: 6 no papel, 5 bipados". Se bípar o que não é da seção, avisa mas aceita (a prateleira erra, não o sistema).
4. Quando termina, toca "Conferir". O sistema mostra só os divergentes: "Café: deveria 6, contado 5 — falta 1" e lista os que batem em "OK".
5. Ele escolhe, por divergente: **"Sumiu"** (registra a perda com motivo), **"Contei errado"** (re-bipa aquela linha), ou **"Está certo assim"** (ajusta o estoque para o contado — uma divergência que a prateleira ganhou do sistema, ex.: lote extra que entrou e não foi registrado).
6. Toca **"Aplicar"**. O sistema gera uma `MovimentacaoEstoque` por divergente (motivo "Contagem cíclica — <nome da seção>", tipo saída ou entrada conforme o sinal) e marca a seção como contada naquela semana.

Fechou: a semana seguinte pergunta a próxima seção. Em 3-4 semanas, toda a loja foi contada; no fim do mês, o relatório "O que sumiu em outubro" sai somando as divergências por motivo.

## 4. MODELO DE DADOS (mínimo que o backend precisa)

Sem inventário total, sem app novo, sem tabela "contagem" separada — reusa o que existe.

```python
class ContagemCiclica(db.Model, MultiTenantMixin, AuditMixin):
    __tablename__ = "contagem_ciclica"
    id = db.Column(db.Integer, primary_key=True)
    estabelecimento_id = TenantID()
    nome = db.Column(db.String(80), nullable=False)        # "Gôndola 3 — Higiene"
    status = db.Column(db.String(20), default='aberta')    # aberta | conferida | aplicada
    data_abertura = db.Column(db.DateTime, default=utcnow)
    data_aplicacao = db.Column(db.DateTime, nullable=True)
    funcionario_id = db.Column(db.Integer, db.ForeignKey("funcionarios.id"), nullable=False)
    # itens: 1 linha por produto bipado OU por produto-que-deveria-estar-e-não-foi-bipado
```

```python
class ContagemCiclicaItem(db.Model, MultiTenantMixin):
    __tablename__ = "contagem_ciclica_itens"
    id = db.Column(db.Integer, primary_key=True)
    contagem_id = db.Column(db.Integer, db.ForeignKey("contagem_ciclica.id"), nullable=False, index=True)
    produto_id = db.Column(db.Integer, db.ForeignKey("produtos.id"), nullable=False)
    quantidade_esperada = db.Column(db.Numeric(10, 3), nullable=False)  # congelada no início
    quantidade_contada = db.Column(db.Numeric(10, 3), nullable=False, default=0)
    divergencia = db.Column(db.Numeric(10, 3))    # contada - esperada (calculado na conferência)
    decisao = db.Column(db.String(20))            # 'sumiu' | 'recontar' | 'ajustar' | 'ok'
    movimentacao_id = db.Column(db.Integer, db.ForeignKey("movimentacoes_estoque.id"), nullable=True)
```

**Escolha deliberada que o PM assina:** a decisão "sumiu" grava a `MovimentacaoEstoque` com tipo `saida` e motivo "Contagem cíclica — <seção>" — o DRE e o relatório de perdas já sabem ler. Não é uma pilha paralela de "perdas por contagem".

**Regra de negócio que não abre exceção:**
- `quantidade_esperada` é congelada no `data_abertura` da contagem — se alguém vender um café enquanto o dono anda pela gôndola, a divergência é legítima e ele decide de olho nela.
- Uma seção não pode estar "aberta" em duas contagens ao mesmo tempo (unique parcial: 1 `aberta` por estabelecimento).
- Aplicar uma contagem exige o PIN do dono — divergência grande não entra com o toque errado do estagiário.

## 5. API (extensão, não contrato novo)

```
GET    /api/contagem/secoes                        → seções com última contagem (ou "nunca contada")
POST   /api/contagem                               → abre contagem { nome, itens: [produto_id...] }
                                                   (congela quantidade_esperada de cada um)
POST   /api/contagem/<id>/bipar                    → { codigo_barras } → soma 1 ao item (ou adiciona fora da seção)
GET    /api/contagem/<id>/conferir                 → lista com divergencia calculada
POST   /api/contagem/<id>/aplicar                  → { itens: [{produto_id, decisao}] , pin }
                                                   → por 'sumiu'/'ajustar': 1 MovimentacaoEstoque, fecha a contagem
GET    /api/contagem/relatorio?de=&ate=            → divergências por motivo/seção no período
```

Todas sob `funcionario_required` + escopo de tenant. Aplicar exige nível ≤ 2 (admin/gerente) + PIN válido — mesma regra do descarte em Produtos.

## 6. O QUE O FRONT ENTREGA (a tela, não a teoria)

Uma página `EstoqueCountsPage.tsx` nova em `features/products/` com três telas dentro dela:

**Tela A — Lista de seções** ("o que preciso contar esta semana"):
- Card por seção: nome, última contagem ("há 12 dias"), badge vermelho se "nunca contada".
- CTA fixo mobile-first: [+ Nova contagem] → input com o nome da seção.

**Tela B — Bipagem** (20 minutos do dono, o ponto central da feature):
- Um campo gigante fixo no topo com foco permanente (padrão scanner-wedge já existe no PDV — REUSAR o mesmo listener).
- Lista ao vivo com o que já foi bipado: nome, "esperado 6 · bipado 5".
- Som de beep de confirmação (o `BarcodeScanner` já tem) — o dono anda sem olhar a tela.
- Item bipado fora da seção aparece acinzentado com o selo "não é desta seção — contei mesmo assim?" e o dono decide no fim.

**Tela C — Conferência e decisão** (o "O que sumiu?" de fato):
- Só os divergentes em destaque; os que batem num "34 OK" recolhido.
- Cada divergente com 3 botões grandes: [Sumiu] [Re-contar] [Está certo assim].
- Rodapé: "Divergência total: −R$ 47,80 (3 itens)".
- [Aplicar contagem] pede o PIN só uma vez para o conjunto.

**Mobile-first** porque o dono está em pé na loja com o celular na mão — `md:` sobe para duas colunas, mas o fluxo é pensado para a mão.

## 7. PSICOLOGIA DO USUÁRIO NESTA TELA (por que assim)

- **Som de beep por bip** → feedback auditivo sem olhar a tela; condiciona o "funcionou" sem tirar o olho da prateleira.
- **Só divergentes na decisão** → o dono não revisa 200 itens bons; decide 3 ruins. A atenção dele é o recurso caro.
- **"Sumiu / Re-contar / Está certo assim"** → a linguagem dele, não a do ERP ("saída por ajuste de inventário").
- **PIN no fim, não no começo** → a fricção está no passo irreversível, não no passo exploratório. O dono anda livre pela loja; trava só no apertar final.
- **Contagem aberta persiste** ✅ por design: se o telefone toca no meio e ele volta 40 min depois, os bip estão lá. É a mesma escolha do sessionStorage do PDV.

## 8. CASOS DE ERRO QUE O PILOTO VAI PRODUZIR (já previstos)

| Ele faz | O sistema responde |
|---|---|
| Bipa o mesmo item 40 vezes sem querer (leitor trigado 2×) | O contador exibe o número — ele vê "contados 12" e re-conta |
| Vende o café enquanto conta | A divergência aparece e ele sabe que vendeu — decide com contexto |
| Esquece de conferir e fecha a loja | A contagem fica "aberta" e aparece com badge vermelho na próxima abertura da tela |
| Bipa produto sem codigo_barras | O parser resolve pelo codigo_interno (prefixo 20) — mesmo caminho do PDV |
| Alguém aplica a contagem errada | Cada MovimentacaoEstoque referencia a contagem (`movimentacao_id`) — reversível por script se precisar |

## 9. ACEITE (como o PM mede que ficou pronto)

1. Dono faz 1 contagem de 30 itens em **< 15 minutos** na primeira vez, sem ajuda.
2. Bipa 1 item que vendeu no meio da contagem → a divergência mostra o "porquê" legível.
3. Aplicar gera 1 `MovimentacaoEstoque` por divergente com motivo "Contagem cíclica" e o `usuario_id` preenchido (não NULL).
4. Relatório do mês: "Outubro — 12 itens sumidos (R$ 187) — 8 por quebra/validade, 4 sem motivo".
5. Quarta semana do piloto: o dono abre sozinho e pergunta qual seção contar **sem você mandar mensagem**. Esse é o aceite real.

## 10. O QUE FICA DE FORA (não entra nesta spec)

- App mobile novo — não, o scanner USB e o celular resolvem.
- Inventário total — não, essa é a ferramenta da semana, não a de fim de ano.
- Integração com a IA (ela **usa** o resultado — "a seção Higiene tem 3 divergências seguidas" — mas não decide nada pelo dono).
- Sugestão automática de seções com base em giro — a primeira versão deixa o dono nomear a gôndola como ele a chama na loja ("a do shampoo", "a da frente").

---

*Spec pronta para o PM aprovar escopo e ordem. Nenhuma migration, route ou componente foi escrito nesta sessão.*
