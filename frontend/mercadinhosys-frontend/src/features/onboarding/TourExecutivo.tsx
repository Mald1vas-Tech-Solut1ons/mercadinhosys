import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

const steps = [
    {
        target: '.tour-indicadores',
        title: 'Visão de Águia (Dashboard)',
        content: 'O Intelligence Hub processa dados de vendas, despesas e estoque em tempo real. Acompanhe seu faturamento diário, identifique imediatamente clientes inadimplentes e receba alertas da IA sobre rupturas de estoque.',
        route: '/dashboard'
    },
    {
        target: '.tour-produtos-upload',
        title: 'Gestão Inteligente de Estoque',
        content: 'Nunca mais perca vendas por falta de produto. O sistema alerta automaticamente quando o estoque mínimo é atingido. Você pode cadastrar milhares de itens em segundos arrastando sua planilha do Excel.',
        route: '/products'
    },
    {
        target: '.tour-clientes-upload',
        title: 'Fim do "Caderninho" de Fiado',
        content: 'Profissionalize suas vendas a prazo. Cadastre clientes com limites de crédito pré-aprovados, acompanhe faturas em aberto e envie cobranças amigáveis pelo WhatsApp em um único clique.',
        route: '/customers'
    },
    {
        target: '.tour-pdv-leitor',
        title: 'O Coração da Loja (Frente de Caixa)',
        content: 'Um PDV ultrarrápido projetado para não formar filas. Funciona perfeitamente offline (sem internet), aceita múltiplas formas de pagamento e sincroniza tudo com a nuvem automaticamente quando a conexão volta.',
        route: '/pdv'
    },
    {
        target: '.tour-vendas-historico',
        title: 'Controle Absoluto de Vendas',
        content: 'Audite cada transação realizada na loja. Consulte cupons emitidos, aprove cancelamentos com senha de gerente e reimprima comprovantes fiscais com facilidade e total transparência.',
        route: '/sales'
    },
    {
        target: '.tour-delivery-visao',
        title: 'Logística de Entregas (Delivery)',
        content: 'Recebe pedidos pelo WhatsApp? Despache as entregas por aqui. Monitore o status de cada pedido, atribua motoboys e controle o tempo de rota até a casa do seu cliente.',
        route: '/delivery'
    },
    {
        target: '.tour-despesas-add',
        title: 'Contas a Pagar e Despesas',
        content: 'A saúde financeira do seu mercado depende disso. Registre contas de luz, água, folha de pagamento e boletos de fornecedores. Descubra exatamente para onde o seu dinheiro está indo no fim do mês.',
        route: '/expenses'
    },
    {
        target: '.tour-compras-visao',
        title: 'Setor de Compras e Cotações',
        content: 'Não compre no escuro. Analise a curva ABC e saiba exatamente o que pedir aos seus fornecedores. Acompanhe prazos de entrega e reabasteça estrategicamente seu estoque sem congelar capital.',
        route: '/compras'
    },
    {
        target: '.tour-relatorios-visao',
        title: 'Relatórios Gerenciais',
        content: 'Emita fechamentos de caixa detalhados, Demonstrações de Resultado do Exercício (DRE), balancetes financeiros e extratos de performance. Tudo que a sua contabilidade precisa, a um clique.',
        route: '/reports'
    },
    {
        target: '.tour-rh-visao',
        title: 'Gestão de Recursos Humanos',
        content: 'Controle totalmente a sua equipe. Administre salários base, adiantamentos, vales e histórico de colaboradores. Mantenha os custos operacionais da equipe sempre sob controle.',
        route: '/rh'
    },
    {
        target: '.tour-ponto-bater',
        title: 'Ponto Digital Biométrico',
        content: 'Segurança jurídica para o dono da loja. Seus funcionários registram entrada e saída com validação de foto e geolocalização por GPS. Nunca mais pague horas extras indevidas.',
        route: '/ponto'
    }
];

const TourExecutivo: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    
    const [run, setRun] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

    // Iniciar pelo botão da barra lateral
    useEffect(() => {
        const handleForceStart = () => {
            setStepIndex(0);
            setRun(true);
        };
        window.addEventListener('start-tour', handleForceStart);
        return () => window.removeEventListener('start-tour', handleForceStart);
    }, []);

    // Atualiza a posição do target atual
    useEffect(() => {
        if (!run) return;

        const step = steps[stepIndex];
        if (!step) {
            setRun(false);
            return;
        }

        // Se rota estiver errada, navega e espera
        if (location.pathname !== step.route) {
            navigate(step.route);
            return;
        }

        let observer: MutationObserver;
        
        const updateRect = () => {
            const el = document.querySelector(step.target);
            if (el) {
                setTargetRect(el.getBoundingClientRect());
                // Trazer elemento para visualização imediatamente (sem delay de smooth)
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
        };

        updateRect();

        // Aguarda elemento aparecer caso haja delay na tela (Suspense, APIs)
        if (!document.querySelector(step.target)) {
            observer = new MutationObserver(() => {
                if (document.querySelector(step.target)) {
                    updateRect();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // Listener de resize para manter o tooltip posicionado corretamente
        let resizeTimer: any;
        const handleResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(updateRect, 100);
        };
        window.addEventListener('resize', handleResize);
        
        return () => {
            if (observer) observer.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [run, stepIndex, location.pathname, navigate]);

    const handleNext = () => {
        if (stepIndex < steps.length - 1) {
            setTargetRect(null); // Esconde temporariamente até recalcular
            setStepIndex(stepIndex + 1);
        } else {
            setRun(false);
        }
    };

    const handlePrev = () => {
        if (stepIndex > 0) {
            setTargetRect(null);
            setStepIndex(stepIndex - 1);
        }
    };

    const handleClose = () => {
        setRun(false);
    };

    if (!run) return null;

    const currentStep = steps[stepIndex];

    return (
        <div className="fixed inset-0 z-10000 pointer-events-none">
            {/* Overlay escuro */}
            <div className="absolute inset-0 bg-black/60 pointer-events-auto" onClick={handleClose} />
            
            {/* Recorte do Spotlight (Destaque) */}
            {targetRect && (
                <div 
                    className="absolute border-4 border-blue-500 rounded-lg pointer-events-none"
                    style={{
                        top: targetRect.top - 8,
                        left: targetRect.left - 8,
                        width: targetRect.width + 16,
                        height: targetRect.height + 16,
                        // Sem transition-all aqui para evitar lag massivo de GPU ao redesenhar a box-shadow de 9999px
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.6), 0 0 20px rgba(59, 130, 246, 0.8)'
                    }}
                />
            )}

            {/* Tooltip Dinâmico */}
            {targetRect && (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-[450px] pointer-events-auto border border-gray-100 dark:border-slate-700"
                    style={{
                        // Posiciona abaixo do elemento, se houver espaço. Senão, acima.
                        top: targetRect.bottom + 20 > window.innerHeight - 200 ? targetRect.top - 200 : targetRect.bottom + 20,
                        // Centraliza baseado no elemento
                        left: Math.max(20, Math.min(targetRect.left + (targetRect.width / 2) - 225, window.innerWidth - 470))
                    }}
                >
                    <button 
                        onClick={handleClose}
                        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    
                    <div className="flex items-center gap-3 mb-4">
                        <img src="/assets/logo.png" alt="MercadinhoSys Logo" className="w-8 h-8 object-contain" />
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white pr-6">{currentStep.title}</h3>
                    </div>
                    
                    <p className="text-gray-600 dark:text-gray-300 mb-8">{currentStep.content}</p>
                    
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-400">
                            Passo {stepIndex + 1} de {steps.length}
                        </span>
                        <div className="flex gap-2">
                            {stepIndex > 0 && (
                                <button 
                                    onClick={handlePrev}
                                    className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-lg transition-colors"
                                >
                                    Voltar
                                </button>
                            )}
                            <button 
                                onClick={handleNext}
                                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-colors"
                            >
                                {stepIndex === steps.length - 1 ? 'Finalizar' : 'Próximo'}
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default TourExecutivo;
