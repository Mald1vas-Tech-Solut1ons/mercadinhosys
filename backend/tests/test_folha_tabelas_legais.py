"""Folha: tabelas legais por competência, IRRF 2026 (Lei 15.270/2025), dependentes, teto do VT e rescisão."""
from datetime import date
from decimal import Decimal

import pytest

from app.models import Beneficio, ConfiguracaoFolha, Funcionario, FuncionarioBeneficio
from app.services.rh_calculator_service import calcular_holerite, calcular_inss, calcular_irrf, calcular_rescisao
from app.services.tabelas_folha import calcular_irrf_mensal, parametros_folha


def _ir(rendimento, competencia, dependentes=0, config=None):
    params = parametros_folha(config, competencia)
    inss = calcular_inss(rendimento, params["inss_faixas"])
    return inss, calcular_irrf_mensal(rendimento, inss, dependentes, params, calcular_irrf)


# ───────────────────────── vigência das tabelas ─────────────────────────

def test_cada_competencia_usa_a_tabela_da_sua_vigencia():
    assert parametros_folha(None, "2026-03")["inss_faixas"][-1]["ate"] == 8475.55
    assert parametros_folha(None, "2025-06")["inss_faixas"][-1]["ate"] == 8157.41
    assert parametros_folha(None, "2024-03")["inss_faixas"][-1]["ate"] == 7786.02
    # Antes da primeira vigência cadastrada vale a mais antiga.
    assert parametros_folha(None, "2023-12")["inss_faixas"][-1]["ate"] == 7786.02
    assert parametros_folha(None, "2026-03")["reducao"] is not None
    assert parametros_folha(None, "2025-12")["reducao"] is None


def test_irrf_simplificado_muda_de_valor_em_maio_de_2025():
    assert parametros_folha(None, "2025-04")["simplificado"] == 564.80
    assert parametros_folha(None, "2025-05")["simplificado"] == 607.20


def test_tabela_personalizada_da_loja_prevalece_sobre_a_legal():
    personalizada = ConfiguracaoFolha(inss_faixas=[{"ate": 5000, "aliquota": 10}],
                                      irrf_faixas=[{"ate": None, "aliquota": 10, "deducao": 0}])
    params = parametros_folha(personalizada, "2026-03")
    assert params["inss_faixas"] == [{"ate": 5000, "aliquota": 10}]
    assert params["personalizada"] == {"inss": True, "irrf": True}


def test_tabela_padrao_gravada_na_loja_segue_a_lei_da_competencia():
    """A loja que só tem o padrão antigo gravado no cadastro não fica presa a ele."""
    from app.models import INSS_FAIXAS_PADRAO, IRRF_FAIXAS_PADRAO
    padrao_antigo = ConfiguracaoFolha(inss_faixas=list(INSS_FAIXAS_PADRAO), irrf_faixas=list(IRRF_FAIXAS_PADRAO))
    params = parametros_folha(padrao_antigo, "2026-03")
    assert params["inss_faixas"][-1]["ate"] == 8475.55
    assert params["personalizada"] == {"inss": False, "irrf": False}


# ───────────────────────── IRRF: valores de referência ─────────────────────────

@pytest.mark.parametrize("rendimento, inss_esperado, ir_esperado", [
    (2000, "155.69", "0.00"),
    (5000, "501.51", "0.00"),     # até 5.000 o imposto zera (redução igual ao imposto da tabela)
    (6000, "641.51", "385.10"),   # 564,85 da tabela − 179,75 de redução
    (7000, "781.51", "754.75"),   # redução menor, decrescendo
    (8000, "921.51", "1037.85"),  # acima de 7.350 sem redução
])
def test_irrf_2026_confere_com_a_tabela_e_a_reducao_da_lei(rendimento, inss_esperado, ir_esperado):
    inss, ir = _ir(rendimento, "2026-03")
    assert str(inss) == inss_esperado
    assert str(ir["imposto"]) == ir_esperado


def test_irrf_2025_nao_aplica_a_reducao_de_2026():
    _, ir = _ir(5000, "2025-06")
    assert ir["reducao"] == 0 and str(ir["imposto"]) == "312.89"


def test_reducao_nunca_gera_imposto_negativo_nem_passa_do_imposto():
    for rendimento in (2500, 3000, 4000, 4800, 5000, 5000.01, 5500, 7349.99, 7350, 9000):
        inss, ir = _ir(rendimento, "2026-03")
        assert ir["imposto"] >= 0
        assert ir["reducao"] <= ir["imposto_tabela"]


def test_reducao_diminui_de_forma_continua_entre_5000_e_7350():
    anterior = None
    for rendimento in (5000.01, 5500, 6000, 6500, 7000, 7349.99):
        _, ir = _ir(rendimento, "2026-03")
        if anterior is not None:
            assert ir["reducao"] <= anterior
        anterior = ir["reducao"]


def test_dependentes_reduzem_a_base_quando_superam_o_simplificado():
    _, sem = _ir(6000, "2026-03", dependentes=0)
    _, com = _ir(6000, "2026-03", dependentes=2)
    assert sem["usa_simplificado"] is False and com["usa_simplificado"] is False
    assert com["deducao"] - sem["deducao"] == Decimal("379.18")  # 2 × 189,59
    assert str(com["imposto"]) == "280.83" and com["imposto"] < sem["imposto"]


def test_usa_o_maior_entre_simplificado_e_deducoes_legais():
    inss, ir = _ir(3000, "2026-03", dependentes=0)
    assert ir["usa_simplificado"] is True and ir["deducao"] == Decimal("607.20")
    _, muitos = _ir(3000, "2026-03", dependentes=4)
    assert muitos["usa_simplificado"] is False and muitos["deducao"] == inss + Decimal("189.59") * 4


# ───────────────────────── holerite e rescisão ─────────────────────────

def _funcionario(session, salario=5000, dependentes=0, **extra):
    admin = Funcionario.query.filter_by(role="admin").first()
    campos = dict(estabelecimento_id=admin.estabelecimento_id, nome="Folha Teste", cpf="98765432100",
                  username="folha_teste", role="FUNCIONARIO", ativo=True, status="ativo",
                  data_nascimento=date(1995, 5, 10), celular="92988887777", email="folha@teste.com",
                  cargo="Operador", data_admissao=date(2024, 1, 1), salario_base=Decimal(str(salario)),
                  numero_dependentes=dependentes)
    campos.update(extra)
    func = Funcionario(**campos)
    func.set_password("senha123")
    session.add(func)
    session.commit()
    return func


def _valor(linhas, descricao):
    return next((linha["valor"] for linha in linhas if linha["descricao"].startswith(descricao)), None)


def test_holerite_2026_usa_tabela_e_reducao_da_competencia(session):
    func = _funcionario(session, salario=5000)
    holerite = calcular_holerite(func, "2026-03")
    assert _valor(holerite["descontos"], "INSS") == pytest.approx(501.51)
    assert _valor(holerite["descontos"], "IRRF") is None  # imposto zerado: não aparece como desconto
    assert any("redução" in linha for linha in holerite["memoria_calculo"])


def test_holerite_considera_dependentes(session):
    sem = calcular_holerite(_funcionario(session, salario=6000), "2026-03")
    funcionario_dep = _funcionario(session, salario=6000, dependentes=2, cpf="11122233344", username="folha_dep")
    com = calcular_holerite(funcionario_dep, "2026-03")
    assert _valor(sem["descontos"], "IRRF") == pytest.approx(385.10)
    assert _valor(com["descontos"], "IRRF") == pytest.approx(280.83)
    assert com["totais"]["liquido"] > sem["totais"]["liquido"]


def test_holerite_de_competencia_antiga_continua_com_a_tabela_antiga(session):
    func = _funcionario(session, salario=5000)
    assert _valor(calcular_holerite(func, "2025-06")["descontos"], "IRRF") == pytest.approx(312.89)
    assert _valor(calcular_holerite(func, "2025-06")["descontos"], "INSS") == pytest.approx(509.60)


@pytest.mark.parametrize("valor_vt, desconto_esperado", [(500, 120.00), (80, 80.00)])
def test_desconto_de_vt_e_o_menor_entre_6_por_cento_e_o_vt_concedido(session, valor_vt, desconto_esperado):
    func = _funcionario(session, salario=2000)
    beneficio = Beneficio(estabelecimento_id=func.estabelecimento_id, nome="Vale Transporte",
                          valor_padrao=Decimal(valor_vt), ativo=True)
    session.add(beneficio)
    session.flush()
    session.add(FuncionarioBeneficio(estabelecimento_id=func.estabelecimento_id, funcionario_id=func.id,
                                     beneficio_id=beneficio.id, valor=Decimal(valor_vt), ativo=True))
    session.commit()
    holerite = calcular_holerite(func, "2026-03")
    assert _valor(holerite["descontos"], "Vale-transporte") == pytest.approx(desconto_esperado)


def test_rescisao_usa_a_tabela_de_inss_do_mes_da_demissao(session):
    func = _funcionario(session, salario=8000)
    em_2025 = calcular_rescisao(func, date(2025, 6, 30), "S_JUSTA", ferias_vencidas_dias=0)
    em_2026 = calcular_rescisao(func, date(2026, 6, 30), "S_JUSTA", ferias_vencidas_dias=0)

    def inss(resultado):
        descontos = resultado.get("descontos") or resultado.get("verbas_descontos") or []
        return next(d["valor"] for d in descontos if "INSS" in d["descricao"].upper())

    # Saldo de salário de 30 dias de 8.000: INSS da tabela vigente na demissão.
    assert inss(em_2025) == pytest.approx(float(calcular_inss(8000, parametros_folha(None, "2025-06")["inss_faixas"])), abs=0.5)
    assert inss(em_2026) == pytest.approx(float(calcular_inss(8000, parametros_folha(None, "2026-06")["inss_faixas"])), abs=0.5)
    assert inss(em_2025) != inss(em_2026)


# ───────────────────────── cadastro: dependentes ─────────────────────────

@pytest.fixture
def headers_admin(session):
    from flask_jwt_extended import create_access_token
    admin = Funcionario.query.filter_by(role="admin").first()
    token = create_access_token(identity=str(admin.id),
                                additional_claims={"estabelecimento_id": admin.estabelecimento_id, "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def test_cadastro_de_dependentes_validado_e_exposto(client, session, headers_admin):
    func = _funcionario(session)
    for invalido in (-1, 21, "abc"):
        resposta = client.put(f"/api/funcionarios/{func.id}", headers=headers_admin, json={"numero_dependentes": invalido})
        assert resposta.status_code == 400, (invalido, resposta.get_json())
    ok = client.put(f"/api/funcionarios/{func.id}", headers=headers_admin, json={"numero_dependentes": 3})
    assert ok.status_code == 200, ok.get_json()
    session.refresh(func)
    assert func.numero_dependentes == 3
    listagem = client.get("/api/funcionarios/", headers=headers_admin).get_json()
    registros = listagem.get("funcionarios") or listagem.get("data") or []
    assert next(f for f in registros if f["id"] == func.id)["numero_dependentes"] == 3
