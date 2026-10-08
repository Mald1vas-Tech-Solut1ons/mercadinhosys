"""O endpoint que apagava registros de ponto em produção foi removido de vez."""
from flask_jwt_extended import create_access_token

from app.models import Estabelecimento, Funcionario


def test_endpoint_de_limpeza_de_teste_nao_existe(client, session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}
    for metodo in (client.delete, client.post, client.get):
        assert metodo("/api/ponto/teste/limpar-hoje", headers=headers).status_code in (404, 405)


def test_rotas_do_ponto_nao_expoem_nada_de_teste(app):
    caminhos = [regra.rule for regra in app.url_map.iter_rules()]
    assert not [c for c in caminhos if "/ponto/" in c and "teste" in c]
