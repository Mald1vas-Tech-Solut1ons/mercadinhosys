# Revisão DevOps e commits por módulo

Data: 2026-10-07. Repositório: MercadinhoSys. Branch de revisão: `codex/devops-modulos-2026-10-07`. Base: `f055cbeae35b95f1ce4f8de43d6ffff07345221d`.

## Preservação e classificação

O inventário inicial encontrou 7.194 itens em `scratch/`, além de alterações de aplicação, testes, documentação e infraestrutura. Runtimes, caches e snapshots foram preservados no disco e excluídos do Git. ZIPs de deploy, estado/planos/variáveis Terraform e outros artefatos locais também foram excluídos. Duas fotos de planilhas empresariais ficaram fora dos commits por não terem revisão de conteúdo/privacidade.

Um worktree isolado recebeu 233 arquivos candidatos, com SHA-256 conferido antes e depois da cópia. A revisão acrescentou parâmetros Terraform, testes independentes e estes documentos. O checkout original permanece preservado: criar commits no worktree não limpa automaticamente as alterações da branch master. Não foram usados reset, clean, stash global ou force push.

## Sequência de commits

1. Exclusão de artefatos e contexto Docker.
2. Dependências backend e isolamento do banco de testes.
3. Tenant, autorização, importações e documentos privados.
4. Checkout, pagamentos, estoque/lotes e crédito.
5. Billing Efí e migration de deduplicação persistente.
6. Consultor, RAG e configuração de provedores LLM.
7. Resposta e fallback de fornecedores.
8. Baixas financeiras parciais, com limitações explícitas.
9. Analytics calculados sobre observações reais.
10. Migração Tailwind, componentes e cenários de regressão frontend.
11. Oracle, scripts operacionais e Terraform parametrizado.
12. Aceites ERP, provas de segurança e CI com PostgreSQL separado.
13. Auditorias, handoffs e coordenação de sprints.

Os hunks de `models.py` são separados entre tenant, lotes e eventos Efí, mantendo cada migration junto ao seu modelo. A sequência organiza o trabalho existente; não certifica que cada módulo está pronto para migração comercial.

## Segurança revisada

Revisão de diffs e triagem local de credenciais: arquivos de ambiente reais, chaves privadas, dumps, runtimes e pacotes de deploy não entram nos commits. Os achados da triagem foram exemplos/fixtures e senhas demo em dois scripts de verificação Oracle; esses scripts agora exigem `VERIFY_DEMO_PASSWORD` via ambiente. OCIDs e chave pública SSH fixos dos dois módulos Terraform foram substituídos por variáveis obrigatórias. Nenhuma credencial de produção foi acessada, impressa ou rotacionada nesta etapa.

A revisão confirma mudanças para limitar setup público, revogar acesso de usuário inativo, validar tenant em consultas e operações bulk, servir documentos privados com autorização e limitar importação XML/XLSX. Isso não equivale a pentest, revisão completa do histórico Git ou varredura certificada por gitleaks.

## Validação e limites

Suíte backend final: **220 passed, 9 skipped, 10 xfailed**, exit 0, em 216,50 segundos. Os nove skips exigem PostgreSQL; os dez xfails são falhas de aceite conhecidas. Foram emitidos 4.223 warnings, principalmente de APIs legadas e depreciações. A primeira suíte revelou duas marcações xfail obsoletas para regras já corrigidas e duas falhas de acesso ao diretório temporário do Windows; as marcações foram removidas e a execução repetida com permissão adequada.

As três provas financeiras independentes reproduziram falhas reais: valor inválido/NaN retorna 500 e retry duplica a baixa. A suíte mantém sete bloqueios ERP antigos e três novos casos financeiros como xfail estrito. Um resultado verde com xfails não aprova migração.

PostgreSQL concorrente, Cypress com aplicação servida, Terraform validate, CI GitHub e smoke autenticado de produção não foram executados nesta etapa. O Docker local não tinha daemon disponível. O workflow foi corrigido para usar `AUDIT_DATABASE_URL`, executar a suíte geral SQLite e uma etapa PostgreSQL separada com banco descartável `audit_security_ci`; essa configuração ainda depende de execução no GitHub.

Build Vite de produção: **exit 0**, concluído em aproximadamente 2m25s, com PWA gerado. Inicialmente foi bloqueado pelo sandbox e depois pelo esbuild no TEMP do Windows; a repetição utilizou pasta temporária própria. Avisos de assets `/pattern.svg` e `/pattern-dark.svg` e chunks maiores que 500 kB precisam ser tratados antes de considerar a interface integralmente verificada. Build não substitui testes de interação e conferência visual.

Nenhum push, merge remoto, deploy Oracle, aplicação de migration ou alteração de banco de produção foi executado.

TypeScript: `node node_modules/typescript/bin/tsc -b`, **exit 0**, no checkout isolado. Os logs de execução e o manifesto de arquivos/hashes permanecem em `scratch/git-review/`, fora do Git.

## Pendências de aceite

Consultar `execucao-ia/review-gpt-S1-02-S1-03.md`. Fornecedores: aceites locais confirmados; causa raiz e publicação ainda não comprovadas. Financeiro: correção parcial, com idempotência, entradas inválidas e concorrência real pendentes. Analytics: indicadores artificiais removidos, mas calibração, dependência temporal, completude das despesas e coerência das janelas analíticas ainda exigem avaliação. SFA e os demais bloqueios ERP continuam no backlog.

## Commits locais registrados

| Hash | Responsabilidade |
|---|---|
| `5aac251c625f` | chore(repo): excluir artefatos locais e proteger contexto Docker |
| `31b9571d54f1` | chore(backend): atualizar dependencias e isolar banco de testes |
| `be2127a5c7f9` | fix(security): reforcar tenant, autorizacao e documentos privados |
| `5049e90731a8` | fix(checkout): validar pagamentos e serializar estoque e credito |
| `051f7dd4684a` | fix(billing): persistir eventos confirmados e deduplicar webhooks Efi |
| `e21576c6b135` | feat(consultor): recuperar evidencias e configurar provedores LLM |
| `085ac730d0d8` | fix(fornecedores): garantir resposta JSON e preservar filtros no fallback |
| `67594449f61e` | fix(financeiro): acumular baixas parciais sem ultrapassar saldo |
| `f59f245d1649` | fix(analytics): substituir indicadores artificiais por calculos observados |
| `1e559dde689d` | chore(frontend): migrar Tailwind e atualizar componentes e regressao |
| `e151378da62c` | chore(infra): preparar Oracle e parametrizar acesso e Terraform |
| `2e339eb3e456` | test(erp): registrar lacunas de aceite e separar CI PostgreSQL |

O 13º commit contém esta documentação de revisão. Conferir a sequência completa com `git log --oneline --reverse f055cbe..codex/devops-modulos-2026-10-07`.
