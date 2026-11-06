"""
Adapters de gateway fiscal (emissão NFC-e/NF-e).

Isola o provedor por trás de uma interface comum, para trocar de gateway sem
reescrever a regra de negócio. Implementações:

- SimuladoGateway: não chama serviço externo. Gera uma resposta estruturalmente
  válida (chave de 44 dígitos com DV correto, protocolo) marcada como SIMULADA.
  Permite desenvolver e testar todo o fluxo sem certificado/token.
- FocusNFeGateway: integra com a API REST da Focus NFe (homologação/produção).
  Só é usada quando o estabelecimento tem gateway='focusnfe' e um token.

Contrato (todas retornam dict):
    {status, chave, protocolo, numero, serie, danfe_url, xml_url, xml, qr_code, mensagem}
status ∈ {autorizado, rejeitado, processando, erro}
"""
from __future__ import annotations

import random
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, Optional
from app.utils.timezone import agora_local


def _dv_chave(chave43: str) -> str:
    """Dígito verificador da chave de acesso (módulo 11, pesos 2..9)."""
    pesos = [2, 3, 4, 5, 6, 7, 8, 9]
    soma = 0
    for i, d in enumerate(reversed(chave43)):
        soma += int(d) * pesos[i % len(pesos)]
    resto = soma % 11
    dv = 0 if resto in (0, 1) else 11 - resto
    return str(dv)


def gerar_chave_acesso(uf_cod: str, cnpj: str, modelo: str, serie: int, numero: int,
                       tp_emis: str = "1", data: Optional[datetime] = None) -> str:
    """Monta uma chave de acesso de 44 dígitos (com DV correto)."""
    data = data or agora_local()
    aamm = data.strftime("%y%m")
    cnpj = (cnpj or "").rjust(14, "0")[:14]
    c_nf = f"{random.randint(0, 99999999):08d}"
    base = f"{uf_cod[:2]:0>2}{aamm}{cnpj}{modelo:0>2}{serie:03d}{numero:09d}{tp_emis}{c_nf}"
    base = base[:43].ljust(43, "0")
    return base + _dv_chave(base)


class FiscalGateway(ABC):
    @abstractmethod
    def emitir(self, payload: Dict[str, Any], referencia: str) -> Dict[str, Any]:
        ...

    @abstractmethod
    def consultar(self, referencia: str) -> Dict[str, Any]:
        ...

    @abstractmethod
    def cancelar(self, referencia: str, justificativa: str) -> Dict[str, Any]:
        ...


class SimuladoGateway(FiscalGateway):
    """Emissão simulada — NÃO tem valor fiscal. Para desenvolvimento e testes."""

    UF_COD = {"SP": "35", "RN": "24", "RJ": "33", "MG": "31", "BA": "29", "PR": "41",
              "RS": "43", "SC": "42", "PE": "26", "CE": "23", "GO": "52", "DF": "53"}

    def __init__(self, estabelecimento=None):
        self.estab = estabelecimento

    def emitir(self, payload: Dict[str, Any], referencia: str) -> Dict[str, Any]:
        emit = payload.get("_emitente", {})
        uf = (emit.get("uf") or "SP").upper()
        uf_cod = self.UF_COD.get(uf, "35")
        chave = gerar_chave_acesso(
            uf_cod, emit.get("cnpj", "0"), payload.get("modelo", "65"),
            int(payload.get("serie", 1)), int(payload.get("numero", 1)),
        )
        return {
            "status": "autorizado",
            "chave": chave,
            "protocolo": f"SIM{agora_local().strftime('%y%m%d%H%M%S')}{random.randint(100,999)}",
            "numero": str(payload.get("numero")),
            "serie": str(payload.get("serie")),
            "danfe_url": None,
            "xml_url": None,
            "xml": f"<!-- NFC-e SIMULADA (sem valor fiscal) ref={referencia} chave={chave} -->",
            "qr_code": f"https://www.fazenda.simulado/nfce?p={chave}",
            "mensagem": "Autorizado em modo SIMULADO (sem valor fiscal).",
        }

    def consultar(self, referencia: str) -> Dict[str, Any]:
        return {"status": "autorizado", "mensagem": "Consulta simulada."}

    def cancelar(self, referencia: str, justificativa: str) -> Dict[str, Any]:
        return {"status": "cancelado", "mensagem": "Cancelamento simulado."}


class FocusNFeGateway(FiscalGateway):
    """Integração real com a Focus NFe (https://focusnfe.com.br)."""

    BASE = {
        "homologacao": "https://homologacao.focusnfe.com.br",
        "producao": "https://api.focusnfe.com.br",
    }

    def __init__(self, token: str, ambiente: str = "homologacao"):
        self.token = token
        self.base = self.BASE.get(ambiente, self.BASE["homologacao"])

    def _request(self, method: str, path: str, json_body: Optional[dict] = None) -> Dict[str, Any]:
        import requests
        url = f"{self.base}{path}"
        resp = requests.request(method, url, json=json_body, auth=(self.token, ""), timeout=30)
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}
        data["_http_status"] = resp.status_code
        return data

    @staticmethod
    def _normalizar(data: Dict[str, Any]) -> Dict[str, Any]:
        st = (data.get("status") or "").lower()
        mapa = {"autorizado": "autorizado", "cancelado": "cancelado",
                "erro_autorizacao": "rejeitado", "denegado": "rejeitado",
                "processando_autorizacao": "processando"}
        return {
            "status": mapa.get(st, "processando" if data.get("_http_status") in (200, 202) else "erro"),
            "chave": data.get("chave_nfce") or data.get("chave_nfe"),
            "protocolo": data.get("numero_protocolo"),
            "numero": data.get("numero"),
            "serie": data.get("serie"),
            "danfe_url": data.get("caminho_danfe"),
            "xml_url": data.get("caminho_xml_nota_fiscal"),
            "xml": None,
            "qr_code": data.get("qrcode_url") or data.get("url_consulta_nf"),
            "mensagem": data.get("mensagem_sefaz") or data.get("mensagem") or data.get("erros"),
        }

    def emitir(self, payload: Dict[str, Any], referencia: str) -> Dict[str, Any]:
        body = {k: v for k, v in payload.items() if not k.startswith("_")}
        data = self._request("POST", f"/v2/nfce?ref={referencia}", body)
        return self._normalizar(data)

    def consultar(self, referencia: str) -> Dict[str, Any]:
        return self._normalizar(self._request("GET", f"/v2/nfce/{referencia}"))

    def cancelar(self, referencia: str, justificativa: str) -> Dict[str, Any]:
        return self._normalizar(self._request(
            "DELETE", f"/v2/nfce/{referencia}", {"justificativa": justificativa}))


def get_gateway(estabelecimento) -> FiscalGateway:
    """Factory: escolhe o adapter conforme a configuração do estabelecimento."""
    nome = (getattr(estabelecimento, "fiscal_gateway", None) or "simulado").lower()
    ambiente = getattr(estabelecimento, "fiscal_ambiente", None) or "homologacao"
    token = getattr(estabelecimento, "fiscal_token", None)
    if nome == "focusnfe" and token:
        return FocusNFeGateway(token=token, ambiente=ambiente)
    # Default seguro: simulado (não emite nada com valor fiscal)
    return SimuladoGateway(estabelecimento=estabelecimento)
