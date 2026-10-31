import React from 'react';
import LegalLayout, { SecaoTitulo } from './LegalLayout';
import { legalInfo, whatsappLink } from './legalInfo';

const TermosPage: React.FC = () => {
    return (
        <LegalLayout
            titulo="Termos e Condições de Uso"
            subtitulo={`Termos legais para utilização da plataforma ${legalInfo.produto}.`}
        >
            <p>
                Este instrumento contém as condições gerais de uso e de contratação aplicáveis à utilização
                do sistema <strong>{legalInfo.produto}</strong>, doravante denominado simplesmente "Software",
                desenvolvido e operado por <strong>{legalInfo.razaoSocial}</strong>, inscrita no CNPJ sob o
                nº {legalInfo.cnpj}, com sede em {legalInfo.cidadeUf}, doravante denominada "Licenciante".
            </p>
            <p>
                Ao criar uma conta, utilizar, acessar ou navegar pelo Software, você (pessoa física ou jurídica),
                doravante denominado "Licenciado", concorda expressa e integralmente com os presentes Termos de Uso.
            </p>

            <SecaoTitulo numero={1}>Do Objeto</SecaoTitulo>
            <p>
                A Licenciante concede ao Licenciado uma licença revogável, não exclusiva, intransferível e limitada
                para uso do Software sob a modalidade de <em>Software as a Service (SaaS)</em>. O acesso é
                fornecido estritamente via internet (navegador web), não havendo entrega de código-fonte ou
                instalação local definitiva.
            </p>

            <SecaoTitulo numero={2}>Das Obrigações do Licenciado</SecaoTitulo>
            <p>O Licenciado compromete-se a:</p>
            <ul className="list-disc pl-5 space-y-2">
                <li>Manter o sigilo de suas credenciais de acesso (login, senhas e PINs de cancelamento).</li>
                <li>Fornecer dados cadastrais verdadeiros, mantendo-os atualizados na plataforma.</li>
                <li>
                    Garantir que a operação do Software por seus funcionários ocorra em conformidade com as leis
                    trabalhistas, fiscais e comerciais vigentes no país.
                </li>
                <li>
                    Obter consentimento legal de seus próprios clientes finais caso insira seus dados (como CPF,
                    telefone ou biometria) na base de dados do sistema, conforme exige a LGPD.
                </li>
            </ul>

            <SecaoTitulo numero={3}>Da Tributação e Emissão Fiscal</SecaoTitulo>
            <p>
                O Software atua apenas como facilitador operacional e transmissor de dados. <strong>A Licenciante não
                assume qualquer responsabilidade sobre o correto enquadramento tributário, cálculo de alíquotas
                (ICMS, PIS, COFINS, NCM, CFOP) ou obrigações acessórias do Licenciado.</strong>
            </p>
            <p>
                A parametrização tributária e a emissão de documentos fiscais (NF-e, NFC-e) são de inteira
                responsabilidade do Licenciado e de seu Contador. A Licenciante isenta-se de multas, autuações ou
                penalidades impostas pela SEFAZ ou Receita Federal decorrentes do uso inadequado da ferramenta.
            </p>

            <SecaoTitulo numero={4}>Nível de Serviço (SLA) e Disponibilidade</SecaoTitulo>
            <p>
                A Licenciante emprega os melhores esforços para garantir uma disponibilidade de <strong>99%</strong> em 
                horário comercial. Contudo, devido à natureza da rede de internet e dos serviços em nuvem, o Software
                é fornecido no estado em que se encontra (<em>"as is"</em>), sem garantias de que será ininterrupto 
                ou totalmente livre de falhas temporárias.
            </p>
            <p>
                O Software dispõe de recursos operacionais <strong>Offline (SyncQueue)</strong> para operação de caixa
                sem internet. É responsabilidade do Licenciado conectar o sistema à internet periodicamente para que
                a fila de sincronização (SyncQueue) não expire ou seja corrompida pela limpeza do cache local do navegador.
            </p>

            <SecaoTitulo numero={5}>Limitação de Responsabilidade Civil</SecaoTitulo>
            <p>
                A Licenciante não se responsabiliza por:
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>Danos indiretos, incidentais ou lucros cessantes oriundos de quedas de conexão ou falhas de provedores em nuvem.</li>
                <li>Perda de dados armazenados exclusivamente no cache local (IndexedDB) caso o Licenciado formate ou limpe o dispositivo antes da sincronização.</li>
                <li>Discrepâncias de estoque, caixa ou folha de pagamento derivadas de alimentação manual incorreta ou uso indevido de senhas de gerência.</li>
                <li>Falhas na comunicação com equipamentos de hardware (maquininhas de cartão, TEF, balanças ou impressoras) que não sejam homologados expressamente pela Licenciante.</li>
            </ul>
            <p className="font-bold text-slate-900 mt-4 bg-slate-100 p-4 rounded-md">
                Em qualquer hipótese, a responsabilidade pecuniária máxima da Licenciante para com o Licenciado 
                limita-se ao valor das mensalidades pagas pelo uso do Software nos últimos 3 (três) meses.
            </p>

            <SecaoTitulo numero={6}>Pagamentos, Inadimplência e Bloqueio</SecaoTitulo>
            <p>
                O uso contínuo do sistema está condicionado ao pagamento regular da mensalidade via assinatura.
                O atraso superior a <strong>5 (cinco) dias</strong> resultará no bloqueio preventivo (suspensão)
                do acesso, limitando a visualização apenas para extração de relatórios básicos, sem operação de frente de loja.
            </p>

            <SecaoTitulo numero={7}>Suporte Técnico</SecaoTitulo>
            <p>
                O suporte será prestado prioritariamente via e-mail (<a href={`mailto:${legalInfo.emailContato}`} className="text-blue-600 hover:underline">{legalInfo.emailContato}</a>)
                {legalInfo.whatsapp ? (
                    <span> ou WhatsApp (<a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Chat</a>)</span>
                ) : ''} em dias úteis, das 08h00 às 18h00, horário de Brasília.
            </p>

            <SecaoTitulo numero={8}>Do Uso de Inteligência Artificial e Proteção de Dados (LGPD)</SecaoTitulo>
            <p>
                O módulo <strong>Consultor da Loja (IA)</strong> opera como copiloto analítico do Licenciado em
                estrita conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD):
            </p>
            <ul className="list-disc pl-5 space-y-2">
                <li>
                    <strong>Pseudonimização na Origem:</strong> Nomes reais de funcionários e clientes nunca são
                    transmitidos aos provedores de modelos de linguagem (LLMs). Toda evidência operacional utiliza
                    exclusivamente identificadores internos pseudonimizados (ex.: <code>Funcionário #ID</code> e <code>Cliente #ID</code>).
                </li>
                <li>
                    <strong>Evidência Determinística Auditável:</strong> O modelo de IA não executa consultas SQL livres
                    no banco de dados, recebendo apenas indicadores consolidados pelo próprio Software, com indicação
                    transparente da fonte de cada número na interface.
                </li>
                <li>
                    <strong>Ações Mediante Confirmação Humana:</strong> Toda ação sugerida pelo copiloto (como criação
                    de lembretes financeiros ou rascunhos de pedido de compra) exige confirmação explícita do gestor
                    autenticado e é registrada em log de auditoria.
                </li>
                <li>
                    <strong>Direito de Desativação (Opt-out):</strong> O Licenciado pode desativar o Consultor da Loja
                    a qualquer momento em <strong>Configurações &gt; Sistema</strong>, interrompendo imediatamente qualquer
                    processamento por provedores de IA.
                </li>
            </ul>

            <SecaoTitulo numero={9}>Foro</SecaoTitulo>
            <p>
                Fica eleito o foro da Comarca de {legalInfo.cidadeUf} para dirimir quaisquer dúvidas ou litígios
                decorrentes da interpretação destes Termos, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
            </p>
        </LegalLayout>
    );
};

export default TermosPage;
