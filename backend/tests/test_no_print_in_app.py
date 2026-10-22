"""Guarda: código de produção em app/ deve usar logger, não print()."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
IGNORADOS = {"tests", "simulation", "__pycache__"}


def test_app_nao_usa_print():
    ofensores = []
    for arq in APP.rglob("*.py"):
        if IGNORADOS & set(arq.relative_to(APP).parts):
            continue
        arvore = ast.parse(arq.read_text(encoding="utf-8-sig"), filename=str(arq))
        for no in ast.walk(arvore):
            if isinstance(no, ast.Call) and isinstance(no.func, ast.Name) and no.func.id == "print":
                ofensores.append(f"{arq.relative_to(APP)}:{no.lineno}")
    assert not ofensores, "Use logging em vez de print(): " + ", ".join(ofensores)
