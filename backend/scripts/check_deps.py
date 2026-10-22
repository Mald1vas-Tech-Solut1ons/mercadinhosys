"""Detecta drift entre o ambiente Python ativo e o requirements.txt.

Uso: python scripts/check_deps.py [caminho/requirements.txt]
Sai com código 1 se houver pacote ausente ou com versão diferente da pinada.
"""
import re
import sys
from importlib import metadata
from pathlib import Path

PIN = re.compile(r"^([A-Za-z0-9._-]+)\s*==\s*([^\s;#]+)")


def normalizar(nome: str) -> str:
    return re.sub(r"[-_.]+", "-", nome).lower()


def ler_pins(caminho: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        m = PIN.match(linha.strip())
        if m:
            pins[normalizar(m.group(1))] = m.group(2)
    return pins


def main() -> int:
    caminho = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "requirements.txt"
    problemas = []
    for nome, esperado in sorted(ler_pins(caminho).items()):
        try:
            instalado = metadata.version(nome)
        except metadata.PackageNotFoundError:
            problemas.append(f"AUSENTE   {nome}=={esperado}")
            continue
        if instalado != esperado:
            problemas.append(f"DIVERGE   {nome}: requirements={esperado} instalado={instalado}")
    if problemas:
        print(f"Drift de dependências ({len(problemas)}) — rode: pip install -r {caminho.name}")
        print("\n".join(problemas))
        return 1
    print(f"OK: ambiente em sincronia com {caminho.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
