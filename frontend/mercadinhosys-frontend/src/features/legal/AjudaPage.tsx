import React, { useState } from 'react';
import {
    ShoppingCart, ShieldAlert, Wallet, Clock, WifiOff,
    ChevronDown, Mail, MessageCircle, Truck, Activity
} from 'lucide-react';
import LegalLayout, { SecaoTitulo } from './LegalLayout';
import { legalInfo, whatsappLink } from './legalInfo';

const secoesManuais = [
    {
        Icon: ShoppingCart, titulo: 'Frente de Caixa e PDV',
        desc: 'Operação de caixa, leitura de códigos de barras, múltiplos pagamentos e abertura/fechamento.'
    },
    {
        Icon: WifiOff, titulo: 'Modo Offline (SyncQueue)',
        desc: 'O que acontece quando a internet cai e como o sistema sincroniza os dados automaticamente.'
    },
    {
        Icon: Wallet, titulo: 'Gestão Financeira e Fluxo',
        desc: 'Contas a Pagar, Despesas, cálculo de pressão de caixa e gestão de fiado (crediário).'
    },
    {
        Icon: Clock, titulo: 'Recursos Humanos e Ponto',
        desc: 'Controle de funcionários, folha de pagamento, ponto por geolocalização e provisões.'
    },
    {
        Icon: Truck, titulo: 'Logística e Frota',
        desc: 'Gestão de veículos, manutenção, abastecimentos, rotas de entrega e checklist de saída.'
    },
    {
        Icon: ShieldAlert, titulo: 'Auditoria e Segurança',
        desc: 'Logs de acessos, estornos no caixa, permissões de usuários e limites de crédito.'
    },
];

const metricasGerenciais = [
    {
        q: 'Pressão de Caixa Diária (O Custo Invisível)',
        a: 'A Pressão de Caixa é o valor EXATO que sua loja precisa vender no dia atual para não fechar no vermelho. Ela não soma apenas os boletos do dia. A fórmula inclui:\n\n1. Boletos vencendo hoje (Contas a Pagar).\n2. Rateio diário das Despesas Fixas (Aluguel, Luz, Internet ÷ 30).\n3. Custo Diário do RH (Salário Bruto + Encargos + Provisão de 1/12 de Férias e 13º ÷ 30).\n\nSe a Pressão de Caixa está em R$ 1.500,00 e você vendeu R$ 1.200,00, a loja deu prejuízo operacional naquele dia.',
    },
    {
        q: 'DRE (Demonstrativo do Resultado do Exercício)',
        a: 'O DRE Gerencial do MercadinhoSys mostra se a empresa deu lucro ou prejuízo no mês. Ele pega o Faturamento Bruto, subtrai as Devoluções e o Custo da Mercadoria Vendida (CMV), resultando no Lucro Bruto. Desse valor, ele desconta as Despesas Operacionais e Folha de Pagamento para chegar ao Lucro Líquido Real.',
    },
    {
        q: 'CRM e Algoritmo RFM (Limite de Crédito Fiado)',
        a: 'Para blindar sua loja contra calotes, nosso motor avalia cada cliente do crediário com base no RFM:\n\n- Recência (Quantos dias desde a última compra)\n- Frequência (Quantas vezes compra no mês)\n- Valor Monetário (Quanto gasta em média)\n\nClientes com atraso superior aos dias de tolerância têm seu "Score" rebaixado para Risco Alto e o PDV bloqueia novas vendas na caderneta (fiado) automaticamente.',
    },
    {
        q: 'Curva ABC de Estoque',
        a: 'O sistema classifica seus produtos automaticamente em A, B e C com base no impacto no faturamento e na frequência de saída. Produtos "A" (representam 80% do seu lucro) não podem faltar em hipótese alguma. O sistema gera alertas de ressuprimento antes que eles acabem, evitando ruptura de prateleira.',
    },
    {
        q: 'Cálculo de KM/L e Fraudes de Frota',
        a: 'No módulo de Logística, o sistema cruza o hodômetro (KM atual) com os litros abastecidos. Se um caminhão faz em média 10km/L e subitamente a média cai para 5km/L, o sistema dispara um alerta de "Consumo Anômalo", indicando possível desvio (roubo) de combustível ou falha mecânica grave.',
    }
];

const baseDeConhecimento = [
    {
        q: 'Como o PDV funciona sem internet (Modo Offline)?',
        a: 'O MercadinhoSys possui um banco de dados embutido no seu navegador. Se a internet cair, o caixa continua operando normalmente: lendo produtos, gerando cupons e finalizando vendas. Assim que a conexão for restabelecida, uma fila oculta (SyncQueue) enviará todas as transações pendentes para o servidor de forma segura e sem duplicidade.',
    },
    {
        q: 'Meu produto não tem código de barras. Como imprimir a etiqueta?',
        a: 'Em Produtos, clique em "Etiquetas", escolha os produtos e use o botão "Gerar código interno". O sistema cria um EAN-13 exclusivo da sua loja (começa com 20, faixa que a GS1 reserva para uso interno, então não conflita com produtos de mercado) e salva no cadastro. Depois é só imprimir, colar a etiqueta e bipar no PDV. Produtos com código do fabricante mantêm o código original. A geração é liberada para gerente e administrador.',
    },
    {
        q: 'Onde configuro o TEF ou maquininha de cartão?',
        a: 'Atualmente o MercadinhoSys opera como um ERP de conciliação administrativa. O caixa deve passar o cartão na maquininha física (PagSeguro, Cielo, etc.) e registrar no sistema a forma de pagamento (Crédito, Débito) e o status (Aprovado). O dinheiro vai diretamente para a conta bancária atrelada à sua maquininha.',
    },
    {
        q: 'Como emitir NFC-e ou NF-e?',
        a: 'É necessário possuir um CNPJ ativo e um Certificado Digital A1. O sistema se integra a gateways homologados (FocusNFe/PlugNotas) para assinar digitalmente e transmitir a nota à SEFAZ. Consulte o suporte técnico para solicitar a ativação da emissão fiscal no seu tenant.',
    },
];

const AjudaPage: React.FC = () => {
    const [abertaFAQ, setAbertaFAQ] = useState<number | null>(0);
    const [abertaMetrica, setAbertaMetrica] = useState<number | null>(0);
    const wa = whatsappLink('Olá, preciso de suporte técnico com o MercadinhoSys.');

    return (
        <LegalLayout
            titulo="Central de Suporte"
            subtitulo={`Base de conhecimento oficial e manuais de operação do ERP ${legalInfo.produto}.`}
            mostrarData={false}
        >
            <div className="text-sm text-gray-400 dark:text-slate-500 mb-8 border-b border-slate-200 pb-4">
                Encontre tutoriais de uso, entenda as regras de negócio ou abra um chamado técnico.
            </div>

            {/* Manuais por Módulo */}
            <section className="mb-10">
                <SecaoTitulo>Documentação por Módulos</SecaoTitulo>
                <div className="grid sm:grid-cols-2 gap-4 mt-6">
                    {secoesManuais.map(({ Icon, titulo, desc }) => (
                        <div key={titulo} className="flex gap-4 items-start p-4 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="shrink-0 w-10 h-10 bg-white border border-slate-200 rounded-md flex items-center justify-center text-slate-700 shadow-sm">
                                <Icon className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 text-sm mb-1">{titulo}</h3>
                                <p className="text-xs text-gray-400 dark:text-slate-500 leading-relaxed">{desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Métricas e Indicadores (A Pedido do CEO) */}
            <section className="mb-10">
                <div className="flex items-center gap-2 pt-2">
                    <Activity className="w-6 h-6 text-emerald-600" />
                    <h2 className="text-xl font-extrabold text-slate-900">Indicadores e Métricas de Alta Gestão</h2>
                </div>
                <p className="text-sm text-gray-400 dark:text-slate-600 mt-2 mb-6">
                    Entenda como o MercadinhoSys calcula as métricas vitais para a saúde da sua empresa. 
                    Nós vamos muito além do simples contas a pagar/receber.
                </p>
                <div className="space-y-3">
                    {metricasGerenciais.map((item, i) => {
                        const open = abertaMetrica === i;
                        return (
                            <div key={i} className="border border-emerald-200 rounded-lg overflow-hidden bg-white shadow-sm">
                                <button
                                    onClick={() => setAbertaMetrica(open ? null : i)}
                                    className="w-full flex items-center justify-between py-3.5 px-4 text-left hover:bg-emerald-50 transition-colors"
                                    aria-expanded={open}
                                >
                                    <span className={`text-[15px] font-bold ${open ? 'text-emerald-700' : 'text-slate-800'}`}>{item.q}</span>
                                    <ChevronDown className={`w-5 h-5 text-emerald-600 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                                </button>
                                {open && (
                                    <div className="px-4 pb-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border-t border-emerald-100 pt-3">
                                        {item.a}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Base de Conhecimento (FAQ) */}
            <section className="mb-10">
                <SecaoTitulo>Dúvidas Frequentes (Knowledge Base)</SecaoTitulo>
                <div className="mt-6 space-y-2 border-y border-slate-200 py-4">
                    {baseDeConhecimento.map((item, i) => {
                        const open = abertaFAQ === i;
                        return (
                            <div key={i} className="border-b border-slate-100 last:border-0 pb-2">
                                <button
                                    onClick={() => setAbertaFAQ(open ? null : i)}
                                    className="w-full flex items-center justify-between py-3 text-left hover:bg-slate-50 px-2 rounded-md transition-colors"
                                    aria-expanded={open}
                                >
                                    <span className={`text-[15px] font-semibold ${open ? 'text-blue-700' : 'text-slate-800'}`}>{item.q}</span>
                                    <ChevronDown className={`w-5 h-5 text-gray-500 dark:text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                                </button>
                                {open && (
                                    <div className="px-2 pb-4 pt-1 text-sm text-gray-400 dark:text-slate-600 leading-relaxed whitespace-pre-wrap">
                                        {item.a}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Abertura de Chamado (Ticketing) */}
            <section>
                <SecaoTitulo>Atendimento Técnico</SecaoTitulo>
                <p className="text-sm text-gray-400 dark:text-slate-600 mb-4 mt-2">
                    Não encontrou o que precisava? Nossa equipe de engenharia e suporte de Nível 2 está disponível em horário comercial (08:00 às 18:00).
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                    <a
                        href={`mailto:${legalInfo.emailContato}`}
                        className="flex flex-col gap-2 p-5 border border-slate-200 rounded-lg hover:border-slate-300 hover:bg-slate-50 transition"
                    >
                        <Mail className="w-6 h-6 text-gray-400 dark:text-slate-600 mb-1" />
                        <h4 className="font-bold text-slate-800 text-sm">Abertura de Ticket (E-mail)</h4>
                        <p className="text-xs text-gray-400 dark:text-slate-500">{legalInfo.emailContato}</p>
                    </a>
                    {wa && (
                        <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-col gap-2 p-5 border border-slate-200 rounded-lg hover:border-slate-300 hover:bg-slate-50 transition"
                        >
                            <MessageCircle className="w-6 h-6 text-gray-400 dark:text-slate-600 mb-1" />
                            <h4 className="font-bold text-slate-800 text-sm">Suporte via WhatsApp</h4>
                            <p className="text-xs text-gray-400 dark:text-slate-500">Apenas chat textual. Não recebe ligações.</p>
                        </a>
                    )}
                </div>
            </section>
        </LegalLayout>
    );
};

export default AjudaPage;
