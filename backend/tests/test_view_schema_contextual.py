from flask_jwt_extended import create_access_token

from app.models import CategoriaProduto, Configuracao, Estabelecimento, Produto
from app.services.view_schema_service import (
    mix_permitido_para_estabelecimento,
    normalizar_familia_produto,
    resolver_view_schema,
)


def test_schema_contextual_respeita_mix_customizado(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "mercearia"
    estab.configuracoes = {"mix_produtos": ["bazar", "alimento"]}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="bazar")

    assert schema["familia_produto"]["chave"] == "bazar"
    assert schema["familia_produto"]["perfil_fiscal_padrao"] == "bazar_padrao"
    assert schema["mix_permitido"] == ["bazar", "alimento"]
    assert schema["flags"]["usa_validade"] is False
    assert schema["flags"]["usa_embalagens"] is True


def test_familia_inexistente_faz_fallback_para_primeiro_item_do_mix(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "mercearia"
    estab.configuracoes = {"mix_produtos": ["bazar", "alimento"]}
    session.commit()

    familia = normalizar_familia_produto(
        familia_produto="nao_existe",
        estabelecimento=estab,
        tipo_item="produto",
    )

    assert mix_permitido_para_estabelecimento(estab) == ["bazar", "alimento"]
    assert familia == "bazar"


def test_familia_valida_fora_dos_departamentos_mantem_o_formulario_dela(session):
    # Loja 10 (outlet): produto de cama/mesa não pode abrir com formulário de autopeça só
    # porque o departamento dele não está ligado.
    estab = session.query(Estabelecimento).first()
    estab.segmento = "autopecas"
    estab.configuracoes = {"mix_produtos": ["autopecas", "servico"]}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="cama_mesa_banho")

    assert schema["familia_produto"]["chave"] == "cama_mesa_banho"
    assert schema["flags"]["usa_validade"] is False


def test_comercio_geral_tem_autopecas_e_todas_as_familias_configuraveis(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    estab.configuracoes = {}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="autopecas")

    assert "autopecas" in schema["mix_permitido"]
    assert schema["familia_produto"]["chave"] == "autopecas"
    configuraveis = {f["chave"] for f in schema["familias_configuraveis"]}
    from app.services.view_schema_service import FAMILIAS_PRODUTO
    assert configuraveis == set(FAMILIAS_PRODUTO)


def test_servico_forca_familia_e_perfil_fiscal_de_servico(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "autopecas"
    estab.configuracoes = {"mix_produtos": ["autopecas", "servico"]}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="autopecas", tipo_item="servico")

    assert schema["familia_produto"]["chave"] == "servico"
    assert schema["familia_produto"]["perfil_fiscal_padrao"] == "servico"
    assert "servico" in schema["tipos_item"]
    assert schema["flags"]["usa_servicos"] is True


def test_mix_customizado_aceita_qualquer_departamento_e_descarta_chave_invalida(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "mercearia"
    estab.configuracoes = {"mix_produtos": ["autopecas", "bazar", "xpto", "servico", "alimento"]}
    session.commit()

    assert mix_permitido_para_estabelecimento(estab) == ["autopecas", "bazar", "servico", "alimento"]


def test_schema_sem_servico_no_mix_desabilita_tipo_item_servico(session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    estab.configuracoes = {"mix_produtos": ["bazar"]}
    session.commit()

    schema = resolver_view_schema(estab, familia_produto="bazar", tipo_item="servico")

    assert schema["tipos_item"] == ["produto"]
    assert schema["familia_produto"]["chave"] == "bazar"


def test_configuracao_to_dict_expoe_flag_de_foto_no_pdv(session):
    config = Configuracao(estabelecimento_id=1, mostrar_foto_produto_pdv=True)

    data = config.to_dict()

    assert data["mostrar_foto_produto_pdv"] is True


def test_produto_to_dict_expoe_familia_perfil_e_atributos(session):
    estab = session.query(Estabelecimento).first()
    categoria = CategoriaProduto(nome="Bazar", estabelecimento_id=estab.id)
    session.add(categoria)
    session.flush()
    produto = Produto(
        estabelecimento_id=estab.id,
        nome="Forma Antiaderente",
        categoria_id=categoria.id,
        preco_custo=10,
        preco_venda=19.9,
        quantidade=5,
        quantidade_minima=1,
        unidade_medida="un",
        familia_produto="bazar",
        perfil_fiscal="bazar_padrao",
    )
    produto.atributos = {"embalagem": "Unidade"}
    session.add(produto)
    session.commit()

    data = produto.to_dict()

    assert data["familia_produto"] == "bazar"
    assert data["perfil_fiscal"] == "bazar_padrao"
    assert data["atributos"] == {"embalagem": "Unidade"}


def test_route_overrides_salva_mix_produtos_sanitizado(client, session):
    estab = session.query(Estabelecimento).first()
    token = create_access_token(
        identity="1",
        additional_claims={"estabelecimento_id": estab.id, "role": "admin"},
    )
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.put(
        "/api/view-schema/overrides",
        json={"mix_produtos": ["bazar", "autopecas", "chave_que_nao_existe", "servico"]},
        headers=headers,
    )

    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert resp.get_json()["schema"]["mix_permitido"] == ["bazar", "autopecas", "servico"]

    base = client.get("/api/view-schema/?base=1", headers=headers)
    assert base.status_code == 200, base.get_data(as_text=True)
    assert base.get_json()["overrides"]["mix_produtos"] == ["bazar", "autopecas", "servico"]


def test_trocar_segmento_nao_tira_departamento_da_loja(client, session):
    estab = session.query(Estabelecimento).first()
    estab.segmento = "generico"
    estab.configuracoes = {"mix_produtos": ["cama_mesa_banho", "higiene", "bazar"]}
    session.commit()
    token = create_access_token(
        identity="1",
        additional_claims={"estabelecimento_id": estab.id, "role": "admin"},
    )

    resp = client.put("/api/view-schema/segmento", json={"segmento": "autopecas"},
                      headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200, resp.get_data(as_text=True)
    mix = resp.get_json()["schema"]["mix_permitido"]
    assert mix[:3] == ["cama_mesa_banho", "higiene", "bazar"]
    assert "autopecas" in mix and "servico" in mix
