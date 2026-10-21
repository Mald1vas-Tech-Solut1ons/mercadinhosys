"""Ponta a ponta da implantação de uma loja mista (alimentos, perfumaria, roupa, eletro).

Roteiro de quinta: segmento genérico → importa planilha → monofásico pelo NCM → código
interno para quem não tem EAN → ST com CEST → abre caixa → vende (granel incluso) →
F9 duplo não duplica → NFC-e com CSOSN/CFOP certos → sem estoque recusa → cancela e
devolve → fecha caixa → outra loja não vê o comprovante. Escrito com o Ollama, revisado.
"""
import io
from datetime import date
from decimal import Decimal

from flask_jwt_extended import create_access_token

from app.models import db, Estabelecimento, Funcionario, Configuracao, Produto, Venda
from app.services.codigo_barras_service import digito_ean13, ean13_valido


def _ean(base12):
    return base12 + digito_ean13(base12)


def _h(estab_id, func_id):
    token = create_access_token(identity=str(func_id),
                                additional_claims={"estabelecimento_id": estab_id, "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def _resp(r):
    return r.get_json(silent=True) or r.get_data(as_text=True)[:500]


def _q(valor):
    return Decimal(str(valor)).quantize(Decimal("0.001"))


def test_implantacao_loja_mista_ponta_a_ponta(client, session):
    # Passo 1: loja mista no segmento genérico, Simples Nacional, sem venda sem estoque
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    estab.segmento = "generico"
    estab.regime_tributario = "SIMPLES NACIONAL"
    Configuracao.query.filter_by(estabelecimento_id=estab.id).first().permitir_venda_sem_estoque = False
    db.session.commit()
    headers = _h(estab.id, admin.id)

    def p(nome):
        return Produto.query.filter_by(estabelecimento_id=estab.id, nome=nome).first()

    # Passo 2: o cadastro oferece perfumaria e vestuário
    r = client.get("/api/view-schema/", headers=headers)
    assert r.status_code == 200, _resp(r)
    assert "perfumaria_higiene" in r.get_data(as_text=True)
    assert "vestuario" in r.get_data(as_text=True)

    # Passo 3: planilha mista (preço/estoque com vírgula, itens sem código)
    csv_text = (
        "nome;categoria;preco_custo;preco_venda;codigo_barras;codigo_interno;marca;unidade;estoque;lote;data_validade;ncm\n"
        "Leite Condensado 395g;Alimentos;5,50;8,90;7891000100103;;Nestle;UN;10;;;04029900\n"
        f"Shampoo 350ml;Higiene;8,00;15,90;{_ean('789600400085')};;MarcaX;UN;12;;;33051000\n"
        f"Perfume Colonia 100ml;Perfumaria;40,00;89,90;{_ean('789600400086')};;MarcaY;UN;5;;;33030010\n"
        "Camiseta Preta M;Vestuario;15,00;39,90;;;MarcaZ;UN;8;;;61091000\n"
        "Feijao Granel;Alimentos;4,00;9,00;;;;KG;8,5;;;07133399\n"
        f"Liquidificador 220V;Eletroportateis;80,00;149,90;{_ean('789600400087')};;MarcaE;UN;3;;;85094050\n"
        "Produto Sem Estoque;Geral;2,00;5,00;;;;UN;0;;;21069090\n"
    )
    r = client.post("/api/produtos/importar", headers=headers, content_type="multipart/form-data",
                    data={"arquivo": (io.BytesIO(csv_text.encode("utf-8")), "implantacao.csv")})
    assert r.status_code == 200, _resp(r)
    assert Produto.query.filter_by(estabelecimento_id=estab.id).count() == 7, _resp(r)

    # Passo 4: monofásico detectado pelo NCM (shampoo sim, leite e eletro não)
    for nome, esperado in (("Shampoo 350ml", True), ("Leite Condensado 395g", False), ("Liquidificador 220V", False)):
        r = client.get(f"/api/produtos/{p(nome).id}", headers=headers)
        assert r.status_code == 200, _resp(r)
        dados = r.get_json()
        dados = dados.get("produto", dados)
        assert dados.get("pis_cofins_monofasico") is esperado, (nome, dados.get("pis_cofins_monofasico"))

    # Passo 5: código interno EAN-13 (prefixo 20) para quem não tem código
    ids = [pr.id for pr in Produto.query.filter_by(estabelecimento_id=estab.id).all() if not pr.codigo_barras]
    assert len(ids) == 3, ids
    r = client.post("/api/produtos/codigo-barras/gerar", json={"produto_ids": ids}, headers=headers)
    assert r.status_code == 200, _resp(r)
    for pid in ids:
        codigo = r.get_json()["codigos"][str(pid)]
        assert codigo.startswith("20") and len(codigo) == 13 and ean13_valido(codigo), codigo

    # Passo 6: ICMS-ST exige CEST
    perfume = p("Perfume Colonia 100ml")
    r = client.put(f"/api/produtos/{perfume.id}", json={"icms_st": True}, headers=headers)
    assert r.status_code == 400, _resp(r)
    r = client.put(f"/api/produtos/{perfume.id}", json={"icms_st": True, "cest": "2002300"}, headers=headers)
    assert r.status_code == 200, _resp(r)

    # Passo 7: abre o caixa
    r = client.post("/api/caixas/abrir", json={"saldo_inicial": 100}, headers=headers)
    assert r.status_code in (200, 201), _resp(r)

    # Passo 8: venda mista com granel fracionado
    session.expire_all()
    camiseta, feijao, perfume = p("Camiseta Preta M"), p("Feijao Granel"), p("Perfume Colonia 100ml")
    total = round(39.9 + 4.5 + 89.9, 2)
    venda_payload = {
        "items": [{"id": camiseta.id, "quantity": 1, "price": 39.9},
                  {"id": feijao.id, "quantity": 0.5, "price": 9.0},
                  {"id": perfume.id, "quantity": 1, "price": 89.9}],
        "subtotal": total, "desconto": 0, "total": total,
        "pagamentos": [{"forma": "dinheiro", "valor": 200}], "valor_recebido": 200,
        "troco": round(200 - total, 2), "emitir_nfce": True, "offline_uuid": "e2e-venda-0001",
    }
    r = client.post("/api/pdv/finalizar", json=venda_payload, headers=headers)
    assert r.status_code == 201, _resp(r)
    venda_id = r.get_json()["venda"]["id"]

    # Passo 9: F9 duplo (mesmo offline_uuid) não duplica a venda
    r = client.post("/api/pdv/finalizar", json=venda_payload, headers=headers)
    assert r.status_code in (200, 201) and r.get_json().get("idempotente") is True, _resp(r)
    assert Venda.query.filter_by(estabelecimento_id=estab.id).count() == 1

    # Passo 10: estoque baixou (camiseta 8→7, feijão 8,5→8,0)
    session.expire_all()
    assert _q(p("Camiseta Preta M").quantidade) == _q("7")
    assert _q(p("Feijao Granel").quantidade) == _q("8.0")

    # Passo 11: NFC-e — perfume com ST sai CSOSN 500/CFOP 5405; demais seguem o cadastro; PIS 49 no Simples
    from app.services.fiscal.emissao_service import _build_payload
    payload = _build_payload(session.get(Venda, venda_id), estab, 1, 1)
    itens = payload.get("items") or payload.get("itens")
    por_ncm = {str(i.get("codigo_ncm")): i for i in itens}
    assert por_ncm["33030010"]["icms_situacao_tributaria"] == "500", por_ncm["33030010"]
    assert por_ncm["33030010"]["cfop"] == "5405", por_ncm["33030010"]
    # Camiseta: a importação pôs a família vestuário pelo NCM (cap. 61), que sugere CSOSN 500;
    # sem ST marcada, o CFOP segue 5102 do cadastro.
    camiseta_db = p("Camiseta Preta M")
    assert camiseta_db.familia_produto == "vestuario", camiseta_db.familia_produto
    assert por_ncm["61091000"]["icms_situacao_tributaria"] == camiseta_db.csosn, por_ncm["61091000"]
    assert por_ncm["61091000"]["cfop"] == "5102", por_ncm["61091000"]
    assert all(i.get("pis_situacao_tributaria") == "49" for i in itens), itens

    # Passo 12: sem estoque é recusado com motivo claro
    sem = p("Produto Sem Estoque")
    r = client.post("/api/pdv/finalizar", headers=headers, json={
        "items": [{"id": sem.id, "quantity": 1, "price": 5.0}], "subtotal": 5.0, "desconto": 0, "total": 5.0,
        "pagamentos": [{"forma": "pix", "valor": 5.0}], "offline_uuid": "e2e-venda-0002"})
    assert r.status_code == 400 and "Estoque insuficiente" in r.get_json()["error"], _resp(r)

    # Passo 13: cancelar devolve o estoque
    r = client.post(f"/api/vendas/{venda_id}/cancelar", headers=headers,
                    json={"motivo": "Teste e2e", "senha_admin": "industrial-secret"})
    assert r.status_code == 200, _resp(r)
    session.expire_all()
    assert _q(p("Camiseta Preta M").quantidade) == _q("8")

    # Passo 14: fecha o caixa
    r = client.post("/api/caixas/fechar", json={"valor_informado": 100}, headers=headers)
    assert r.status_code == 200, _resp(r)

    # Passo 15: outra loja não vê o comprovante desta
    estab2 = Estabelecimento(
        nome_fantasia="Loja Filial E2E", razao_social="Filial E2E LTDA", cnpj="98765432000110",
        email="filial.e2e@teste.com", telefone=estab.telefone, data_abertura=estab.data_abertura,
        plano="PREMIUM", vencimento_plano=estab.vencimento_plano, cep=estab.cep, logradouro=estab.logradouro,
        numero=estab.numero, bairro=estab.bairro, cidade=estab.cidade, estado=estab.estado, pais=estab.pais)
    db.session.add(estab2)
    db.session.flush()
    func2 = Funcionario(
        estabelecimento_id=estab2.id, nome="Admin Filial E2E", cpf="52998224725", username="admin_filial_e2e",
        role="admin", ativo=True, data_nascimento=date(1990, 1, 1), celular="11999998888",
        email="admin.filial.e2e@teste.com", cargo="Gerente", data_admissao=date(2024, 1, 1),
        salario_base=Decimal("5000.00"))
    func2.set_password("x-secret")
    db.session.add(func2)
    db.session.commit()
    r = client.get(f"/api/pdv/comprovante/{venda_id}", headers=_h(estab2.id, func2.id))
    assert r.status_code == 404, _resp(r)
