"""
Cache Layer - Cache inteligente com invalidação
Foco: Performance sem dados desatualizados
"""

import time
from typing import Any, Dict, Optional
from datetime import datetime, timedelta
import threading


class SmartCache:
    """
    Cache em memória com TTL (Time To Live) inteligente
    Para produção, usar Redis ou Memcached
    """

    _cache = {}
    _lock = threading.Lock()

    # Teto de entradas. Cada entrada pode ser um payload inteiro de dashboard
    # (centenas de KB); com o teto antigo de 1000, o cache sozinho podia passar
    # de centenas de MB por worker e derrubar a VM de produção (1 GB de RAM).
    MAX_ENTRIES = 64

    @classmethod
    def clear(cls):
        """Limpa todo o cache"""
        with cls._lock:
            cls._cache = {}

    @classmethod
    def get(cls, key: str, max_age_seconds: int = 300) -> Optional[Any]:
        """
        Obtém valor do cache se não estiver expirado
        """
        with cls._lock:
            if key in cls._cache:
                entry = cls._cache[key]
                # Verificar se não expirou
                if time.time() - entry["timestamp"] < max_age_seconds:
                    return entry["data"]
                else:
                    # Remover se expirou
                    del cls._cache[key]
            return None

    @classmethod
    def set(cls, key: str, data: Any, ttl_seconds: int = 300) -> None:
        """
        Armazena valor no cache com TTL
        """
        with cls._lock:
            now = time.time()
            cls._cache[key] = {
                "data": data,
                "timestamp": now,
                "expires_at": now + ttl_seconds,
            }

            # Faxina: remover entradas expiradas (antes só saíam se a MESMA
            # chave fosse relida — chaves órfãs ficavam na RAM para sempre)
            expired = [k for k, v in cls._cache.items() if v.get("expires_at", 0) <= now]
            for k in expired:
                del cls._cache[k]

            # Limitar tamanho do cache (LRU simples)
            while len(cls._cache) > cls.MAX_ENTRIES:
                oldest_key = min(
                    cls._cache.keys(), key=lambda k: cls._cache[k]["timestamp"]
                )
                del cls._cache[oldest_key]

    @classmethod
    def invalidate(cls, key: str) -> None:
        """Remove item do cache"""
        with cls._lock:
            if key in cls._cache:
                del cls._cache[key]

    @classmethod
    def invalidate_pattern(cls, pattern: str) -> None:
        """Remove todos os itens que correspondem ao padrão"""
        with cls._lock:
            keys_to_remove = [k for k in cls._cache.keys() if pattern in k]
            for key in keys_to_remove:
                del cls._cache[key]

    @classmethod
    def get_or_compute(cls, key: str, compute_func, ttl_seconds: int = 300) -> Any:
        """
        Obtém do cache ou calcula e armazena
        Pattern: Cache-Aside
        """
        # Tentar obter do cache
        cached = cls.get(key, ttl_seconds)
        if cached is not None:
            return cached

        # Calcular
        result = compute_func()

        # Armazenar no cache
        cls.set(key, result, ttl_seconds)

        return result


# Decorator para cache automático
def cache_response(ttl_seconds: int = 300, require_db_check: bool = False):
    """
    Decorator para cache automático de respostas
    """

    """
    Decorator para cache automático de respostas
    """

    def decorator(func):
        def wrapper(*args, **kwargs):
            # Criar chave única baseada nos argumentos
            import hashlib
            import pickle

            # Serializar argumentos para criar chave (Excluindo 'self' se for método de classe)
            try:
                # Se for um método de instância, o primeiro argumento é 'self'
                # Precisamos de algo estável. Se 'self' tem 'establishment_id', usamos isso.
                stable_args = list(args)
                if len(stable_args) > 0 and hasattr(stable_args[0], 'establishment_id'):
                    # Substitui a instância pelo ID do estabelecimento para uma chave estável
                    stable_args[0] = f"Est:{stable_args[0].establishment_id}"
                elif len(stable_args) > 0:
                    # Se não tem o ID, apenas remove a instância da chave de cache
                    # para evitar que o endereço de memória mude a chave
                    stable_args[0] = "instance_method"
                
                key_data = pickle.dumps((func.__name__, stable_args, kwargs))
                key = hashlib.md5(key_data).hexdigest()
                cache_key = f"{func.__module__}.{func.__name__}:{key}"
            except Exception as e:
                # Se não puder serializar, não usa cache
                import logging
                logging.getLogger(__name__).warning(f"Falha ao gerar chave de cache: {e}")
                return func(*args, **kwargs)

            use_flask_cache = False
            flask_cache = None
            try:
                from app import cache as _flask_cache

                flask_cache = _flask_cache
                use_flask_cache = (
                    hasattr(flask_cache, "get")
                    and hasattr(flask_cache, "set")
                    and hasattr(flask_cache, "app")
                )
            except Exception:
                use_flask_cache = False

            cached = None
            if use_flask_cache:
                try:
                    cached = flask_cache.get(cache_key)
                except Exception:
                    use_flask_cache = False

            if cached is None:
                cached = SmartCache.get(cache_key, ttl_seconds)
            if cached is not None:
                if require_db_check:
                    try:
                        # Otimização: não fazer SELECT 1 em todas as requisições se já temos o resultado
                        # ou usar um check mais leve. No PostgreSQL, SELECT 1 é rápido,
                        # mas muitas conexões simultâneas podem enfileirar.
                        from sqlalchemy import text
                        from app import db
                        # Executar com timeout curto para não travar a aplicação se o DB cair
                        db.session.execute(text("SELECT 1"))
                    except Exception as e:
                        import logging
                        logging.getLogger(__name__).error(f"Cache DB check failed: {e}")
                        # Se o DB falhar, tentamos servir o cache mesmo assim (graceful degradation)
                        return cached
                return cached

            try:
                result = func(*args, **kwargs)
            except Exception as e:
                # Se a execução falhar mas tivermos cache (mesmo expirado), poderíamos servir?
                # Por agora, apenas repassa o erro para o handler global
                raise e

            if use_flask_cache:
                try:
                    flask_cache.set(cache_key, result, timeout=ttl_seconds)
                except Exception:
                    SmartCache.set(cache_key, result, ttl_seconds)
            else:
                SmartCache.set(cache_key, result, ttl_seconds)
            return result

        return wrapper

    return decorator
