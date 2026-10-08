"""Inventário CTO somente leitura; imprime metadados, nunca ambientes/segredos.

Executar via stdin no host autorizado. Não aplica mudanças nem autentica usuários.
"""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
import urllib.request
import urllib.error


def command(*args):
    return subprocess.run(args, text=True, capture_output=True, check=True).stdout


result = {"checked_at_utc": datetime.now(timezone.utc).isoformat()}
containers = json.loads(command("sudo", "docker", "inspect", "oracle-backend-1",
                               "oracle-postgres-1", "oracle-redis-1", "oracle-caddy-1"))
result["containers"] = [{
    "name": item["Name"].lstrip("/"), "image": item["Config"]["Image"],
    "image_id": item["Image"], "started_at": item["State"]["StartedAt"],
    "health": item["State"].get("Health", {}).get("Status"),
    "memory_limit_bytes": item["HostConfig"]["Memory"],
    "command": item["Config"]["Cmd"] if item["Name"] == "/oracle-backend-1" else None,
} for item in containers]
result["http"] = []
for url in ("https://mercadinhosys.vercel.app/",
            "https://mercadinhosys-api.144.22.151.18.sslip.io/api/health",
            "https://mercadinhosys-api.144.22.151.18.sslip.io/api/fornecedores/"):
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            result["http"].append({"url": url, "status": response.status,
                                   "content_type": response.headers.get("Content-Type")})
    except urllib.error.HTTPError as error:
        result["http"].append({"url": url, "status": error.code})
    except Exception as error:
        result["http"].append({"url": url, "error_type": type(error).__name__})
result["published_source_sha256"] = {}
for path in ("app/routes/fornecedores.py", "app/dashboard_cientifico/models_layer.py",
             "app/dashboard_cientifico/orchestration.py", "app/models.py"):
    script = "from pathlib import Path; import hashlib; print(hashlib.sha256(Path(%r).read_bytes()).hexdigest())" % ("/app/" + path)
    try:
        result["published_source_sha256"][path] = command(
            "sudo", "docker", "exec", "oracle-backend-1", "python", "-c", script).strip()
    except subprocess.CalledProcessError:
        result["published_source_sha256"][path] = "unavailable"
try:
    result["backup_timer"] = command("systemctl", "list-timers", "--all", "--no-pager", "*mercadinho*").strip()
except subprocess.CalledProcessError:
    result["backup_timer"] = "unavailable"
print(json.dumps(result, indent=2))
