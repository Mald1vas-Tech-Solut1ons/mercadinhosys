#!/usr/bin/env bash
# Run only in OCI Cloud Shell, already authenticated to this tenancy.
set -euo pipefail
python3 - <<'PY'
import json, subprocess
sid = 'ocid1.securitylist.oc1.sa-saopaulo-1.aaaaaaaaraqqesgihcz26eujnww7pak7ppevf3jc3w56wl3mhqtb2xmpwbfa'
def camel(key):
    first, *rest = key.split('-')
    return first + ''.join(part.title() for part in rest)
def convert(value):
    if isinstance(value, dict):
        return {camel(k): convert(v) for k,v in value.items() if v is not None}
    if isinstance(value, list):
        return [convert(v) for v in value]
    return value
response = json.loads(subprocess.check_output(['oci','network','security-list','get','--security-list-id',sid,'--region','sa-saopaulo-1']))
rules = convert(response['data']['ingress-security-rules'])
for port in (80,443):
    rule = {'source':'0.0.0.0/0','sourceType':'CIDR_BLOCK','protocol':'6','isStateless':False,'tcpOptions':{'destinationPortRange':{'min':port,'max':port}},'description':f'MercadinhoSys web TCP {port}'}
    if not any(r.get('source')=='0.0.0.0/0' and r.get('protocol')=='6' and r.get('tcpOptions')==rule['tcpOptions'] for r in rules):
        rules.append(rule)
subprocess.run(['oci','network','security-list','update','--security-list-id',sid,'--region','sa-saopaulo-1','--ingress-security-rules',json.dumps(rules),'--force','--query','data."lifecycle-state"','--raw-output'],check=True)
print('Portas 80 e 443 liberadas; regras anteriores preservadas.')
PY
