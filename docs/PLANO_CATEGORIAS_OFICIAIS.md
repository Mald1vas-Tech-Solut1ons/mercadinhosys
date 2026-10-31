# Plano — Taxonomia oficial (Família → Categoria → Subcategoria) com cadastro travado

Autor: Claude (CTO), 31/10/2026. Aprovado pelo Rafael: **Opção A** (lista única para todas as lojas; só o super admin acrescenta).
Executor: este documento é autocontido. Leia tudo antes de mexer. **Não publique em produção sem o OK do Rafael.**

---

## 0. Contexto mínimo (o que você precisa saber)

- Sistema: **MercadinhoSys** (ERP/PDV SaaS multi-loja). Backend Flask + SQLAlchemy + PostgreSQL (`backend/`), frontend React + TypeScript + Vite + Tailwind (`frontend/mercadinhosys-frontend/`).
- Repositório: `Mald1vas-Tech-Solut1ons/mercadinhosys`. Branch de trabalho: `MaldvsTech/system-access-bigdatacorp-api-841e79`.
  Último commit do branch: `1e138e29` (lista oficial plana, ainda sem trava). Produção roda `7cbcdd5c`.
- **"Família"** = tipo de produto que decide o formulário (campos, validade, fiscal). Já existe: 32 famílias em
  `backend/app/services/catalogo_familias.py` (`AJUSTES_FAMILIAS_EXISTENTES` + `FAMILIAS_NOVAS`) integradas em
  `backend/app/services/view_schema_service.py` (`FAMILIAS_PRODUTO`, `resolver_view_schema`, que já devolve
  `categorias_sugeridas` no schema).
- **Categoria hoje** = texto livre por loja: tabela `categorias_produto` (`id, estabelecimento_id, nome, descricao, codigo,
  ativo, created_at, deleted_at`), produto aponta por `produtos.categoria_id`. Não existe subcategoria.
- O guardião do cadastro (`backend/app/services/cadastro_guardiao.py`) grava nome/marca/fabricante/categoria em MAIÚSCULAS
  (`canonicalizar_texto`). Categoria é normalizada por `CategoriaProduto.normalizar_nome_categoria` (Title Case).
- Problema que motivou: "Cama E Mesa", "Cama, Mesa", "Cama ,Mesa" viraram 3 categorias; produto caindo em categoria
  desativada; lojista inventando nomes.

## 1. Regras de negócio (o que tem de ser verdade no fim)

1. Taxonomia em **três níveis**: Família → Categoria → Subcategoria. A taxonomia é **global** (código), não por loja.
2. O produto passa a ter **família + categoria oficial + subcategoria oficial**. Subcategoria é **obrigatória** no cadastro
   novo; ela determina a categoria (não se escolhe categoria e subcategoria de árvores diferentes).
3. **Não existe texto livre.** Nenhum caminho (cadastro, edição, importação por planilha, pedido de compra, entrada por XML,
   importação de catálogo, PDV) cria categoria/subcategoria fora da taxonomia. Fora da lista → erro 400 com mensagem clara.
4. Escrita diferente resolve sozinha pela **chave canônica**: minúsculas, sem acento, sem pontuação, sem palavras de ligação
   (e, de, da, do, das, dos, para, com), plural → singular simples (tira "s" final de palavra com mais de 3 letras).
   "cama e mesa" = "CAMA, MESA" = "Cama Mesa". Igual por chave → usa a oficial. Parecido mas diferente → **não** adivinha.
5. Toda família tem a subcategoria "Outros …" (categoria "Outros") para o item raro. Nunca "Geral".
6. Só o super admin acrescenta subcategoria (Opção A). Fase futura: tela de super admin; nesta entrega, via código.
7. Trocar a família no formulário limpa categoria/subcategoria que não pertencem à nova família.
8. Produtos antigos: conversão com lista aprovada pelo Rafael antes de aplicar, com backup (ver §6).

## 2. Modelo de dados (migração ADITIVA — nada é apagado)

Tabela `produtos`: acrescentar
- `categoria_oficial VARCHAR(60) NULL` — chave da categoria (ex.: `bazar.cozinha`)
- `subcategoria_oficial VARCHAR(80) NULL` — chave da subcategoria (ex.: `bazar.cozinha.panelas`)
- índice `ix_produtos_estab_subcat (estabelecimento_id, subcategoria_oficial)`

Manter `produtos.categoria_id` + `categorias_produto` funcionando **sincronizados** (telas, filtros, relatórios e DRE usam):
ao gravar a subcategoria, o backend garante na loja uma linha em `categorias_produto` com `nome` = nome de exibição da
**categoria** oficial (ex.: "Cozinha") e `codigo` = chave (`bazar.cozinha`), e aponta `categoria_id` para ela.
(Assim nada que lê `categoria_id` quebra.) Busca da linha por `codigo` (não por nome).

Migração: o projeto adiciona colunas em `backend/app/__init__.py` (lista de `("tabela", "coluna", "TIPO")`, ver o bloco que
contém `("configuracoes", "tentativas_senha_bloqueio", "INTEGER DEFAULT 3")`) **e** declara no model `Produto`
(`backend/app/models.py`, classe `Produto`, perto de `data_validade`). Faça as duas coisas.

## 3. Backend

### 3.1 Taxonomia em código
Arquivo `backend/app/services/catalogo_familias.py`: substituir `CATEGORIAS_OFICIAIS` (hoje lista plana por família) pela
estrutura de 3 níveis do **Anexo A** (dicionário `TAXONOMIA = {familia: {categoria: [subcategorias]}}`). Gerar a partir dela:
- `chave_categoria(familia, categoria)` → `f"{familia}.{slug(categoria)}"`;
- `chave_subcategoria(...)` → `f"{familia}.{slug(categoria)}.{slug(subcategoria)}"`;
- manter `categorias` de cada família = lista plana de **subcategorias** (o que o schema já expõe), para não quebrar o front atual.
`slug` = chave canônica da regra 4 com `_` no lugar de espaço.

### 3.2 Serviço novo `backend/app/services/taxonomia_service.py`
```python
def chave_canonica(texto: str) -> str: ...            # regra 4
def arvore(familia: str) -> list[dict]:               # [{"chave","nome","subcategorias":[{"chave","nome"}]}]
def resolver(familia: str, subcategoria: str | None, categoria: str | None = None) -> tuple[str, str] | None:
    """(chave_categoria, chave_subcategoria) se o texto/chave casar POR CHAVE CANÔNICA com a taxonomia da família;
    aceita a chave pronta (bazar.cozinha.panelas) ou o nome ("PANELAS"). Só categoria sem subcategoria → None."""
def outros(familia: str) -> tuple[str, str]:          # chaves de "Outros …" da família
def garantir_categoria_loja(estab_id: int, chave_categoria: str) -> CategoriaProduto:  # §2, por codigo
```
Sinônimos legados (para converter/aceitar nomes antigos sem inventar): dicionário `SINONIMOS = {"cama e mesa": "...", ...}`
só onde o significado é inequívoco. Nada de semelhança por distância de letras.

### 3.3 Pontos de escrita a alterar (todos em `backend/app/routes/produtos.py` salvo indicação)
| # | Onde | Hoje | Passa a |
|---|------|------|---------|
| 1 | `criar_produto` (~linha 2206, bloco `if data.get("categoria")`) | busca/cria por nome | exige `subcategoria` (chave ou nome) válida da família via `resolver`; senão 400 `{"code":"categoria_invalida","message":"Escolha uma subcategoria da lista de <Família>"}`; grava as 2 colunas + `categoria_id` via `garantir_categoria_loja` |
| 2 | `atualizar_produto` (~2742) | busca/cria por nome | mesma validação quando vier `subcategoria`/`categoria`/`familia_produto`; se mudar a família e a subcategoria não pertencer, 400 pedindo a nova |
| 3 | `POST /estoque` (`criar_produto_estoque`, ~5150) | cria por nome | igual ao #1 |
| 4 | `PUT /estoque/<id>` (~5332) | cria por nome | igual ao #2 |
| 5 | Importação por planilha (~6340, usa `_imp_chave_categoria`) | cria por chave | coluna `subcategoria` (aceitar coluna `categoria` como fallback); resolver na família da linha; não resolvido → erro da linha (lista de erros já existente), nunca criar |
| 6 | `catalogo_importar` (~1218 e `resolver_categoria` ~1248) | cria "Geral"/por nome | usar `resolver`; sem casar → `outros(familia)` |
| 7 | `backend/app/services/fiscal/entrada_service.py` `_get_or_create_categoria_importacao` (~259) | categoria "importação" | `outros(familia)` (família inferida pelo NCM, já há helpers em `bigdatacorp_service.familia_por_evidencia`) |
| 8 | `backend/app/routes/pdv.py` (~913, "Taxa de Entrega" → "Serviços") | cria "Serviços" | família `servico`, subcategoria "Taxas e Entregas" (Anexo A) |
| 9 | `backend/app/routes/saas.py` (~308, onboarding cria Geral/Bebidas/Mercearia) | cria 3 categorias | não criar nada; categorias nascem sob demanda por `garantir_categoria_loja` |
| 10 | `_sugestoes_cadastro` (~697, busca BigDataCorp) | casa categoria da loja | devolver `subcategoria` resolvida na família sugerida (por chave canônica) ou `None` |

### 3.4 API
- `GET /api/view-schema/?familia_produto=X` já devolve o schema: acrescentar `taxonomia: arvore(X)` (manter `categorias_sugeridas`).
- `GET /api/produtos/` e `to_dict` do produto: incluir `categoria_oficial`, `subcategoria_oficial` e os nomes de exibição.
- Filtros da lista de produtos: aceitar `categoria_oficial` e `subcategoria_oficial` como query params.

### 3.5 Testes (pytest, `backend/tests/test_taxonomia.py` novo)
- `chave_canonica`: "Cama, Mesa e Banho" == "CAMA MESA BANHO"; "Brinquedo" == "Brinquedos".
- Taxonomia: toda família (exceto nenhuma) tem "Outros"; nenhuma subcategoria repetida dentro da família; nenhuma
  subcategoria em duas famílias (regra GS1 — o teste já existe para lista plana em `test_familias_formulario.py`, adaptar).
- Cadastro: subcategoria válida → 201 e colunas gravadas + `categoria_id` coerente; texto inventado → 400 `categoria_invalida`;
  subcategoria de outra família → 400; "cama e mesa" estilo diferente → resolve.
- Edição: troca de família sem nova subcategoria → 400.
- Planilha: linha com subcategoria inventada vira erro da linha; linhas válidas entram.
- Nenhum caminho cria `categorias_produto` com nome fora da taxonomia (varrer a tabela após os testes de cada rota).
- Ajustar testes existentes que mandam `"categoria": "Qualquer"`: passar `subcategoria` válida (o CI vai apontar quais;
  na última rodada eram ~10 arquivos, rode a suíte inteira).

## 4. Frontend

Arquivos: `src/features/products/components/ProductFormModal.tsx` (formulário), `src/types/viewSchema.ts` (tipos),
`src/features/products/components/PurchaseOrderModal.tsx` (cria produto rápido), `src/features/products/ProductsPage.tsx` (filtros).

1. **Componente novo `CategoriaPicker.tsx`** (`src/components/schema/`): recebe `taxonomia` (do schema) e devolve
   `{categoria, subcategoria}`. UX:
   - campo de busca único ("Buscar subcategoria…"): digitar "pan" lista "Panelas — Cozinha", "Panos de Prato — Mesa"…
     (busca na chave canônica, mostra a categoria-mãe ao lado);
   - abaixo, a árvore: categorias como abas/pílulas roláveis e as subcategorias da categoria escolhida como pílulas;
   - **sem opção de criar**; sem resultado → mensagem "Não está na lista oficial. Use ‘Outros …’ ou peça ao suporte".
   - celular (≤ 640 px): abre em painel de tela cheia (`ResponsiveModal` já existe em `src/components/ui/`), pílulas com
     `whitespace-nowrap`, lista com rolagem; nada pode passar da largura (testar em 375 px).
2. `ProductFormModal`: trocar o input `Categoria *` + datalist + `CategoriasProntas` pelo `CategoriaPicker`; enviar
   `subcategoria` (chave). Ao trocar a família, limpar a escolha se não pertencer (regra 7) e avisar com toast.
   Edição de produto antigo sem subcategoria: mostrar aviso "Escolha a subcategoria oficial" e exigir antes de salvar.
3. Busca por nome/BigDataCorp que preenche o formulário: usar `sugestoes.subcategoria` quando vier.
4. `PurchaseOrderModal` (linha ~158 `categoria: s?.categoria || c.categoria || 'Geral'`): mandar `subcategoria` sugerida ou a
   "Outros" da família; nunca 'Geral'.
5. Filtros da lista de produtos: filtro por categoria oficial → subcategoria (mesma árvore).
6. Validar: `node ./node_modules/typescript/bin/tsc -b --force` e `node ./node_modules/vitest/vitest.mjs run`.
   (O `npx tsc --noEmit -p .` NÃO checa nada neste projeto.)

## 5. Conferência visual obrigatória (antes de publicar)
Use página de pré-visualização local com o formulário real e o schema gerado pelo backend (método usado em 31/10:
gerar `src/__schema_mock.json` por um teste pytest que chama `resolver_view_schema`, página `preview-form.html` que troca o
`apiClient.defaults.adapter` por um mock; rodar `node node_modules/vite/bin/vite.js --port 5180`). Conferir em 1366 px e
375 px: nada fora da tela (`document.documentElement.scrollWidth === innerWidth`), botões sem quebrar texto, busca e escolha
funcionando. **Apagar os arquivos de pré-visualização antes do commit.**

## 6. Conversão dos produtos existentes (com aprovação)
1. Comando novo `flask converter-taxonomia --loja <id> [--aplicar]` (registrar em `backend/app/commands.py` dentro de
   `register_commands`, senão não existe no servidor). Sem `--aplicar`: gera CSV `id;nome;familia;categoria_atual;
   subcategoria_sugerida;motivo`. Sugestão: palavras do nome do produto × nomes das subcategorias da família (chave canônica,
   palavra contida); sem casar → "Outros …" e motivo "decidir".
2. Mandar o CSV ao Rafael; ele aprova/ajusta.
3. `--aplicar` com o CSV aprovado: cria tabela de backup `bkp_taxonomia_<data>_produtos (id, categoria_id,
   categoria_oficial, subcategoria_oficial)`, grava tudo numa transação, depois desativa (`ativo=false, deleted_at=now()`)
   as `categorias_produto` da loja sem produto e sem `codigo` oficial. **Nunca apagar linha.**
4. Loja 10 (Capraro Saldão) é cliente real: começar por ela só depois do OK.

## 7. Publicação (siga à risca — cada item já custou queda ou retrabalho)
1. Commit no branch acima; abra **PR novo** contra `master` (push em branch de PR já mergeado NÃO dispara CI).
2. Espere o CI verde nos 3 jobs para o SHA exato do topo.
3. Fast-forward: `git push origin <sha>:refs/heads/master` e `...:refs/heads/main` (só se forem ancestrais).
4. Backend (VM Oracle `144.22.151.18`, chave `Dev/mercadinhosys/scratch/oracle-access.key` +
   `scratch/oracle-known-hosts`, usuário `ubuntu`):
   - `git archive --format=tar <sha> backend infra/oracle` → scp → `/home/ubuntu/mercadinhosys-releases/<sha12>/`
   - build: `sudo docker build --label org.opencontainers.image.revision=<sha completo> -t mercadinhosys-backend:<sha12> .`
     dentro de `backend/` (rodar com `setsid nohup ... & disown`)
   - `ci-proof.json` = `gh api repos/.../actions/runs/<run id do SHA> -q '{path,head_sha,status,conclusion,html_url}'`
     (gerar no bash, não no PowerShell — BOM quebra) → copiar para a pasta da release
   - publicar **somente** com `/home/ubuntu/publicar_backend2.sh <sha12>` via `setsid nohup ... & disown`. O script espera
     não haver outro `release.py`, faz o ensaio (até 2 tentativas; o 1º costuma falhar por timeout de login com a VM sem
     memória), espera 2 min sem gravação e troca. Resultado em `<release>/publicar.out` (linha `FIM: no ar <sha> healthy`).
   - **Nunca** rodar `release.py` direto por `ssh '...'` longo (o comando remoto sobrevive ao cancelamento e gera dois
     deploys em paralelo — derrubou a API por 2 min em 31/10). Nunca `pkill -f` com padrão que case o próprio comando.
   - **Nunca** rodar `create_app()`/`test_client` dentro do container de produção (estoura a memória da VM de 1 GB).
   - Antes: `sudo chown ubuntu:ubuntu /home/ubuntu/mercadinhosys/.release.json` (o script já faz).
   - Rollback: `python3 /home/ubuntu/mercadinhosys-releases/<sha12>/infra/oracle/release.py rollback --release <sha12>`.
5. Frontend (Vercel, projeto `maldivastech/mercadinhosys`): no clone `Dev/mercadinhosys/scratch/entrega-release/frontend-onda0`
   (branch `main`), `git pull --ff-only origin main` (**sem reset**, o Rafael vetou) e
   `npx vercel@latest deploy --prod --yes --scope maldivastech` na raiz do clone. Conferir `https://mercadinhosys.vercel.app/version.json`.
6. Publicar backend antes do frontend (o front novo depende das colunas e do campo `taxonomia`).

## 8. Critérios de aceite (provar em produção, sem subir app no container)
- Cadastro com subcategoria fora da lista → 400; com a lista → 201 (testes automáticos + 1 cadastro real feito pelo Rafael).
- `select nome from categorias_produto where estabelecimento_id=10 and deleted_at is null` → só nomes de categorias oficiais.
- Formulário no celular (375 px) conferido por captura; nada fora da tela.
- Relatório final ao Rafael: SHA, o que foi provado e como, o que NÃO foi provado, comando de rollback.

---

## Anexo A — Taxonomia oficial (Família → Categoria → Subcategorias)

Fontes: Pão de Açúcar (mapa de categorias), Havan (departamentos), regra GS1 GPC. Subcategorias = lista plana aprovada
(`docs/CATEGORIAS_OFICIAIS.md`), agrupada. Toda família tem a categoria **Outros**.

**Mercearia e Alimentos** (`alimento`)
- Básicos da Despensa: Arroz, Feijão, Grãos e Cereais, Massas, Farinhas e Farofas, Açúcar, Adoçantes, Sal, Óleos e Azeites, Granel, Cestas Básicas
- Molhos, Temperos e Conservas: Vinagres, Molhos e Atomatados, Maionese, Ketchup e Mostarda, Temperos e Especiarias, Caldos e Sopas, Enlatados e Conservas, Peixes em Conserva, Pratos Prontos
- Café da Manhã: Café, Chás, Achocolatados, Leite em Pó, Leites, Leites Vegetais, Cereais Matinais, Aveia e Granola, Pães e Bolos Industrializados, Torradas, Doces em Calda e Geleias, Mel
- Biscoitos e Snacks: Biscoitos Doces, Biscoitos Salgados, Snacks e Salgadinhos, Pipoca
- Doces e Sobremesas: Chocolates e Bombons, Balas e Doces, Confeitaria e Sobremesas, Sazonais de Páscoa e Natal
- Saudáveis e Especiais: Saudáveis e Funcionais, Diet e Light, Sem Glúten e Sem Lactose, Étnicos e Importados, Alimentos Infantis
- Outros: Outros Alimentos

**Frios, Laticínios e Congelados** (`frios_congelados`)
- Laticínios: Leites Frescos, Iogurtes, Bebidas Lácteas e Leite Fermentado, Queijos, Requeijão e Queijos Cremosos, Manteigas e Margarinas, Cremes e Chantilly
- Frios e Embutidos: Presunto, Mortadela, Salames, Linguiças, Salsichas, Peito de Peru e Frios Especiais, Defumados, Patês e Antepastos
- Congelados: Massas Frescas, Pratos Prontos Congelados, Pizzas Congeladas, Lanches Congelados, Hambúrgueres e Empanados, Carnes e Aves Congeladas, Vegetais Congelados, Batata Congelada
- Sobremesas Geladas: Sorvetes, Açaí, Polpas de Fruta, Sobremesas Geladas
- Outros: Outros Frios e Congelados

**Hortifrúti, Açougue e Padaria** (`hortifruti_pesaveis`)
- Hortifrúti: Frutas, Frutas Secas, Verduras, Legumes, Temperos Frescos, Cogumelos, Orgânicos, Ovos
- Açougue e Peixaria: Carne Bovina, Carne Suína, Aves, Carnes Temperadas, Miúdos, Peixes, Frutos do Mar, Bacalhau
- Padaria e Rotisseria: Pães Franceses, Pães Especiais, Bolos e Doces de Padaria, Salgados, Confeitaria Gelada, Rotisseria
- Outros: Outros Hortifrúti e Padaria

**Bebidas** (`bebida`)
- Não Alcoólicas: Refrigerantes, Águas Minerais, Águas com Gás, Águas Saborizadas, Sucos Prontos, Sucos Concentrados e Refrescos, Néctares, Chás Prontos, Água de Coco, Bebidas Lácteas, Xaropes, Gelo
- Energéticos e Isotônicos: Energéticos, Isotônicos e Hidratação
- Cervejas: Cervejas, Cervejas Especiais e Artesanais, Cervejas sem Álcool
- Vinhos e Espumantes: Vinhos Tintos, Vinhos Brancos e Rosés, Espumantes
- Destilados e Drinks: Cachaças e Aguardentes, Vodkas, Whiskies, Gin, Licores, Conhaques, Destilados Diversos, Drinks Prontos
- Outros: Outras Bebidas

**Suplementos e Vitaminas** (`suplementos`)
- Vitaminas: Vitaminas, Vitamina C, Vitamina D, Complexo B, Multivitamínicos, Vitaminas Infantis, Vitaminas para Gestantes
- Minerais: Minerais, Magnésio, Zinco, Ferro, Cálcio
- Nutrição Esportiva: Proteínas e Whey, Proteína Vegetal, Creatina, Pré-treino, Termogênicos, BCAA e Aminoácidos, Glutamina, Hipercalóricos, Carboidratos e Gel, Barras de Proteína
- Bem-estar: Ômega 3, Colágeno, Fitoterápicos, Probióticos, Melatonina e Sono, Emagrecimento, Imunidade, Cabelos, Pele e Unhas
- Outros: Outros Suplementos

**Perfumaria e Cosméticos** (`perfumaria_higiene`)
- Perfumes: Perfumes Femininos, Perfumes Masculinos, Colônias Infantis, Body Splash
- Maquiagem e Unhas: Maquiagem Rosto, Maquiagem Olhos, Batons e Lábios, Esmaltes, Unhas e Cutelaria
- Cabelos: Shampoo, Condicionador, Hidratação e Tratamento Capilar, Finalizadores e Fixadores, Coloração de Cabelo, Acessórios de Cabelo
- Corpo e Rosto: Hidratantes Corporais, Cuidados com o Rosto, Proteção Solar, Pós-sol, Óleos Corporais
- Presentes e Acessórios: Kits e Presentes, Necessaires e Acessórios
- Outros: Outros Cosméticos

**Higiene e Cuidados Pessoais** (`higiene`)
- Banho: Sabonetes em Barra, Sabonetes Líquidos, Desodorantes
- Higiene Bucal: Creme Dental, Escovas de Dente, Fio Dental, Enxaguante Bucal
- Higiene Íntima e Descartáveis: Absorventes, Protetores Diários, Papel Higiênico, Lenços de Papel, Higiene Íntima, Fraldas Geriátricas, Algodão e Hastes
- Barbear e Depilação: Barbear e Pós-barba, Depilação
- Saúde e Primeiros Socorros: Álcool em Gel, Curativos e Primeiros Socorros, Preservativos, Repelentes, Pomadas e Cremes, Relaxantes Musculares
- Outros: Outros de Higiene

**Limpeza** (`limpeza`)
- Roupas: Lava-roupas em Pó, Lava-roupas Líquido, Sabão em Barra, Amaciantes, Alvejantes e Tira-manchas, Facilitadores de Passar
- Cozinha: Detergentes, Desengordurantes, Limpa Alumínio e Forno
- Banheiro: Limpador Sanitário, Desinfetantes, Água Sanitária
- Limpeza Geral: Limpadores Multiuso, Limpa Vidros, Álcool de Limpeza, Ceras e Lustra-móveis, Limpa Carpete e Estofado, Inseticidas, Odorizadores e Aromatizadores
- Acessórios de Limpeza: Esponjas e Lã de Aço, Panos e Flanelas, Luvas, Vassouras e Rodos, Mops e Esfregões, Baldes e Bacias, Pás de Lixo, Escovas de Limpeza, Desentupidores, Sacos de Lixo, Lixeiras, Prendedores e Varais
- Outros: Outros de Limpeza

**Bebê e Infantil** (`bebe`)
- Alimentação: Mamadeiras, Bicos e Chupetas, Mordedores, Copos de Transição, Pratos e Talheres Infantis, Leites e Fórmulas Infantis, Papinhas
- Higiene do Bebê: Fraldas Infantis, Lenços Umedecidos, Pomadas para Assaduras, Shampoo e Sabonete Infantil, Higiene Bucal Infantil, Banheiras e Banho, Toalhas e Fraldas de Pano
- Enxoval e Roupas: Enxoval, Roupas de Bebê, Bodies, Meias e Sapatinhos
- Passeio e Segurança: Carrinhos e Cadeirinhas, Bolsas Maternidade, Segurança do Bebê
- Brinquedos de Bebê: Brinquedos de Bebê
- Outros: Outros para Bebê

**Pet Shop** (`pet`)
- Alimentação: Ração para Cães, Ração para Gatos, Ração para Aves, Ração para Peixes, Ração para Roedores e Outros, Ração Úmida e Sachês, Petiscos e Biscoitos
- Higiene e Saúde: Areia Sanitária, Tapetes Higiênicos, Higiene e Banho Pet, Antipulgas e Vermífugos
- Acessórios: Coleiras, Guias e Peitorais, Comedouros e Bebedouros, Camas e Casinhas, Caixas de Transporte, Roupas Pet, Arranhadores, Brinquedos para Pets
- Aves, Peixes e Roedores: Gaiolas e Viveiros, Aquários e Acessórios
- Outros: Outros Pet

**Bazar e Utilidades Domésticas** (`bazar`)
- Cozinha: Panelas, Frigideiras, Panelas de Pressão, Jogos de Panelas, Formas e Assadeiras, Refratários, Utensílios de Cozinha, Facas e Tábuas, Escorredores, Acessórios de Pia
- Mesa: Louças e Aparelhos de Jantar, Pratos, Tigelas e Cumbucas, Copos, Taças, Canecas e Xícaras, Jarras e Suqueiras, Talheres e Faqueiros, Porta-frios e Petisqueiras
- Garrafas e Térmicos: Garrafas e Squeezes, Garrafas Térmicas
- Organização e Armazenamento: Potes e Vasilhas, Potes Herméticos, Porta-mantimentos, Porta-temperos e Saleiros, Organização da Cozinha, Caixas Organizadoras, Cestos e Organizadores, Cabides
- Lavanderia e Banheiro: Lavanderia, Artigos para Banheiro
- Churrasco: Churrasco
- Utilidades Gerais: Velas e Fósforos, Pilhas e Baterias, Utilidades Diversas
- Outros: Outras Utilidades

**Cama, Mesa e Banho** (`cama_mesa_banho`)
- Cama: Jogos de Lençol, Lençóis Avulsos, Fronhas, Colchas e Cobre-leitos, Edredons, Cobertores e Mantas, Travesseiros, Protetores de Colchão, Saias de Cama, Cama Infantil
- Banho: Toalhas de Banho, Toalhas de Rosto, Jogos de Toalhas, Toalhas de Praia, Roupões, Tapetes de Banheiro
- Mesa e Cozinha: Toalhas de Mesa, Jogos Americanos, Caminhos de Mesa, Panos de Prato, Guardanapos de Tecido
- Outros: Outros Cama, Mesa e Banho

**Decoração e Casa** (`decoracao`)
- Parede: Quadros e Decoração de Parede, Porta-retratos, Espelhos, Relógios de Parede, Adesivos de Parede, Nichos e Prateleiras
- Decoração de Ambientes: Vasos Decorativos, Flores e Plantas Artificiais, Enfeites e Esculturas, Decoração de Mesa, Cestas Decorativas
- Aromas e Iluminação: Velas Decorativas, Difusores e Aromatizadores, Luminárias e Abajures
- Têxteis de Decoração: Cortinas e Persianas, Tapetes, Almofadas, Capas de Sofá
- Datas Comemorativas: Decoração de Natal, Decoração de Páscoa, Datas Comemorativas
- Outros: Outros Decoração

**Jardinagem e Plantas** (`jardinagem`)
- Plantas e Sementes: Plantas Ornamentais, Suculentas e Cactos, Flores, Mudas Frutíferas, Mudas de Hortaliças, Sementes
- Terra, Adubos e Pragas: Terra e Substratos, Adubos e Fertilizantes, Defensivos e Controle de Pragas
- Vasos e Suportes: Vasos Plásticos, Vasos de Cerâmica e Barro, Cachepôs, Pratos para Vaso, Suportes e Jardim Vertical
- Ferramentas e Irrigação: Ferramentas de Jardim, Regadores, Mangueiras e Esguichos, Irrigação, Cortadores e Roçadeiras
- Paisagismo e Lazer: Grama e Paisagismo, Decoração de Jardim, Piscina
- Outros: Outros Jardinagem

**Festas e Descartáveis** (`embalagem_descartavel`)
- Descartáveis de Mesa: Copos Descartáveis, Pratos Descartáveis, Talheres Descartáveis, Guardanapos de Papel, Toalhas Descartáveis, Canudos, Palitos
- Embalagens e Delivery: Marmitex e Embalagens Delivery, Potes Descartáveis com Tampa, Sacolas, Sacos para Alimentos, Embalagens para Presente, Forminhas e Embalagens para Doces
- Cozinha Descartável: Papel Toalha, Filme PVC e Papel Alumínio, Coadores de Papel
- Festa: Balões, Velas de Aniversário, Artigos para Festa, Decoração de Festa, Lembrancinhas, Confeitaria Decorativa
- Outros: Outros Descartáveis e Festa

**Papelaria e Escritório** (`papelaria`)
- Cadernos e Papéis: Cadernos, Fichários e Refis, Agendas e Planners, Blocos e Post-its, Papel Sulfite, Papéis Especiais e Cartolinas, Envelopes
- Escrita e Cores: Canetas, Lápis e Lapiseiras, Borrachas e Apontadores, Marca-textos, Lápis de Cor e Giz de Cera, Canetinhas e Hidrocor, Tintas e Pincéis
- Material Escolar: Estojos, Mochilas Escolares, Lancheiras e Garrafas Escolares, Réguas e Geometria, Colas, Tesouras e Estiletes, Livros de Colorir e Atividades
- Escritório: Pastas e Arquivos, Grampeadores, Clipes e Elásticos, Fitas Adesivas, Calculadoras, Material de Escritório
- Artesanato e Presentes: Artesanato, Papel de Presente
- Outros: Outros Papelaria

**Brinquedos** (`brinquedos`)
- Bonecas e Bonecos: Bonecas e Acessórios, Bonecos e Figuras de Ação, Pelúcias
- Veículos: Carrinhos, Pistas e Veículos, Controle Remoto
- Jogos: Jogos de Tabuleiro, Jogos de Cartas e Raciocínio, Quebra-cabeças
- Educativos e Criativos: Didáticos e Educativos, Blocos de Montar, Artes, Pintura e Massinha, Instrumentos Musicais
- Ao Ar Livre: Bolhas de Sabão, Brinquedos Esportivos, Bolas Infantis, Bicicletas, Patinetes e Patins, Piscinas e Infláveis, Lançadores e Armas d'Água
- Bebê e Eletrônicos: Brinquedos para Bebê, Brinquedos Eletrônicos
- Fantasias e Acessórios: Fantasias, Bijuterias Infantis, Brinquedos Econômicos
- Outros: Outros Brinquedos

**Eletroportáteis e Eletrodomésticos** (`eletro`)
- Eletroportáteis de Cozinha: Air Fryers e Fritadeiras, Batedeiras, Cafeteiras Elétricas, Chaleiras Elétricas, Espremedores, Grill e Sanduicheiras, Liquidificadores, Mixers, Panelas Elétricas, Pipoqueiras, Processadores, Torradeiras, Fornos Elétricos, Micro-ondas, Crepeiras e Waffle, Panificadoras, Balanças de Cozinha
- Cuidados com a Casa: Aspiradores, Ferros de Passar, Passadeiras a Vapor, Máquinas de Costura
- Água: Bebedouros e Purificadores, Bombas para Garrafão
- Climatização: Ventiladores, Aquecedores, Climatizadores e Umidificadores, Ar-condicionado
- Beleza: Secadores de Cabelo, Chapinhas e Escovas, Barbeadores e Aparadores
- Eletrodomésticos: Geladeiras e Freezers, Fogões e Cooktops, Lavadoras e Secadoras, Lava-louças, Coifas e Depuradores, Duchas e Torneiras Elétricas
- Outros: Outros Eletro

**Eletrônicos, Celulares e Informática** (`eletronicos`)
- Celulares e Acessórios: Celulares e Smartphones, Carregadores, Cabos e Adaptadores, Capinhas, Películas, Power Banks, Suportes de Celular, Smartwatches
- Áudio: Fones de Ouvido, Caixas de Som
- Informática: Notebooks e Tablets, Mouses e Teclados, Acessórios de Informática, Pen Drives e Cartões de Memória
- TV, Games e Casa Inteligente: Smart TVs, Antenas e Controles Remotos, Games e Acessórios, Casa Inteligente, Câmeras e Segurança
- Energia: Pilhas e Baterias Recarregáveis
- Outros: Outros Eletrônicos

**Ferramentas** (`ferramentas`)
- Ferramentas Manuais: Ferramentas Manuais, Chaves de Fenda e Phillips, Chaves Combinadas e Allen, Alicates, Martelos e Marretas, Serrotes e Serras Manuais
- Medição: Trenas e Medição, Níveis
- Ferramentas Elétricas: Ferramentas Elétricas, Furadeiras e Parafusadeiras, Lixadeiras e Esmerilhadeiras, Serras Elétricas, Compressores e Lavadoras de Pressão, Soldas
- Acessórios: Brocas, Bits e Discos, Caixas e Maletas de Ferramentas, Fitas e Vedantes, Colas e Silicones
- Segurança e Acesso: EPI e Segurança, Escadas
- Outros: Outras Ferramentas

**Construção — Leve, Elétrica, Hidráulica, Ferragem, Tintas; Moda; Calçados; Acessórios; Esporte; Automotivo; Tabacaria**
(`construcao_leve`, `construcao_eletrica`, `construcao_hidraulica`, `construcao_ferragem`, `tintas`, `vestuario`, `calcados`,
`acessorios`, `esporte`, `autopecas`, `tabacaria`): listas menores. Regra de agrupamento para o executor seguir **exatamente**:
use uma categoria por família com o mesmo nome da família (ex.: categoria "Elétrica" contendo todas as subcategorias de
`construcao_eletrica` hoje em `CATEGORIAS_OFICIAIS`), mais a categoria "Outros" com a subcategoria "Outros …" que já existe.
Exceções: `vestuario` → Feminino (Blusas, Vestidos, Saias, Moda Íntima Feminina, Sutiãs), Masculino (Camisas, Cuecas),
Unissex e Básicos (Camisetas, Regatas, Calças, Jeans, Bermudas, Shorts, Macacões, Moletons, Jaquetas e Casacos, Pijamas e
Camisolas, Meias, Uniformes), Infantil e Bebê (Moda Infantil, Moda Bebê), Praia e Fitness (Moda Praia, Moda Fitness), Plus
Size (Plus Size), Outros; `autopecas` → Motor e Transmissão (Motor, Transmissão, Filtros, Óleos e Lubrificantes, Aditivos e
Fluidos), Freios e Suspensão (Freios, Suspensão), Elétrica Automotiva (Elétrica Automotiva, Lâmpadas Automotivas, Baterias,
Som Automotivo), Pneus (Pneus e Câmaras), Acessórios e Limpeza (Acessórios Internos, Acessórios Externos, Tapetes
Automotivos, Limpeza Automotiva), Moto (Moto Peças, Capacetes), Outros.

**Serviço** (`servico`) — nova: Serviços Gerais (Serviços Gerais, Manutenção, Instalação), Taxas (Taxas e Entregas), Outros (Outros Serviços).
