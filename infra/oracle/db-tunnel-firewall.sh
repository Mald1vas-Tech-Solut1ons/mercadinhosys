#!/bin/sh
# Acesso ao túnel apenas por containers Docker no gateway/sub-rede configurados.
# Instalado root:root em /usr/local/sbin; chamado pelo ExecStartPre privilegiado.
set -eu
gateway=${1:?Informe o gateway Docker}
subnet=${2:?Informe a sub-rede Docker}
iptables -C INPUT -i br+ -s "$subnet" -d "$gateway/32" -p tcp --dport 15432 -j ACCEPT 2>/dev/null ||
  iptables -I INPUT 1 -i br+ -s "$subnet" -d "$gateway/32" -p tcp --dport 15432 -j ACCEPT
