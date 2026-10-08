# MercadinhoSys na Oracle: instalação, seed e operação

Atualizado em 07/10/2026. Release e evidências: [relatório modular](../../docs/RELATORIO_RELEASE_MODULAR_2026-10-07.md). Instalação realizada com dados simulados; nenhum dado real do Aiven foi restaurado.

## Infraestrutura instalada

| Item | Configuração |
|---|---|
| Site | https://mercadinhosys.vercel.app |
| API | https://mercadinhosys-api.144.22.151.18.sslip.io/api |
| Saúde | URL da API + `/health` |
| VM | OCI `VM.Standard.E2.1.Micro`, Ubuntu 24.04 x86/AMD, 1 GB RAM |
| Região | São Paulo (`sa-saopaulo-1`), AD-1 |
| IP / SSH | `144.22.151.18`, usuário `ubuntu` |
| Disco / swap | Aproximadamente 45 GB / 2 GB |
| Aplicação no servidor | `/home/ubuntu/mercadinhosys` |
| Banco | PostgreSQL 15; banco `mercadinhosys`; usuário `mercadinho_user` |
| Backend | Flask/Gunicorn, 1 worker e 4 threads; limite 512 MB |
| Redis | Redis 7; limitador de requisições |
| Proxy | Caddy 2; HTTPS Let's Encrypt com renovação automática |
| Compose | `compose.demo.yml` + `compose.https.yml` |
| Portas públicas | 80 e 443; 5000 apenas em localhost; banco/Redis sem portas publicadas |

A A1.Flex inicialmente solicitada falhou por capacidade insuficiente. A Micro foi criada depois, reutilizando a rede da pilha. Pilha “Ativo” não significa VM criada; SSH, containers e API confirmaram esta instalação.

O frontend permanece na Vercel; API e banco estão na Oracle. `vercel.app` é o endereço da hospedagem do frontend; a API usa um nome provisório `sslip.io` associado ao IP, sem domínio comprado. Ao adquirir domínio próprio, ajustar Caddy, Vercel e URLs de retorno.

## Ambientes e integrações

No servidor, `infra/oracle/.env.demo` contém banco, JWT, CORS e chaves de integração. `infra/oracle/.admin.env` contém a senha usada na criação do SUPERADMIN. Os arquivos têm permissão 600. Certificados ficam em `infra/oracle/certs`, montados para leitura em `/app/certs`. Não versionar estes arquivos.

| Integração | Configuração |
|---|---|
| DeepSeek | `DEEPSEEK_API`, `DEEPSEEK_MODEL=deepseek-flash`; Consultor com RAG |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL=openai/gpt-oss-20b`; textos curtos do CRM; conta Free, sem upgrade |
| Gemini | Removido do cliente e da configuração ativa |
| Cloudinary | `CLOUDINARY_URL`; fotos de ponto, RH e delivery |
| Efí | Credenciais homologação/produção, `EFI_PIX_KEY` e certificados `.p12` |
| Ambiente Efí | `EFI_ENV=sandbox`, preservado do projeto; nenhuma cobrança de produção criada nesta migração |
| Webhook Efí | `BACKEND_URL=https://mercadinhosys-api.144.22.151.18.sslip.io`; o código acrescenta `/api/billing/webhook` |
| SMTP | Não havia credenciais SMTP no `.env` local examinado; não afirmar envio de e-mail validado |
| Sincronização Aiven | Desativada: `SYNC_ENABLED=false`, `SYNC_AUTO_PUSH=false`; banco operacional é o PostgreSQL da Oracle |

`import-integrations.py` recebe JSON por stdin, aceita apenas nomes autorizados e atualiza o ambiente sem exibir segredos. Não copiar o `.env` local inteiro para a Oracle: isso traria conexão Aiven, modo local, tokens antigos e URLs obsoletas. Usar `demo.env.example` como lista de variáveis sem valores reais.

Detalhes da IA e seus limites: [RAG e provedores](IA-RAG.md). Resultados de integração externa: [Validação das integrações](INTEGRACOES.md).

## Frontend publicado

O projeto Vercel `mercadinhosys` usa `VITE_API_URL=https://mercadinhosys-api.144.22.151.18.sslip.io/api` no ambiente e no comando de build. O build explícito foi necessário porque o código remoto anterior fixava Render no `vercel.json`.

Deployment publicado: `dpl_Em78qKzfF69TaVCn9Fp1agMG63gh`, revisão `6d95713cf189f798aa98eb7f1fd64fa584a30683`. As alterações de frontend e infraestrutura foram commitadas, enviadas ao GitHub e integradas em `master` (PR #3). A versão anterior `dpl_FxoNHMV9kV3oyYcZSAtbUUFLbUnM` foi preservada para rollback.

Se a PWA usar um bundle antigo, clicar em **Limpar Cache e Reiniciar** no formulário de login. Isso resolveu a primeira tentativa no navegador. Login posterior confirmado como Rafael Maldivas / Modo Super-Admin, com dados do banco Oracle.

## Banco e seed executados

O banco era novo e vazio. `bootstrap-empty-database.py` criou o schema dos modelos, conferiu as colunas e marcou a revisão Alembic atual. Ele recusa bancos não vazios e não substitui migrações futuras.

Executado no container: `python seed_simulation_master.py --months 4`.

Não foram usadas as opções `--reset-all`, `--reset-demo`, `--sync-cloud`, `--fetch-cosmos` nem `SEED_LIGHT`. O catálogo local disponível foi usado. O wrapper conferiu o log porque o seed pode capturar exceções sem devolver código de falha.

Resultado conferido: **5 estabelecimentos (HQ + 4 lojas), 37 funcionários, 133 produtos e 2.834 vendas**. Log: `/home/ubuntu/seed-oracle.log`.

| Módulo local | Função na cadeia executada |
|---|---|
| `backend/seed_simulation_master.py` | Entrada CLI; chama `MasterSeeder.run_master_generation` |
| `master_seeder_logic.py` | HQ, SUPERADMIN, quatro lojas e perfis básicos; orquestra injeção e cronologia |
| `dna_factory.py` | Cenários de negócio usados pelo MasterSeeder |
| `injectors.py` | Fornecedores, clientes, gerente/entregador, produtos, RH, delivery, BI, compras/contas a pagar e despesas |
| `cosmos_catalog.py` | Catálogo e EANs; enriquecimento externo somente quando solicitado |
| `chronicle.py` | Compra de abertura, 120 dias por loja, vendas, reposição, despesas, liquidação financeira e pedidos em trânsito |
| `enterprise_injector.py` | Vendedores Alpha/Beta/Gama e SFA, chamados pela cronologia |
| `fiscal_simulator.py` | Documentos e movimentos financeiros simulados; não significa emissão fiscal real |

Os módulos acima ficam em `backend/app/simulation`, salvo a entrada CLI. Seeds alternativos, scripts de correção e `simulation/v2` não são todos executados automaticamente. Executar todos indiscriminadamente pode duplicar ou alterar dados. A cadeia ativa foi conferida; uma auditoria integral de todos os motores alternativos não foi concluída.

### Origem da senha do SUPERADMIN

1. `finish-app.sh` gera uma senha aleatória com `openssl rand -hex 16` somente se `.admin.env` não existe.
2. Passa esse texto ao seed pela variável `SEED_SUPERADMIN_PASSWORD`.
3. `master_seeder_logic.py` lê a variável quando cria `maldivas` e chama `set_senha`/`set_password`.
4. O modelo armazena o hash, mas o login usa a senha original. A sequência hexadecimal entregue ao administrador **é a senha de acesso, não o hash**.
5. Se `maldivas` já existe, o MasterSeeder preserva sua senha. Alterar a variável e rerodar o seed não redefine essa conta.

Credenciais completas verificadas: arquivo local privado `scratch/oracle-credentials.local.md`, ignorado pelo Git. Cópia da variável: `scratch/oracle-login.env`, também ignorada. O MasterSeeder atual não possui senha fixa de SUPERADMIN.

O banner final antigo do seed contém intervalos e vendedores incorretos: existem `admin1` a `admin4`; gerentes e entregadores usam IDs 2 a 5. As senhas dos 36 perfis de loja foram verificadas contra os hashes gravados.

## Comandos de operação

Na VM, entrar em `/home/ubuntu/mercadinhosys/infra/oracle`:

```bash
sudo docker compose --env-file .env.demo -f compose.demo.yml -f compose.https.yml ps
sudo docker compose --env-file .env.demo -f compose.demo.yml logs --tail 100 backend
sudo docker compose --env-file .env.demo -f compose.demo.yml -f compose.https.yml up -d backend
python3 verify-api.py
bash backup-database.sh
systemctl status mercadinhosys-backup.timer
```

Não usar `docker compose down -v`: apaga volumes persistentes. Não rerodar o seed para corrigir uma chave de API ou senha; ajustes de ambiente usam recriação apenas do container backend.

## Backup

Timer diário às 03:00 UTC (00:00 São Paulo), com atraso aleatório de até 5 minutos. `backup-database.sh` gera `pg_dump --format=custom` em `/home/ubuntu/mercadinhosys/database-backups` e mantém aproximadamente sete dias.

A restauração do primeiro dump foi testada em banco temporário por `verify-backup.sh`, conferindo 2.834 vendas. Backups automáticos estão na mesma VM; manter cópia externa para perda de disco/instância. Fotos, segredos e certificados precisam de cópias próprias: `pg_dump` cobre somente o banco.

## Validação e limitações

Saúde, PostgreSQL, HTTPS, CORS, login SUPERADMIN, `/super-admin/health`, login da primeira loja e produtos autenticados: verificados. Login no navegador e dashboard: confirmados. Dump e restauração: verificados.

A Micro tem 1 GB e não foi submetida a teste amplo de carga. A instalação funcional usa dados simulados; fiscal real, pagamentos e e-mail não estão certificados por esses testes. Trocar o endpoint do site não cancela automaticamente um plano ou faturamento Render.
