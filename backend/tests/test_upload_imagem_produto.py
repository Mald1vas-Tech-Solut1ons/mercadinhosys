"""Foto do produto por upload: reduzida no servidor, enviada ao Cloudinary da loja."""
import io
import sys
import types

from flask_jwt_extended import create_access_token
from PIL import Image

from app.models import Estabelecimento, Funcionario


def _h(session):
    estab = session.query(Estabelecimento).first()
    admin = session.query(Funcionario).filter_by(estabelecimento_id=estab.id).first()
    token = create_access_token(identity=str(admin.id), additional_claims={"estabelecimento_id": estab.id, "role": "admin"})
    return estab, {"Authorization": f"Bearer {token}"}


def _foto(w=3000, h=2000):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def test_upload_reduz_e_envia_para_pasta_da_loja(client, session, monkeypatch):
    estab, headers = _h(session)
    enviados = {}

    def upload(data, **kw):
        raw = __import__("base64").b64decode(data.split(",", 1)[1])
        enviados["lado"] = max(Image.open(io.BytesIO(raw)).size)
        enviados["folder"] = kw["folder"]
        return {"secure_url": "https://res.cloudinary.com/x/image/upload/p.jpg"}

    fake = types.ModuleType("cloudinary.uploader")
    fake.upload = upload
    pai = types.ModuleType("cloudinary")
    pai.uploader = fake
    monkeypatch.setitem(sys.modules, "cloudinary", pai)
    monkeypatch.setitem(sys.modules, "cloudinary.uploader", fake)
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://k:s@demo")

    r = client.post("/api/produtos/imagem", headers=headers, content_type="multipart/form-data",
                    data={"imagem": (_foto(), "foto.jpg")})
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["imagem_url"].startswith("https://")
    assert enviados["lado"] == 800
    assert enviados["folder"] == f"mercadinhosys/produtos/{estab.id}"


def test_upload_recusa_arquivo_que_nao_e_foto(client, session, monkeypatch):
    _, headers = _h(session)
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://k:s@demo")
    r = client.post("/api/produtos/imagem", headers=headers, content_type="multipart/form-data",
                    data={"imagem": (io.BytesIO(b"<script>alert(1)</script>"), "x.jpg")})
    assert r.status_code == 400


def test_upload_exige_login(client):
    r = client.post("/api/produtos/imagem", content_type="multipart/form-data",
                    data={"imagem": (_foto(10, 10), "f.jpg")})
    assert r.status_code in (401, 422)
