"""Cadastro especialista (05/11/2026): o sistema sabe o que está cadastrando.

Casos reais: câmara de ar da Vera (loja 10), condicionador e "câmera de ar" que o Consultor errou,
vela 7 dias que virou "vela de aniversário", lâmina que pedia validade, serviço de assistência de
celular, e o chat que inventava preço.
"""
from decimal import Decimal

import pytest
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario, MovimentacaoEstoque, Produto
from app.services.classificador_produto import classificar
from app.services.perfil_subcategoria import (NAO_SE_APLICA, OBRIGATORIA, OPCIONAL, flags_efetivas,
                                              ncm_provavel, regra_validade)
from app.services.catalogo_familias import chave_subcategoria


def _headers(funcionario, role="ADMIN"):
    token = create_access_token(identity=str(funcionario.id), additional_claims={
        "estabelecimento_id": funcionario.estabelecimento_id, "role": role,
        "is_super_admin": bool(funcionario.is_super_admin)})
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------- classificador (sem IA, sem banco)
@pytest.mark.parametrize("nome, familia, sub", [
    ("CÂMERA DE AR MOTOCICLETA", "motopecas", "Câmaras de Ar de Moto"),
    ("moto peça (camara de pneu)", "motopecas", "Câmaras de Ar de Moto"),
    ("Pneu traseiro 90/90-18 CG 160", "motopecas", "Pneus de Moto"),
    ("Pastilha de freio dianteira Titan 150 Cobreq", "motopecas", "Pastilhas de Freio de Moto"),
    ("Pastilha de freio Gol G5", "autopecas", "Pastilhas e Lonas"),
    ("CORPO DE BORBOLETA TBI COROLLA", "autopecas", "Corpo de Borboleta (TBI)"),
    ("Kit relação CG 160 Vaz", "motopecas", "Kit Relação"),
    ("Condicionador Seda 325ml", "perfumaria_higiene", "Condicionador"),
    ("Lâmina de sobrancelha Diane", "higiene", "Lâminas e Aparelhos"),
    ("VELA RUBRO-NEGRA 7 DIAS", "religioso", "Vela 7 Dias"),
    ("Imagem Iemanjá gesso 40cm pintada", "religioso", "Orixás"),
    ("Guia de Oxum cristal amarela", "religioso", "Guias e Fios de Conta"),
    ("Tela frontal Galaxy A12 incell", "eletronicos", "Telas e Frontais"),
])
def test_classificador_acerta_casos_reais(nome, familia, sub):
    r = classificar(nome, usar_ia=False)
    assert (r["familia_produto"], r["categoria_nome"]) == (familia, sub)
    assert r["subcategoria"].startswith(f"{familia}.")


@pytest.mark.parametrize("nome, familia_errada", [
    ("Toalha de banho de rosto", "religioso"),     # "banho de" não é banho ritualístico
    ("Guia de cachorro retrátil", "religioso"),    # "guia de" não é fio de conta
    ("Taça de cristal", "religioso"),              # cristal de mesa não é pedra
    ("Charuto cubano", "religioso"),               # tabacaria continua tabacaria
])
def test_classificador_nao_confunde_palavra_parecida(nome, familia_errada):
    assert classificar(nome, usar_ia=False)["familia_produto"] != familia_errada


def test_classificador_le_medida_aro_montadora_e_marca_da_camara():
    r = classificar("Camara de ar 3.00-18 Titan 150 Pirelli", usar_ia=False)
    assert r["atributos"]["medida_pneu"] == "3.00-18"
    assert r["atributos"]["aro"] == 18
    assert r["atributos"]["montadora"] == "Honda"
    assert "Pirelli" not in r["atributos"]["veiculo_compativel"]
    assert r["marca"] == "PIRELLI"
    assert r["ncm"] == "40139000"


def test_classificador_vela_e_imagem_religiosa_preenchem_o_que_importa():
    vela = classificar("Vela 7 dias vermelha 260g", usar_ia=False)
    assert vela["atributos"]["tempo_queima_h"] == 168
    assert vela["atributos"]["cor"] == "Vermelho"
    assert vela["ncm"] == "34060000"
    imagem = classificar("Imagem São Jorge resina 30cm", usar_ia=False)
    assert imagem["atributos"]["altura_cm"] == 30
    assert imagem["atributos"]["entidade"] == "São Jorge"
    assert imagem["atributos"]["material"] == "Resina"
    assert imagem["ncm"] == "39264000"
    gesso = classificar("Imagem Iemanjá gesso 40cm", usar_ia=False)
    assert gesso["ncm"] == "68099000"  # NCM segue o material


def test_servico_fica_na_familia_servico_com_garantia_de_assistencia():
    # Antes: "troca de tela" caía em Eletrônicos › Telas de Projeção.
    r = classificar("Troca de tela iPhone 11", tipo_item="servico", usar_ia=False)
    assert r["familia_produto"] == "servico"
    assert r["categoria_nome"] == "Troca de Tela e Frontal"
    assert r["atributos"]["aparelho_atendido"] == "Iphone 11"
    assert r["atributos"]["garantia_dias"] == 90


def test_sem_pista_cai_em_outros_da_familia_e_nunca_inventa():
    r = classificar("XPTO 123", usar_ia=False, mix=["bazar"])
    assert r["confianca"] == "baixa"
    assert r["categoria_nome"].startswith("Outr")


# ---------------------------------------------------------------- validade por subcategoria
def test_validade_por_subcategoria_refina_a_familia():
    flags_higiene = {"usa_validade": True, "usa_lotes": True, "validade_obrigatoria": True}
    lamina = chave_subcategoria("higiene", "Barbear e Depilação", "Lâminas e Aparelhos")
    creme = chave_subcategoria("higiene", "Higiene Bucal", "Creme Dental")
    assert regra_validade(lamina, flags_higiene) == NAO_SE_APLICA
    assert regra_validade(creme, flags_higiene) == OBRIGATORIA
    assert flags_efetivas(lamina, flags_higiene)["usa_validade"] is False

    flags_religioso = {"usa_validade": False, "usa_lotes": False, "validade_obrigatoria": False}
    vela = chave_subcategoria("religioso", "Velas", "Vela 7 Dias")
    banho = chave_subcategoria("religioso", "Ervas, Banhos e Defumação", "Banhos Prontos")
    erva = chave_subcategoria("religioso", "Ervas, Banhos e Defumação", "Ervas para Banho e Defumação")
    assert regra_validade(vela, flags_religioso) == NAO_SE_APLICA
    assert regra_validade(banho, flags_religioso) == OBRIGATORIA
    assert regra_validade(erva, flags_religioso) == OPCIONAL
    efetivas = flags_efetivas(banho, flags_religioso)
    assert efetivas["validade_obrigatoria"] is True and efetivas["usa_lotes"] is True


def test_ncm_provavel_de_moto_nao_e_o_de_carro():
    assert ncm_provavel(chave_subcategoria("motopecas", "Freios", "Pastilhas de Freio de Moto")) == "87141000"
    assert ncm_provavel(chave_subcategoria("autopecas", "Freios e Suspensão", "Pastilhas e Lonas")) == "68138110"


# ---------------------------------------------------------------- schema e rotas
def test_schema_traz_perfis_e_opcoes_de_montadora_por_familia(session):
    from app.services.view_schema_service import resolver_view_schema
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    estab.configuracoes = {}
    session.commit()

    moto = resolver_view_schema(estab, familia_produto="motopecas")
    carro = resolver_view_schema(estab, familia_produto="autopecas")
    montadora_moto = next(c for c in moto["campos"] if c["chave"] == "montadora")
    montadora_carro = next(c for c in carro["campos"] if c["chave"] == "montadora")
    assert "Yamaha" in montadora_moto["opcoes"] and "Toyota" not in montadora_moto["opcoes"]
    assert "Toyota" in montadora_carro["opcoes"] and "Yamaha" not in montadora_carro["opcoes"]
    chaves_moto = {c["chave"] for c in moto["campos"]}
    assert {"medida_pneu", "aro", "cilindrada", "codigo_fabricante"} <= chaves_moto
    assert "controlar_validade" not in chaves_moto

    religioso = resolver_view_schema(estab, familia_produto="religioso")
    banho = chave_subcategoria("religioso", "Ervas, Banhos e Defumação", "Banhos Prontos")
    assert religioso["perfis_subcategoria"][banho]["validade"] == OBRIGATORIA
    assert {"entidade", "altura_cm", "tempo_queima_h", "regularizacao_sanitaria"} <= {
        c["chave"] for c in religioso["campos"]}


def test_cadastro_de_banho_ritualistico_com_estoque_exige_validade(client, session):
    admin = session.query(Funcionario).first()
    estab = session.get(Estabelecimento, admin.estabelecimento_id)
    estab.segmento = "generico"
    estab.configuracoes = {}
    session.commit()
    banho = chave_subcategoria("religioso", "Ervas, Banhos e Defumação", "Banhos Prontos")
    payload = {"nome": "BANHO DE ARRUDA 500ML", "familia_produto": "religioso", "subcategoria": banho,
               "preco_custo": 5, "preco_venda": 12, "quantidade": 10, "unidade_medida": "UN"}
    resp = client.post("/api/produtos/", json=payload, headers=_headers(admin))
    assert resp.status_code == 400, resp.get_data(as_text=True)
    assert "validade" in resp.get_json()["message"].lower()


def test_familia_fora_dos_departamentos_cadastra_e_vela_nao_pede_validade(client, session):
    # Loja nasceu "mercearia" (sem Artigos Religiosos ligado): a vela entra mesmo assim, sem validade.
    admin = session.query(Funcionario).first()
    estab = session.get(Estabelecimento, admin.estabelecimento_id)
    estab.segmento = "mercearia"
    estab.configuracoes = {}
    session.commit()
    vela = chave_subcategoria("religioso", "Velas", "Vela 7 Dias")
    payload = {"nome": "VELA 7 DIAS VERMELHA 260G", "familia_produto": "religioso", "subcategoria": vela,
               "preco_custo": 4, "preco_venda": 9.9, "quantidade": 10, "unidade_medida": "UN",
               "atributos": {"cor": "Vermelho", "tempo_queima_h": 168}}
    resp = client.post("/api/produtos/", json=payload, headers=_headers(admin))
    assert resp.status_code == 201, resp.get_data(as_text=True)
    produto = session.query(Produto).filter_by(nome="VELA 7 DIAS VERMELHA 260G").one()
    assert produto.familia_produto == "religioso" and produto.controlar_validade is False
    assert session.query(MovimentacaoEstoque).filter_by(produto_id=produto.id, tipo="entrada").count() == 1


def test_campos_do_formulario_seguem_a_subcategoria():
    from app.services.perfil_subcategoria import campos_da_subcategoria
    camara = campos_da_subcategoria(chave_subcategoria("motopecas", "Pneus e Rodas", "Câmaras de Ar de Moto"))
    vela = campos_da_subcategoria(chave_subcategoria("religioso", "Velas", "Vela 7 Dias"))
    banho = campos_da_subcategoria(chave_subcategoria("religioso", "Ervas, Banhos e Defumação", "Banhos Prontos"))
    imagem = campos_da_subcategoria(chave_subcategoria("religioso", "Imagens e Estátuas", "Orixás"))
    assert {"medida_pneu", "aro", "tipo_valvula"} <= set(camara) and "cilindrada" not in camara
    assert {"tempo_queima_h", "tipo_pavio", "cor"} <= set(vela) and "altura_cm" not in vela
    assert "regularizacao_sanitaria" in banho and "tempo_queima_h" not in banho
    assert {"entidade", "altura_cm", "material", "acabamento_imagem"} <= set(imagem)


def test_endpoint_classificar_ia_reconhece_camara_de_ar(client, session):
    admin = session.query(Funcionario).first()
    resp = client.post("/api/produtos/classificar-ia", headers=_headers(admin),
                       json={"nome": "Câmara de ar 2.75-18 Fan 150"})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    s = resp.get_json()["sugestao"]
    assert s["familia_produto"] == "motopecas"
    assert s["atributos"]["medida_pneu"] == "2.75-18"
    assert s["ncm"] == "40139000"


# ---------------------------------------------------------------- Consultor
def test_chat_sem_preco_nao_oferece_cadastro_e_nao_inventa_valor(session):
    from app.services.consultor.acoes import sugerir_acoes
    admin = session.query(Funcionario).first()
    acoes = sugerir_acoes(admin.estabelecimento_id, "geral", is_manager=True,
                          pergunta="como eu cadastro câmara de ar aro 18?")
    assert not any(a["acao"] == "cadastrar_produto" for a in acoes)


def test_chat_cadastra_com_preco_informado_e_registra_entrada_de_estoque(session):
    from app.services.consultor.acoes import executar_acao_confirmada
    admin = session.query(Funcionario).first()
    params = {"nome": "Kit relação CG 160", "preco_custo": 80, "preco_venda": 140, "quantidade": 3}
    resultado = executar_acao_confirmada(acao="cadastrar_produto", parametros=params,
                                         estabelecimento_id=admin.estabelecimento_id, funcionario_id=admin.id)
    corpo = resultado[0] if isinstance(resultado, tuple) else resultado
    assert corpo.get("success") is True, corpo
    produto = session.query(Produto).filter(Produto.nome == "KIT RELAÇÃO CG 160").one()
    assert produto.familia_produto == "motopecas"
    assert produto.preco_custo == Decimal("80.00")
    mov = session.query(MovimentacaoEstoque).filter_by(produto_id=produto.id, tipo="entrada").one()
    assert mov.quantidade == Decimal("3")


def test_chat_recusa_preco_vazio(session):
    from app.services.consultor.acoes import executar_acao_confirmada
    admin = session.query(Funcionario).first()
    resultado = executar_acao_confirmada(acao="cadastrar_produto", parametros={"nome": "Vela 7 dias branca"},
                                         estabelecimento_id=admin.estabelecimento_id, funcionario_id=admin.id)
    corpo, status = resultado
    assert status == 400 and "custo" in corpo["error"].lower()


def test_evidencia_de_classificacao_responde_a_pergunta_do_condicionador(session):
    from app.services.consultor.contextos.sistema import classificacao_para_pergunta
    admin = session.query(Funcionario).first()
    ev = classificacao_para_pergunta("Como eu faço para cadastrar um condicionador", admin.estabelecimento_id)
    assert ev["subcategoria_oficial"] == "Condicionador"
    assert "Mercearia" not in ev["familia"]
