"""Recebe somente as integrações autorizadas via stdin, sem imprimir segredos."""
import json
import os
import re
import sys
from pathlib import Path

allowed = {
    'DEEPSEEK_API', 'DEEPSEEK_MODEL', 'DEEPSEEK_MAX_TOKENS',
    'GROQ_API_KEY', 'GROQ_MODEL',
    'CLOUDINARY_URL', 'EFI_CLIENT_ID_HOMOL', 'EFI_CLIENT_SECRET_HOMOL',
    'EFI_CLIENT_ID_PROD', 'EFI_CLIENT_SECRET_PROD', 'EFI_PIX_KEY', 'EFI_ENV',
    'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_DEFAULT_SENDER',
}
values = json.load(sys.stdin)
assert set(values) <= allowed, 'Variáveis não autorizadas.'
assert all(isinstance(v, str) and not any(c in v for c in '\r\n') for v in values.values())
path = Path('/home/ubuntu/mercadinhosys/infra/oracle/.env.demo')
lines = path.read_text().splitlines()
obsolete = {'GEMINI_API_KEY', 'GEMINI_MODEL'}
lines = [line for line in lines if line.partition('=')[0] not in set(values) | obsolete]
# Aspas simples mantêm símbolos das chaves sem interpolação do Compose.
for name, value in values.items():
    assert "'" not in value, 'Valor exige escape manual.'
    lines.append(f"{name}='{value}'")
temp = path.with_suffix('.tmp')
temp.touch(mode=0o600)
temp.write_text('\n'.join(lines) + '\n')
os.chmod(temp, 0o600)
temp.replace(path)
print('INTEGRATIONS_IMPORTED: ' + ', '.join(sorted(values)))
