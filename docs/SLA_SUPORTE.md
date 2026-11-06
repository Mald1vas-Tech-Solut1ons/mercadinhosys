# SLA de Suporte e Cancelamento (MercadinhoSys)

Este documento define as regras operacionais (Service Level Agreement) de suporte e encerramento de contas para a plataforma **MercadinhoSys**, aplicáveis enquanto a funcionalidade de "Auto-Cancelamento" não for disponibilizada no painel do cliente.

## 1. Contexto e Defesa do Consumidor
Por se tratar de um sistema SaaS B2B, mas sujeito aos regimentos do Código de Defesa do Consumidor brasileiro, o cliente possui o direito de solicitar o cancelamento da assinatura sem multas abusivas (desde que respeitadas cláusulas do termo de uso) e em tempo hábil. 

## 2. Canais Oficiais de Solicitação
Toda solicitação de cancelamento deve ser feita pelo Titular da Conta (Admin) através dos seguintes canais de atendimento:
- **E-mail Oficial:** suporte@mercadinhosys.com.br
- **WhatsApp Oficial:** (XX) XXXXX-XXXX

O solicitante deve informar o **CNPJ** cadastrado e o **E-mail do Administrador** para fins de auditoria de segurança e validação de titularidade.

## 3. Prazos (SLA)
A operação do MercadinhoSys compromete-se com os seguintes prazos para cancelamentos:

- **Primeira Resposta (Triagem):** Em até **4 horas úteis** dentro do horário comercial (Seg a Sex, 08h as 18h).
- **Efetivação do Cancelamento (Billing):** A assinatura na Efí/Gateway será suspensa em até **24 horas úteis** após a confirmação dos dados. Nenhuma cobrança futura será emitida após a abertura do chamado.
- **Exportação de Dados:** O cliente terá o prazo de **7 dias corridos** para solicitar um dump/exportação dos seus produtos e vendas (via CSV), após os quais a conta entrará no status `suspenso` e posteriormente `cancelado` (apagado após 90 dias, conforme LGPD).

## 4. Fluxograma Operacional Interno (Para a Equipe)
Quando um chamado de cancelamento chegar, a equipe deve seguir estes 3 passos obrigatórios:
1. **Validar Identidade:** Confirmar se o e-mail que pediu é o `email_admin` cadastrado no banco de dados para a loja.
2. **Pausar Cobrança:** Acessar o portal da **Efí Pay** e cancelar/inativar a assinatura ou cobrança recorrente vinculada ao cliente.
3. **Mudar Status no Banco:** Acessar o sistema (Super Admin) ou o PostgreSQL de produção no Oracle, e alterar o `plano_status` da tabela `estabelecimentos` para `cancelado`.
   - *Comando SQL Referência:* `UPDATE estabelecimentos SET plano_status = 'cancelado' WHERE id = X;`
   - O bloqueio de acesso ao sistema (403) ocorrerá instantaneamente.

## 5. Próximos Passos (Roadmap Técnico)
Para reduzir o atrito e custo de suporte manual, a Sprint futura de `Portal SaaS` contemplará um botão "Cancelar Minha Assinatura", que via API:
- Comunicará a Efí para inativar a assinatura.
- Inativará o status do `Estabelecimento` no banco automaticamente.
- Enviará e-mail de confirmação.

---
*Documento vivo — atualizado conforme a evolução da operação comercial.*
