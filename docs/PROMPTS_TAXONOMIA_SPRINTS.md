# Taxonomia oficial — plano de prompts em sprints (para o Ollama)

Como usar: um prompt por vez, na ordem. Cada prompt é uma história pequena, com o que ler, o que fazer,
o que entregar e como você confere. **Só passe para o próximo depois de conferir o "Aceite".**
Plano técnico completo (referência): `docs/PLANO_CATEGORIAS_OFICIAIS.md`.

Regras para o modelo (cole no início de TODOS os prompts — é o "Bloco Fixo"):

```
BLOCO FIXO
Projeto: MercadinhoSys (Flask/SQLAlchemy/PostgreSQL em backend/, React/TypeScript/Vite em frontend/mercadinhosys-frontend/).
Branch: MaldvsTech/system-access-bigdatacorp-api-841e79. Não crie branch novo.
Leia antes: docs/PLANO_CATEGORIAS_OFICIAIS.md (seções indicadas no prompt).
Regras: faça SÓ o que este prompt pede; não publique em produção; não apague dados; não altere testes para "passar"
sem explicar; ao terminar, responda com: (1) arquivos alterados, (2) comandos rodados e saída dos testes,
(3) o que NÃO foi feito ou não foi provado.
Testes backend: cd backend && python -m pytest <arquivos> -q -p no:cacheprovider
Testes frontend: cd frontend/mercadinhosys-frontend && node ./node_modules/typescript/bin/tsc -b --force && node ./node_modules/vitest/vitest.mjs run
```

---

## Sprint 1 — Base de dados e taxonomia (backend, sem tela)

### Prompt 1.1 — Taxonomia em 3 níveis no código
```
[BLOCO FIXO]
Leia: PLANO §3.1 e o Anexo A inteiro.
Tarefa: em backend/app/services/catalogo_familias.py, crie TAXONOMIA = {familia: {categoria: [subcategorias]}}
exatamente como o Anexo A (nomes literais). Para as famílias menores siga a regra escrita no Anexo A.
Inclua a família "servico" do Anexo A. Mantenha CATEGORIAS_OFICIAIS existente, mas passe a GERÁ-LA a partir de
TAXONOMIA (lista plana das subcategorias por família), para não quebrar quem já usa.
Crie testes em backend/tests/test_taxonomia.py:
- toda família tem categoria "Outros";
- nenhuma subcategoria repetida dentro da família;
- nenhuma subcategoria aparece em duas famílias;
- toda subcategoria de CATEGORIAS_OFICIAIS (antes da mudança) continua existindo em TAXONOMIA.
Rode: tests/test_taxonomia.py tests/test_familias_formulario.py
```
**Aceite:** testes verdes; contagem de subcategorias ≈ 700 (o modelo deve informar o número).

### Prompt 1.2 — Serviço de taxonomia (regras de resolução)
```
[BLOCO FIXO]
Leia: PLANO §1 (regras 3, 4, 5) e §3.2.
Tarefa: crie backend/app/services/taxonomia_service.py com chave_canonica, arvore, resolver, outros
(garantir_categoria_loja fica para o prompt 1.3). Sem distância de letras: só igualdade por chave canônica.
Testes em tests/test_taxonomia.py:
- chave_canonica("Cama, Mesa e Banho") == chave_canonica("CAMA MESA BANHO");
- chave_canonica("Brinquedo") == chave_canonica("Brinquedos");
- resolver("bazar", "PANELAS") devolve as chaves de Cozinha/Panelas;
- resolver("bazar", "panela inventada") devolve None;
- resolver("bazar", "Ração para Cães") devolve None (é de outra família);
- outros("pet") devolve as chaves de "Outros Pet".
```
**Aceite:** testes verdes; o modelo mostra 3 exemplos reais de entrada → saída.

### Prompt 1.3 — Colunas novas e sincronização com categoria da loja
```
[BLOCO FIXO]
Leia: PLANO §2 e §3.2 (garantir_categoria_loja).
Tarefa:
1. Adicione em Produto (backend/app/models.py) as colunas categoria_oficial VARCHAR(60) e subcategoria_oficial VARCHAR(80),
   e o índice (estabelecimento_id, subcategoria_oficial).
2. Registre as colunas na lista de colunas automáticas de backend/app/__init__.py (mesmo padrão de
   ("configuracoes", "tentativas_senha_bloqueio", "INTEGER DEFAULT 3")).
3. Implemente garantir_categoria_loja(estab_id, chave_categoria): procura em categorias_produto por codigo=chave
   (ativo); cria se não existir com nome = "<Família> › <Categoria>" (QUALIFICADO: há UniqueConstraint
   estabelecimento_id+nome e nomes de categoria se repetem entre famílias) e codigo = chave. Nunca por nome.
   Teste o maior nome contra o limite de 50 caracteres.
5. Em VendaItem, adicione familia_produto, categoria_oficial e subcategoria_oficial (retrato no momento da venda),
   também na lista de colunas automáticas. O preenchimento no checkout fica para o prompt 2.2.
4. Inclua categoria_oficial e subcategoria_oficial (+ nomes de exibição) no to_dict do produto.
Testes: garantir_categoria_loja é idempotente (2 chamadas = 1 linha); "Cozinha" de bazar e de limpeza na mesma loja
NÃO colidem; "Outros" de 3 famílias na mesma loja não colidem; produto serializa os campos novos.
```
**Aceite:** testes verdes; nenhuma coluna removida; o modelo cola o diff do model.

---

## Sprint 2 — Travar todos os caminhos de escrita (backend)

### Prompt 2.1 — Cadastro e edição de produto
```
[BLOCO FIXO]
Leia: PLANO §3.3 linhas 1 e 2 da tabela.
Tarefa: em backend/app/routes/produtos.py, criar_produto e atualizar_produto passam a exigir subcategoria válida da família
(campo "subcategoria", aceita chave ou nome; fallback para o campo "categoria" se vier só ele). Fora da lista → 400
{"success": false, "code": "categoria_invalida", "message": "Escolha uma subcategoria da lista de <nome da família>"}.
Gravar categoria_oficial, subcategoria_oficial e categoria_id (via garantir_categoria_loja).
Edição: mudou a família e a subcategoria não pertence → 400 pedindo a nova.
Testes novos (tests/test_taxonomia_rotas.py): válido → 201 com colunas; inventado → 400; de outra família → 400;
"cama e mesa" escrito diferente → resolve; edição trocando família sem subcategoria → 400.
Depois rode a suíte inteira do backend e corrija os testes antigos que mandavam categoria livre, trocando por uma
subcategoria válida (não afrouxe a regra). Liste quais arquivos de teste mudou.
```
**Aceite:** suíte inteira verde (o modelo informa "N passed, 0 failed").

### Prompt 2.2 — Demais caminhos (estoque, planilha, catálogo, XML, PDV, onboarding)
```
[BLOCO FIXO]
Leia: PLANO §3.3 linhas 3 a 9.
Tarefa: aplique a mesma regra em: POST /estoque, PUT /estoque/<id>, importação por planilha (coluna "subcategoria",
fallback "categoria"; não resolvido vira erro da linha), catalogo_importar (sem casar → outros(familia)),
fiscal/entrada_service.py (_get_or_create_categoria_importacao → outros(familia pelo NCM)),
pdv.py Taxa de Entrega → família servico / "Taxas e Entregas", saas.py onboarding → não criar categorias.
Checkout (finalizar venda no PDV e pedido SFA faturado): gravar em cada VendaItem o retrato familia_produto,
categoria_oficial e subcategoria_oficial do produto naquele momento.
Teste de varredura: após exercitar cada rota, nenhuma linha em categorias_produto tem codigo vazio/nome fora da taxonomia.
Rode a suíte inteira.
```
**Aceite:** suíte inteira verde; o modelo lista cada um dos 7 pontos com "feito + teste".

### Prompt 2.3 — API para a tela e sugestão da BigDataCorp
```
[BLOCO FIXO]
Leia: PLANO §3.3 linha 10 e §3.4.
Tarefa: resolver_view_schema passa a devolver "taxonomia": arvore(familia) (manter categorias_sugeridas).
_sugestoes_cadastro devolve "subcategoria" (chave) resolvida na família sugerida, ou None.
GET /api/produtos/ aceita filtros categoria_oficial e subcategoria_oficial.
Testes: schema de "bazar" traz a árvore com "Cozinha" > "Panelas"; filtro por subcategoria retorna só os produtos dela.
```
**Aceite:** testes verdes; o modelo cola um trecho do JSON do schema com a árvore.

---

## Sprint 3 — Tela (frontend)

### Prompt 3.1 — Componente CategoriaPicker
```
[BLOCO FIXO]
Leia: PLANO §4 item 1.
Tarefa: crie frontend/mercadinhosys-frontend/src/components/schema/CategoriaPicker.tsx e o tipo da taxonomia em
src/types/viewSchema.ts. Busca única ("Buscar subcategoria…") que filtra por chave canônica (sem acento, sem maiúscula,
singular/plural) e mostra "Subcategoria — Categoria"; árvore com categorias em pílulas roláveis e subcategorias da
categoria escolhida. SEM opção de criar. Sem resultado: "Não está na lista oficial. Use ‘Outros…’".
No celular (≤640px) abre em tela cheia usando src/components/ui/ResponsiveModal.tsx; pílulas whitespace-nowrap.
Testes vitest: digitar "pan" mostra Panelas; texto inexistente mostra a mensagem; não existe botão "criar".
```
**Aceite:** tsc e vitest verdes.

### Prompt 3.2 — Usar o picker no cadastro e no pedido de compra
```
[BLOCO FIXO]
Leia: PLANO §4 itens 2 a 5.
Tarefa: em ProductFormModal.tsx troque o campo "Categoria *" (input + datalist + CategoriasProntas) pelo CategoriaPicker,
enviando "subcategoria". Trocar a família limpa a escolha se não pertencer (toast avisando). Produto antigo sem
subcategoria: aviso e obrigatório antes de salvar. Busca por nome/BigDataCorp preenche com sugestoes.subcategoria.
PurchaseOrderModal.tsx (~linha 158): nunca 'Geral'; usar a subcategoria sugerida ou a "Outros…" da família.
ProductsPage: filtro por categoria → subcategoria.
```
**Aceite:** tsc e vitest verdes; o modelo descreve o fluxo testado.

### Prompt 3.3 — Conferência visual (desktop e celular)
```
[BLOCO FIXO]
Leia: PLANO §5.
Tarefa: monte a pré-visualização local do formulário (schema real gerado pelo backend + mock do apiClient), abra em
1366px e 375px e confira: nada fora da tela (scrollWidth == innerWidth), botões sem quebra de texto, busca do picker
funcionando, troca de família limpando a subcategoria. Tire capturas. Apague os arquivos de pré-visualização no fim.
```
**Aceite:** você vê as capturas (desktop e celular) e aprova.

---

## Sprint 4 — Conversão dos produtos atuais

### Prompt 4.1 — Gerar a proposta (sem aplicar)
```
[BLOCO FIXO]
Leia: PLANO §6 itens 1 e 2.
Tarefa: crie o comando "flask converter-taxonomia --loja <id>" em backend/app/commands.py DENTRO de register_commands.
Sem --aplicar, só gera CSV id;nome;familia;categoria_atual;subcategoria_sugerida;motivo. Teste local com dados de teste.
NÃO rode em produção.
```
**Aceite:** teste verde e um CSV de exemplo.

### Prompt 4.2 — Aplicar com backup
```
[BLOCO FIXO]
Leia: PLANO §6 itens 3 e 4.
Tarefa: implemente --aplicar <csv aprovado>: tabela de backup bkp_taxonomia_<data>_produtos, uma transação,
desativar (ativo=false, deleted_at=now()) categorias_produto da loja sem produto e sem codigo oficial. Nunca apagar.
Teste: aplicar e depois restaurar pelo backup deixa tudo como antes.
```
**Aceite:** teste de ida e volta verde.

> Rodar em produção (gerar CSV da loja 10, sua aprovação, aplicar) é decisão sua, depois da Sprint 5.

---

## Sprint 4b — Indicadores por categoria (painel profissional)

### Prompt 4b.1 — Endpoint de indicadores
```
[BLOCO FIXO]
Leia: PLANO §7b inteiro.
Tarefa: crie GET /api/relatorios/categorias (nivel, pai, inicio, fim, visao=atual|venda) com TODOS os indicadores da
tabela do §7b. Agregação no SQL (group by), nunca loop em Python sobre vendas. Não toque em Despesa.categoria.
Testes com massa montada no teste (3 famílias, 5 subcategorias, vendas com custo conhecido): faturamento, margem,
mix somando 100%, ruptura, encalhe, GMROI e cobertura batendo com o cálculo à mão (escreva o cálculo no teste).
```
**Aceite:** testes verdes; o modelo mostra o cálculo à mão de 2 indicadores.

### Prompt 4b.2 — Retrato nas vendas antigas
```
[BLOCO FIXO]
Leia: PLANO §2 (retrato em venda_itens).
Tarefa: comando "flask preencher-retrato-vendas --loja <id>" (dentro de register_commands) que preenche
familia_produto, categoria_oficial e subcategoria_oficial dos VendaItem vazios com a classificação ATUAL do produto,
em lotes de 1000, e registra a data do corte nas configurações da loja. Idempotente. Teste local. NÃO rode em produção.
```
**Aceite:** teste verde; rodar 2 vezes não muda nada na segunda.

### Prompt 4b.3 — Tela "Categorias" nos relatórios
```
[BLOCO FIXO]
Leia: PLANO §7b (parte "Tela") e §5.
Tarefa: aba "Categorias" em src/features/reports/: drill-down Família → Categoria → Subcategoria → Produto, tabela
ordenável, barras horizontais de participação, quadrante faturamento × margem com o papel de cada nó, seletor de
período e de visão. Cards de Produtos: gráfico com nível família → categoria. Celular: cartões, nada fora da tela em
375 px. Faça a conferência visual do PLANO §5 e mostre as capturas.
```
**Aceite:** você vê as capturas e confere 1 número da tela contra o relatório de vendas do mesmo período.

## Sprint 5 — Publicação e prova

### Prompt 5.1 — PR e CI
```
[BLOCO FIXO]
Leia: PLANO §7 itens 1 e 2.
Tarefa: commit no branch, abra PR NOVO contra master, espere CI verde nos 3 jobs para o SHA do topo.
Informe o SHA e o link do run. NÃO publique ainda.
```

### Prompt 5.2 — Publicar (só com o seu "pode publicar")
```
[BLOCO FIXO]
Leia: PLANO §7 inteiro (cada item ali já derrubou produção ou custou horas).
Tarefa: publique backend (script publicar_backend2.sh) e depois frontend (Vercel). Não rode release.py por ssh direto,
não use pkill, não suba a aplicação dentro do container. Ao fim: publicar.out com "FIM: no ar <sha> healthy" e
version.json da Vercel com o SHA.
```

### Prompt 5.3 — Prova em produção e relatório
```
[BLOCO FIXO]
Leia: PLANO §8.
Tarefa: provar cada critério (por SQL somente leitura e pelos arquivos publicados) e entregar relatório: SHA,
o que foi provado e como, o que NÃO foi provado, comando de rollback.
```

---

## Checklist do Scrum Master (você)
| Sprint | Prompts | Pronto quando |
|---|---|---|
| 1 Base | 1.1, 1.2, 1.3 | taxonomia + serviço + colunas com testes verdes |
| 2 Travas | 2.1, 2.2, 2.3 | suíte inteira verde, nenhum caminho cria categoria livre |
| 3 Tela | 3.1, 3.2, 3.3 | capturas aprovadas por você (desktop e celular) |
| 4 Conversão | 4.1, 4.2 | CSV de exemplo + teste de backup/restauração |
| 4b Indicadores | 4b.1, 4b.2, 4b.3 | números batendo com cálculo à mão + capturas aprovadas |
| 5 Publicação | 5.1, 5.2, 5.3 | relatório com SHA, provas e rollback |

Se o modelo travar, errar ou "pular" algo: repita o mesmo prompt acrescentando "Você não fez X; faça só X agora".
Se ele disser que algo "não existe" no sistema, peça para mostrar o grep no repositório antes de aceitar.
