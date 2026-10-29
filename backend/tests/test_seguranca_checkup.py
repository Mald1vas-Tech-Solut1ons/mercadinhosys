"""Regressões do checkup de segurança de 2026-10-20.

Cada teste reproduz o ataque que funcionava antes da correção:
#1 IDOR do cupom (venda de outra loja por id); #2 preço burlado com productId divergente;
#5 catálogo global rebaixado por base aberta e force=true para qualquer um;
#6 cache negativo e prazo das bases abertas; #7 nenhum token do Cosmos no código;
#9 sequência do código interno envenenável e sem retentativa; #10 RBAC mascarando erro da rota.
"""
from datetime import datetime, timedelta, timezone, date
from decimal import Decimal
import pathlib
import re

import pytest
from flask_jwt_extended import create_access_token, create_refresh_token

import app.routes.produtos as produtos_mod
import app.services.codigo_barras_service as codbar
from app.models import (
    Caixa, CatalogoMestre, CategoriaProduto, Cliente, Estabelecimento, Funcionario, Produto, Venda,
)


# ── fixtures ────────────────────────────────────────────────────────────────

def _funcionario(session, estab, role, sufixo):
    f = Funcionario(estabelecimento_id=estab.id, nome=f"F {sufixo}", cpf=f"9998887{sufixo}", username=f"u_{sufixo}",
                    role=role, ativo=True, data_nascimento=date(1990, 1, 1), celular="92999999999",
                    email=f"{sufixo}@x.sys", cargo=role, data_admissao=date(2024, 1, 1), salario_base=Decimal("1"))
    f.set_password("senha-teste-123")
    session.add(f)
    session.commit()
    return f


def _token(f, estab, role):
    return create_access_token(identity=str(f.id), additional_claims={
        "estabelecimento_id": estab.id, "role": role, "status": "ativo"})


def _hdr(f, estab, role):
    return {"Authorization": f"Bearer {_token(f, estab, role)}"}


@pytest.fixture
def ctx(session):
    estab = session.query(Estabelecimento).first()
    cat = CategoriaProduto(estabelecimento_id=estab.id, nome="Seg")
    session.add(cat)
    session.commit()
    caixa = _funcionario(session, estab, "caixa", "0001")
    gerente = _funcionario(session, estab, "gerente", "0002")
    session.add(Caixa(estabelecimento_id=estab.id, funcionario_id=caixa.id, numero_caixa="CX-SEG",
                      saldo_inicial=Decimal("0"), saldo_atual=Decimal("0"), status="aberto",
                      data_abertura=datetime.now(timezone.utc)))
    session.commit()
    return dict(estab=estab, cat=cat, caixa=caixa, gerente=gerente)


@pytest.fixture
def loja_vitima(session):
    outra = Estabelecimento(nome_fantasia="Loja Vitima", razao_social="Vitima LTDA", cnpj="99888777000155",
                            email="v@v.sys", telefone="1", data_abertura=date(2024, 1, 1), cep="1", logradouro="r",
                            numero="1", bairro="b", cidade="c", estado="SP", pais="Brasil")
    session.add(outra)
    session.commit()
    dono = _funcionario(session, outra, "admin", "0009")
    cliente = Cliente(estabelecimento_id=outra.id, nome="Cliente Sigiloso", cpf="52998224725", celular="11999999999",
                      cep="01001-000", logradouro="Rua A", numero="1", bairro="Centro", cidade="São Paulo", estado="SP")
    session.add(cliente)
    session.commit()
    venda = Venda(estabelecimento_id=outra.id, funcionario_id=dono.id, cliente_id=cliente.id, codigo="V-VITIMA-1",
                  subtotal=Decimal("123.45"), desconto=Decimal("0"), total=Decimal("123.45"), status="finalizada",
                  data_venda=datetime.now(timezone.utc))
    session.add(venda)
    session.commit()
    return dict(estab=outra, dono=dono, venda=venda)


def _produto(session, ctx, nome, preco=5, qtd=100, codigo=None):
    p = Produto(estabelecimento_id=ctx["estab"].id, categoria_id=ctx["cat"].id, nome=nome,
                preco_custo=Decimal("1"), preco_venda=Decimal(str(preco)), quantidade=Decimal(str(qtd)),
                codigo_barras=codigo)
    session.add(p)
    session.commit()
    return p


class _Resp:
    def __init__(self, status_code, payload=None):
        self.status_code, self._payload = status_code, (payload or {})

    def json(self):
        return self._payload


# ── #1 IDOR do cupom ────────────────────────────────────────────────────────

def test_cupom_html_de_outra_loja_da_404_mesmo_com_token_na_query(client, session, ctx, loja_vitima):
    token = _token(ctx["caixa"], ctx["estab"], "caixa")
    r = client.get(f"/api/pdv/imprimir-html/{loja_vitima['venda'].id}?token={token}")
    corpo = r.get_data(as_text=True)
    assert r.status_code == 404
    assert "Loja Vitima" not in corpo and "V-VITIMA-1" not in corpo


def test_cupom_html_da_propria_loja_continua_abrindo_pela_query(client, session, loja_vitima):
    token = _token(loja_vitima["dono"], loja_vitima["estab"], "admin")
    r = client.get(f"/api/pdv/imprimir-html/{loja_vitima['venda'].id}?token={token}")
    assert r.status_code == 200 and "V-VITIMA-1" in r.get_data(as_text=True)


def test_cupom_html_recusa_refresh_token_e_usuario_inativo(client, session, loja_vitima):
    dono = loja_vitima["dono"]
    refresh = create_refresh_token(identity=str(dono.id), additional_claims={"estabelecimento_id": loja_vitima["estab"].id})
    assert client.get(f"/api/pdv/imprimir-html/{loja_vitima['venda'].id}?token={refresh}").status_code == 401
    token = _token(dono, loja_vitima["estab"], "admin")
    dono.ativo = False
    session.commit()
    assert client.get(f"/api/pdv/imprimir-html/{loja_vitima['venda'].id}?token={token}").status_code == 401


def test_comprovante_e_envio_de_cupom_nao_leem_venda_de_outra_loja(client, session, ctx, loja_vitima):
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    r = client.get(f"/api/pdv/comprovante/{loja_vitima['venda'].id}", headers=h)
    assert r.status_code == 404 and "Cliente Sigiloso" not in r.get_data(as_text=True)
    r = client.post("/api/pdv/enviar-cupom", headers=h,
                    json={"venda_id": loja_vitima["venda"].id, "email_destino": "atacante@example.com"})
    assert r.status_code == 404


# ── #2 preço burlado no PDV ─────────────────────────────────────────────────

def _finalizar(client, h, item, total=0.01):
    return client.post("/api/pdv/finalizar", headers=h, json={
        "items": [item], "subtotal": total, "desconto": 0, "total": total,
        "pagamentos": [{"forma": "pix", "valor": total}]})


def test_pdv_recusa_item_com_productId_divergente_do_id(client, session, ctx):
    whisky = _produto(session, ctx, "Whisky", preco=200)
    barato = _produto(session, ctx, "Bala", preco=0.01)
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    r = _finalizar(client, h, {"id": whisky.id, "productId": barato.id, "quantity": 1, "price": 0.01})
    assert r.status_code == 400, r.get_json()
    session.expire_all()
    assert session.get(Produto, whisky.id).quantidade == Decimal("100")


def test_pdv_recusa_item_cujo_produto_nao_foi_validado(client, session, ctx):
    whisky = _produto(session, ctx, "Whisky", preco=200)
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    r = _finalizar(client, h, {"id": whisky.id, "productId": 99999999, "quantity": 1, "price": 0.01})
    assert r.status_code == 400, r.get_json()
    r = _finalizar(client, h, {"productId": 99999999, "quantity": 1, "price": 0.01})
    assert r.status_code in (400, 404)
    session.expire_all()
    assert session.get(Produto, whisky.id).quantidade == Decimal("100")


def test_pdv_recusa_quantidade_divergente_entre_chaves(client, session, ctx):
    whisky = _produto(session, ctx, "Whisky", preco=200)
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    r = _finalizar(client, h, {"id": whisky.id, "quantity": 1, "quantidade": 10, "price": 200}, total=200)
    assert r.status_code == 400


def test_pdv_venda_normal_continua_passando(client, session, ctx):
    p = _produto(session, ctx, "Sabonete", preco=3.5)
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    r = _finalizar(client, h, {"id": p.id, "quantity": 2, "discount": 0, "price": 3.5}, total=7.0)
    assert r.status_code == 201, r.get_json()


# ── #5/#6/#7 lookup do catálogo ─────────────────────────────────────────────

def test_codigo_versionado_nao_tem_token_do_cosmos():
    fonte = pathlib.Path(produtos_mod.__file__).read_text(encoding="utf-8")
    # nenhum literal de token como fallback do COSMOS_TOKEN
    assert not re.search(r'COSMOS_TOKEN"\)\s*or\s*"[A-Za-z0-9_-]{8,}"', fonte)


def test_sem_cosmos_token_vai_direto_as_bases_abertas(client, session, ctx, monkeypatch):
    monkeypatch.delenv("COSMOS_TOKEN", raising=False)
    chamadas = []

    def _get(url, *a, **k):
        chamadas.append(url)
        return _Resp(200, {"status": 1, "product": {"product_name": "Detergente 500ml"}})
    monkeypatch.setattr(produtos_mod.requests, "get", _get)
    r = client.get("/api/produtos/catalogo/lookup/7891000000001", headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"))
    assert r.status_code == 200 and r.get_json()["source"] == "openfoodfacts"
    assert not any("cosmos" in u for u in chamadas)


def test_force_e_so_para_gerente(client, session, ctx, monkeypatch):
    monkeypatch.setattr(produtos_mod.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria consultar")))
    r = client.get("/api/produtos/catalogo/lookup/7891000100103?force=true",
                   headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"))
    assert r.status_code == 403


def test_base_aberta_nao_sobrescreve_item_do_cosmos_nem_com_force(client, session, ctx, monkeypatch):
    session.add(CatalogoMestre(ean="7891000100103", nome="Leite Moca 395g", status="encontrado", fonte="cosmos",
                               imagem_url="https://cosmos.example/moca.png"))
    session.commit()
    off = {"status": 1, "product": {"product_name": "NOME INJETADO", "image_front_small_url": "https://evil.example/x.png"}}
    monkeypatch.setattr(produtos_mod.requests, "get", lambda url, *a, **k: _Resp(404) if "cosmos" in url else _Resp(200, off))
    r = client.get("/api/produtos/catalogo/lookup/7891000100103?force=true",
                   headers=_hdr(ctx["gerente"], ctx["estab"], "gerente"))
    assert r.status_code == 200
    session.expire_all()
    item = CatalogoMestre.query.filter_by(ean="7891000100103").first()
    assert item.nome == "Leite Moca 395g" and item.fonte == "cosmos"
    assert item.imagem_url == "https://cosmos.example/moca.png"


def test_base_aberta_nao_grava_imagem_de_dominio_alheio(client, session, ctx, monkeypatch):
    monkeypatch.delenv("COSMOS_TOKEN", raising=False)
    off = {"status": 1, "product": {"product_name": "Sabão", "image_front_small_url": "https://evil.example/x.png"}}
    monkeypatch.setattr(produtos_mod.requests, "get", lambda *a, **k: _Resp(200, off))
    r = client.get("/api/produtos/catalogo/lookup/7891000000002", headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"))
    assert r.status_code == 200
    assert CatalogoMestre.query.filter_by(ean="7891000000002").first().imagem_url is None


def test_ean_inexistente_vira_cache_negativo_com_ttl(client, session, ctx, monkeypatch):
    chamadas = []

    def _get(url, *a, **k):
        chamadas.append((url, k.get("timeout")))
        return _Resp(404)
    monkeypatch.setattr(produtos_mod.requests, "get", _get)
    h = _hdr(ctx["caixa"], ctx["estab"], "caixa")
    ean = "7891000000003"

    assert client.get(f"/api/produtos/catalogo/lookup/{ean}", headers=h).status_code == 404
    assert len(chamadas) == 3  # 3 bases abertas (Cosmos saiu; BigDataCorp sem credencial no teste)
    # prazo: cada base aberta dentro do orçamento total de ~8 s
    assert all(t <= 4.0 for _, t in chamadas)
    assert CatalogoMestre.query.filter_by(ean=ean).first().status == "nao_encontrado"

    assert client.get(f"/api/produtos/catalogo/lookup/{ean}", headers=h).status_code == 404
    assert len(chamadas) == 3  # dentro do TTL: nenhuma chamada externa

    item = CatalogoMestre.query.filter_by(ean=ean).first()
    item.consultado_em = datetime.utcnow() - timedelta(days=produtos_mod.CACHE_NEGATIVO_DIAS + 1)
    session.commit()
    client.get(f"/api/produtos/catalogo/lookup/{ean}", headers=h)
    assert len(chamadas) == 6  # TTL vencido: consulta de novo


def test_falha_de_rede_nao_vira_cache_negativo(client, session, ctx, monkeypatch):
    monkeypatch.setattr(produtos_mod.requests, "get", lambda *a, **k: _Resp(429))
    client.get("/api/produtos/catalogo/lookup/7891000000004", headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"))
    assert CatalogoMestre.query.filter_by(ean="7891000000004").first() is None


def test_ean_com_mais_de_14_digitos_e_recusado(client, session, ctx):
    r = client.get("/api/produtos/catalogo/lookup/" + "7" * 40, headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"))
    assert r.status_code == 400


# ── #9 código interno ───────────────────────────────────────────────────────

def test_codigo_nao_numerico_nao_zera_a_sequencia(client, session, ctx):
    _produto(session, ctx, "Interno", codigo="2000000000015")
    _produto(session, ctx, "Lixo", codigo="20ZZZZZZZZZZZ")
    r = client.get("/api/produtos/codigo-barras/proximo", headers=_hdr(ctx["gerente"], ctx["estab"], "gerente"))
    proximo = r.get_json()["codigo_barras"]
    assert proximo != "2000000000015" and int(proximo[2:12]) == 2 and codbar.ean13_valido(proximo)


def test_sequencia_conta_produto_excluido(client, session, ctx):
    p = _produto(session, ctx, "Excluído", codigo="2000000000039")
    p.deleted_at = datetime.utcnow()
    session.commit()
    assert codbar.maior_sequencia_interna(ctx["estab"].id) == 3


def test_gerar_tenta_de_novo_quando_o_codigo_ja_foi_ocupado(client, session, ctx, monkeypatch):
    _produto(session, ctx, "Ocupante", codigo="2000000000015")
    sem = _produto(session, ctx, "Sem código")
    # Simula a corrida: a leitura da sequência não vê o cadastro concorrente.
    monkeypatch.setattr(codbar, "maior_sequencia_interna", lambda estab_id: 0)
    r = client.post("/api/produtos/codigo-barras/gerar", headers=_hdr(ctx["gerente"], ctx["estab"], "gerente"),
                    json={"produto_ids": [sem.id]})
    assert r.status_code == 200, r.get_json()
    codigo = r.get_json()["codigos"][str(sem.id)]
    assert codigo != "2000000000015" and codbar.ean13_valido(codigo)


# ── #10 RBAC não mascara erro da rota ───────────────────────────────────────

def test_erro_da_rota_nao_vira_erro_de_autenticacao(client, session, ctx, monkeypatch):
    sem = _produto(session, ctx, "Sem código")

    def _explode(*a, **k):
        raise RuntimeError("falha de negócio")
    monkeypatch.setattr(codbar, "proximos_codigos_internos", _explode)
    with pytest.raises(RuntimeError, match="falha de negócio"):  # TESTING propaga: o erro original chega intacto
        client.post("/api/produtos/codigo-barras/gerar", headers=_hdr(ctx["gerente"], ctx["estab"], "gerente"),
                    json={"produto_ids": [sem.id]})


def test_rbac_continua_barrando_quem_nao_tem_nivel(client, session, ctx):
    sem = _produto(session, ctx, "Sem código")
    r = client.post("/api/produtos/codigo-barras/gerar", headers=_hdr(ctx["caixa"], ctx["estab"], "caixa"),
                    json={"produto_ids": [sem.id]})
    assert r.status_code == 403
