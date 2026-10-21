# Guia de implantação — Loja mista (quinta-feira)

## 1) O que está pronto e provado
- Produção no commit af6db160: CI verde, ensaio em clone do banco, backup validado.
- Teste automatizado ponta a ponta (15 passos) aprovado: loja genérica; importação 7/7 (leite, shampoo, perfume, camiseta, feijão a granel 8,5 kg, liquidificador, item sem estoque); código interno EAN-13 prefixo 20 para item sem código; abertura de caixa; venda mista com 0,5 kg de granel; F9 duplo não duplica; baixa de estoque correta; item sem estoque recusado com "Estoque insuficiente"; cancelamento devolve estoque; fechamento de caixa; outra loja não vê o comprovante.
- Navegador local: importação 30/30; 14 códigos internos; tela de caixa legível; F9 três vezes = 1 venda; comprovante com TROCO grande.
- Cadastro por "Novo Produto" provado em produção.
- Leitura de EAN preenche nome, marca e foto pelas bases abertas (Open Food/Beauty/Products Facts), sem cota e sem mensagem de limite; código inexistente nas bases pede preenchimento manual.
- Vendas fecham com "Comprovante (não fiscal)".

## 2) Antes de sair
- Importar a planilha de exemplo em uma loja de teste na produção e conferir a contagem em Produtos.
- Separar impressora de etiquetas e leitor USB.
- Decidir com o cliente "permitir venda sem estoque" (Configurações).
- Pedir ao cliente os XML das últimas notas dos fornecedores (eles mandam por e-mail) — entrada de estoque por nota.

## 3) Na loja
1. Selecionar segmento genérico.
2. Configurar "permitir venda sem estoque" conforme o cliente.
3. Cadastrar por planilha, por XML de nota de fornecedor ou por "Novo Produto".
4. Conferir a contagem em Produtos.
5. Gerar etiquetas.
6. Testar a leitura do código interno no PDV.
7. Abrir caixa.
8. Vender: bipar; granel pesar (0,5 kg ok).
9. F9 uma vez; conferir o comprovante (não fiscal).
10. Testar cancelamento.
11. Fechar caixa.

## 4) Cada tipo de item
- "Novo Produto" tem "Estoque inicial" e "Sem código? Gerar código interno"; bipar EAN preenche nome/marca/foto.
- Alimentos e granel: família Alimento; granel em KG.
- Perfumaria: família Perfumaria e Higiene.
- Roupas: família Vestuário; um produto por tamanho e cor ("Camiseta Preta M"), cada um com código interno e etiqueta; sem grade de variação.
- Eletrodomésticos: família Eletro e Eletroportáteis; a maioria tem EAN de fábrica.
- Planilha: baixar template na tela de importação; separador `;`; colunas `nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;marca;unidade;estoque;lote;data_validade;ncm` (família opcional); vírgula decimal ok; coluna `codigo_barras` como Texto no Excel; salvar CSV (não .xlsx); uma linha por item; EAN duplicado recusado mostrando a linha do Excel; erros listados por linha.
- Nota de fornecedor (XML): entrada de estoque com custo e criação dos produtos novos; a mesma nota não entra duas vezes. Ler a chave/QR da DANFE confere se a nota já entrou; o download automático do XML pela chave exige certificado digital (fica para depois).

## 5) Etiquetas
- Produtos → Etiquetas (e "Imprimir etiqueta" logo após cadastrar).
- Busca por nome ou leitor USB; cópias.
- Térmica 40×25, 50×30, 60×40 mm e A4 Pimaco A4256 (21/folha) e A4351 (65/folha).
- Prévia; ajuste vertical/horizontal em mm.
- Gera código para quem não tem; código interno lido no PDV.
- Impressão física não testada em impressora real.

## 6) Plano B
Se a planilha ou o XML falharem, cadastrar pelo "Novo Produto".

## 7) Limites conhecidos
- Impressão física não testada.
- Roupas sem grade.
- Download do XML pela chave/QR exige certificado digital A1 (depois de quinta).
- Emissão de NFC-e/NF-e: fora do plano atual (módulo à parte).
