"""
app/middleware/rate_limit.py
Configuração de Rate Limiting
"""

import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask import request


def get_identifier():
    """Identifica o usuário para rate limiting"""
    # Cabeçalho não autenticado é controlado pelo atacante. Prefixos JWT são
    # compartilhados e não identificam usuários; não usá-los como chave.
    from flask_jwt_extended import verify_jwt_in_request, get_jwt
    try:
        verify_jwt_in_request(optional=True)
        claims = get_jwt()
        if claims and claims.get('sub'):
            return f"user:{claims.get('estabelecimento_id')}:{claims['sub']}"
    except Exception:
        pass
    return get_remote_address()


# Storage compartilhado (Redis) em produção para o limite valer entre TODOS os
# workers/instâncias. memory:// só conta por-worker (ineficaz com gunicorn -w>1).
# Defina RATELIMIT_STORAGE_URI=redis://:senha@redis:6379/1 no ambiente.
_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")

limiter = Limiter(
    key_func=get_identifier,
    default_limits=["1000 per hour"],
    storage_uri=_STORAGE_URI,
)

# Configurações específicas por tipo de endpoint
RATE_LIMITS = {
    "auth": "5 per minute",  # Login limitado
    "create": "30 per minute",  # Criação de recursos
    "read": "100 per minute",  # Leitura
    "update": "30 per minute",  # Atualização
    "delete": "20 per minute",  # Deleção
}

