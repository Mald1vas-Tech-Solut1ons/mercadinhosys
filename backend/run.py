import os
from pathlib import Path
from dotenv import load_dotenv

# Só o backend/.env. load_dotenv() sem caminho sobe as pastas e, num worktree, achava o .env da
# raiz do projeto (já levou o servidor local a abrir conexão com um banco de nuvem antigo).
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=False)

from app import create_app  # noqa: E402  (depois do .env: config.py lê o ambiente no import)

# Cria a aplicação
app = create_app(os.getenv("FLASK_ENV", "default"))

if __name__ == "__main__":
    # Obtém porta do ambiente ou usa 5000
    port = int(os.environ.get("PORT", 5000))

    # Executa em modo desenvolvimento
    app.run(host="0.0.0.0", port=port, debug=app.config["DEBUG"])
