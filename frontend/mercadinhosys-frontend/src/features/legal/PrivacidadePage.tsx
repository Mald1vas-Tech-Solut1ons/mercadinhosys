import React from 'react';
import LegalLayout, { SecaoTitulo } from './LegalLayout';
import { legalInfo } from './legalInfo';

const PrivacidadePage: React.FC = () => {
    return (
        <LegalLayout
            titulo="Política de Privacidade e Proteção de Dados (LGPD)"
            subtitulo={`Como nós da ${legalInfo.produto} tratamos e protegemos os seus dados.`}
        >
            <p>
                A <strong>{legalInfo.razaoSocial}</strong>, inscrita no CNPJ sob o nº {legalInfo.cnpj} 
                (doravante "Nós" ou "Licenciante"), valoriza a sua privacidade e estabelece a presente 
                Política de Privacidade para demonstrar o nosso compromisso com a conformidade frente à 
                Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).
            </p>

            <SecaoTitulo numero={1}>A Nossa Posição Legal (Operador vs. Controlador)</SecaoTitulo>
            <p>
                No ecossistema do <strong>{legalInfo.produto}</strong>, desempenhamos dois papéis distintos, 
                dependendo de quem é o titular dos dados:
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>
                    <strong>Como Controlador:</strong> Quando o Lojista (Dono do Mercado) contrata nosso sistema, 
                    nós coletamos e controlamos os dados cadastrais e financeiros dessa pessoa (ou empresa) 
                    para faturamento, suporte e comunicação direta.
                </li>
                <li>
                    <strong>Como Operador:</strong> Todos os dados que o Lojista insere dentro do sistema — como 
                    informações de seus Funcionários (RH/Ponto), Fornecedores e de seus Clientes Finais (Fiado/CRM) — 
                    são de controle exclusivo do Lojista. Nós apenas <em>processamos</em> e <em>armazenamos</em> 
                    esses dados a mando do Lojista, fornecendo a infraestrutura técnica (SaaS).
                </li>
            </ul>
            <p className="font-bold text-slate-800 bg-blue-50 p-3 rounded border border-blue-100 mt-2">
                O Lojista, na figura de Controlador, é integralmente responsável por obter o consentimento 
                ou a base legal necessária de seus clientes e funcionários antes de lançar seus dados no sistema.
            </p>

            <SecaoTitulo numero={2}>Quais Dados Coletamos do Lojista</SecaoTitulo>
            <p>Para fornecer os serviços contratados, coletamos os seguintes dados do titular da conta principal (Lojista):</p>
            <ul className="list-disc pl-5 space-y-2">
                <li><strong>Dados Cadastrais:</strong> Nome completo, CPF/CNPJ, e-mail, telefone e endereço (CEP).</li>
                <li><strong>Dados de Acesso e Telemetria:</strong> Endereços IP, datas e horas de acesso, tipo de dispositivo (para fins de auditoria, segurança e prevenção a fraudes).</li>
                <li><strong>Dados de Faturamento:</strong> Histórico de pagamentos da assinatura (os dados de cartão de crédito não são armazenados em nossos servidores, mas sim diretamente nos Gateways de Pagamento parceiros).</li>
            </ul>

            <SecaoTitulo numero={3}>Para Que Usamos os Seus Dados</SecaoTitulo>
            <p>
                Os dados coletados são tratados sob as seguintes bases legais (Art. 7º da LGPD):
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li><strong>Execução de Contrato:</strong> Para criar e manter a sua conta ativa, emitir a fatura da mensalidade e fornecer o suporte técnico necessário para manter o ERP funcionando.</li>
                <li><strong>Legítimo Interesse:</strong> Para avaliar métricas de uso e aprimorar o desempenho das telas do sistema.</li>
                <li><strong>Obrigação Legal:</strong> Guarda de logs de conexão exigida pelo Marco Civil da Internet (Lei nº 12.965/2014) pelo prazo de 6 (seis) meses.</li>
            </ul>

            <SecaoTitulo numero={4}>Compartilhamento com Terceiros</SecaoTitulo>
            <p>
                Nós <strong>não vendemos</strong> seus dados em hipótese alguma. O compartilhamento ocorre estritamente
                com parceiros técnicos necessários para a viabilidade do Software, sob rigorosos contratos de sigilo:
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li><strong>Infraestrutura e Nuvem:</strong> Provedores de banco de dados e hospedagem (Ex: Neon/PostgreSQL, Render, Vercel, AWS).</li>
                <li><strong>Emissão Fiscal:</strong> Gateways homologados (FocusNFe/PlugNotas), apenas quando o Lojista opta por transmitir Notas Fiscais para a SEFAZ.</li>
                <li><strong>Processamento de Pagamento:</strong> Empresas de faturamento recorrente para a cobrança da assinatura mensal do sistema.</li>
                <li><strong>Provedores de Inteligência Artificial (Consultor da Loja):</strong> APIs de inferência (DeepSeek e Groq) recebem exclusivamente indicadores financeiros e operacionais agregados e <strong>pseudonimizados</strong> (sem nomes, CPFs, telefones ou e-mails de funcionários ou clientes).</li>
            </ul>

            <SecaoTitulo numero={5}>Inteligência Artificial (Consultor da Loja), Pseudonimização e Opt-Out</SecaoTitulo>
            <p>
                O módulo <strong>Consultor da Loja</strong> foi desenhado sob o princípio de <em>Privacy by Design</em> (Art. 46 da LGPD):
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li><strong>Pseudonimização Obrigatória:</strong> Nomes de funcionários e clientes nunca saem do banco de dados da loja para provedores externos de IA; são convertidos internamente em identificadores anônimos (<code>Funcionário #ID</code> e <code>Cliente #ID</code>).</li>
                <li><strong>RAG Determinístico sem Acesso Direto ao Banco:</strong> O modelo de linguagem nunca executa SQL nem acessa tabelas brutas, interpretando apenas resumos determinísticos auditáveis.</li>
                <li><strong>Controle de Desativação (Opt-Out):</strong> O Lojista pode desligar o Consultor da Loja a qualquer instante em <strong>Configurações &gt; Sistema &gt; Consultor da Loja (IA) Ativo (LGPD)</strong>, bloqueando imediatamente qualquer envio de contexto para provedores de IA.</li>
            </ul>

            <SecaoTitulo numero={6}>Como Protegemos os Dados</SecaoTitulo>
            <p>
                Utilizamos as melhores práticas de mercado, incluindo:
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>Isolamento Lógico (Multi-Tenant) no Banco de Dados: Um Lojista nunca tem acesso aos clientes ou funcionários de outro Lojista.</li>
                <li>Criptografia ponta a ponta (SSL/TLS) na transmissão entre o navegador (PDV) e o servidor.</li>
                <li>Hashing seguro (BCrypt/Argon2) irreversível para o armazenamento de todas as senhas de usuários e PINs de estorno.</li>
            </ul>

            <SecaoTitulo numero={7}>Seus Direitos como Titular</SecaoTitulo>
            <p>
                O Lojista (Contratante) tem o direito de solicitar a qualquer momento:
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>A confirmação da existência de tratamento de seus dados.</li>
                <li>O acesso e a correção de dados incompletos, inexatos ou desatualizados.</li>
                <li>A exclusão ou portabilidade de seus dados, no momento do encerramento da assinatura.</li>
            </ul>
            <p className="mt-4">
                Para o exercício destes direitos ou qualquer dúvida sobre privacidade, entre em contato diretamente 
                com o nosso Encarregado de Proteção de Dados (DPO) através do e-mail:{' '}
                <a href={`mailto:${legalInfo.emailPrivacidade}`} className="font-bold text-blue-600 hover:underline">
                    {legalInfo.emailPrivacidade}
                </a>.
            </p>
        </LegalLayout>
    );
};

export default PrivacidadePage;
