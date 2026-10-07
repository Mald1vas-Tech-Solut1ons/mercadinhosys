import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../auth/authService';
import {
    ShoppingCart,
    ShieldCheck,
    MessageCircle,
    Star,
    Mail,
    Phone,
    User,
    Check,
    Truck,
    X,
    Briefcase,
    Building2,
    Users,
    FileText,
    Activity,
    Lock,
    MapPin,
    ChevronDown,
    ChevronUp,
    Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { showToast } from '../../utils/toast';
import { API_CONFIG } from '../../api/apiConfig';

const SplashIntro: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    return (
        <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="fixed inset-0 z-9999 flex flex-col items-center justify-center overflow-hidden"
            style={{ background: 'radial-gradient(120% 140% at 50% 0%, #1D4ED8 0%, #0F2E5C 55%, #0A1220 100%)' }}
        >
            <motion.div 
                className="absolute w-2.5 h-2.5 bg-white rounded-sm"
                style={{ top: '35%', left: '35%' }}
                animate={{ rotate: 45, scale: [0.4, 1, 0.4], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, delay: 0.5, ease: "easeInOut" }}
            />
            <motion.div 
                className="absolute w-1.5 h-1.5 bg-white rounded-sm"
                style={{ top: '45%', left: '25%' }}
                animate={{ rotate: 45, scale: [0.4, 1, 0.4], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, delay: 0.9, ease: "easeInOut" }}
            />
            <motion.div 
                className="absolute w-2 h-2 bg-white rounded-sm"
                style={{ top: '38%', right: '35%' }}
                animate={{ rotate: 45, scale: [0.4, 1, 0.4], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, delay: 1.2, ease: "easeInOut" }}
            />

            <motion.img 
                src="/assets/logo.png" 
                alt="MercadinhoSyS"
                className="w-28 h-28 rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: [0.3, 1.08, 1], opacity: 1 }}
                transition={{ duration: 0.7, ease: [0.2, 1.4, 0.4, 1] }}
            />

            <motion.div 
                className="font-['Archivo',sans-serif] font-extrabold text-4xl text-white tracking-wide mt-6"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.45, ease: "easeOut" }}
            >
                Mercadinho<span className="text-[#FF6A5C]">SyS</span>
            </motion.div>

            <motion.div 
                className="text-lg text-white/75 mt-2"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.8, ease: "easeOut" }}
            >
                Sua loja inteira, num app só.
            </motion.div>

            <motion.div 
                className="w-48 h-1.5 rounded-full bg-white/20 overflow-hidden mt-8"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 1.0, ease: "easeOut" }}
            >
                <motion.div 
                    className="h-full rounded-full bg-linear-to-r from-[#2E9BFF] to-[#6FCBFF]"
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.4, delay: 1.15, ease: "easeInOut" }}
                    onAnimationComplete={onComplete}
                />
            </motion.div>
        </motion.div>
    );
};

const LandingPage: React.FC = () => {
    const navigate = useNavigate();
    const [leadName, setLeadName] = useState('');
    const [leadEmail, setLeadEmail] = useState('');
    const [leadWhatsApp, setLeadWhatsApp] = useState('');
    const [loadingLead, setLoadingLead] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [conversionModalOpen, setConversionModalOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<{ name: string, price: string } | null>(null);
    const [onboardingEmail, setOnboardingEmail] = useState('');
    const [onboardingWhatsApp, setOnboardingWhatsApp] = useState('');
    const [onboardingStoreName, setOnboardingStoreName] = useState('');
    const [loadingCheckout, setLoadingCheckout] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    
    // FAQ state
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    
    // Splash State
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowSplash(false);
        }, 3000); // Failsafe in case animation onComplete fails
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const token = sessionStorage.getItem('access_token');
        if (token) {
            authService.logout();
        }
    }, []);

    const handleLeadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoadingLead(true);
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/saas/leads/registrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: leadName, email: leadEmail, whatsapp: leadWhatsApp, origem: 'landing_page' }),
            });
            const result = await response.json();
            if (response.ok && result.success) {
                showToast.info('Informações enviadas! Entraremos em contato em breve.');
                setLeadName(''); setLeadEmail(''); setLeadWhatsApp('');
                setTimeout(() => {
                    window.open(`https://wa.me/5511919889233?text=Olá! Acabei de me cadastrar no site e gostaria de saber mais sobre o MercadinhoSys para minha empresa. Meu e-mail é ${leadEmail}.`, '_blank');
                }, 1000);
            } else {
                showToast.error(result.error || 'Ocorreu um erro ao enviar seus dados.');
            }
        } catch {
            showToast.error('Erro de conexão com o servidor.');
        } finally {
            setLoadingLead(false);
        }
    };

    const handlePlanSelect = (tier: { name: string, price: string }) => {
        setSelectedPlan({ name: tier.name, price: tier.price });
        setConversionModalOpen(true);
    };

    const handleCheckout = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!termsAccepted) {
            showToast.error('Você precisa aceitar os Termos de Uso e Política de Privacidade para prosseguir.');
            return;
        }
        setLoadingCheckout(true);
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/billing/public-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: onboardingEmail,
                    whatsapp: onboardingWhatsApp,
                    nome_loja: onboardingStoreName,
                    plan_name: selectedPlan?.name
                }),
            });
            const result = await response.json();
            if (response.ok && result.checkout_url) {
                showToast.create('Conta criada! Redirecionando para o pagamento...');
                window.location.href = result.checkout_url;
            } else {
                showToast.error(result.message || 'Erro ao iniciar checkout.');
            }
        } catch {
            showToast.error('Erro de conexão.');
        } finally {
            setLoadingCheckout(false);
        }
    };

    const handleDemoAccess = async () => {
        try {
            showToast.loading('Preparando ambiente de demonstração...');
            const response = await fetch(`${API_CONFIG.BASE_URL}/auth/demo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (response.ok && result.success) {
                const data = result.data || {};
                const access_token = data.access_token || result.access_token;
                const refresh_token = data.refresh_token || result.refresh_token;
                const user = data.user;
                const estabelecimento = data.estabelecimento;

                if (access_token) sessionStorage.setItem('access_token', access_token);
                if (refresh_token) sessionStorage.setItem('refresh_token', refresh_token);
                if (user) sessionStorage.setItem('user_data', JSON.stringify(user));
                if (estabelecimento) localStorage.setItem('estabelecimento_data', JSON.stringify(estabelecimento));
                
                window.dispatchEvent(new Event('auth-change'));
                showToast.dismiss();
                showToast.info('Entrando no ambiente de demonstração...', { icon: '✨' });
                setTimeout(() => { window.location.href = '/dashboard'; }, 500);
            } else {
                showToast.dismiss();
                showToast.error(result.error || 'Erro ao acessar demonstração');
            }
        } catch {
            showToast.dismiss();
            showToast.error('Erro de conexão com o servidor demo.');
        }
    };

    const tiers = [
        {
            name: 'Gratuito',
            price: 'Grátis',
            period: 'Plano de entrada',
            description: 'Para colocar a operação no eixo e testar o sistema sem investimento inicial.',
            features: [
                '1 usuário administrador',
                'PDV e gestão de caixa',
                'Produtos, clientes e fornecedores',
                'Dashboard executivo básico',
                'Ideal para operação essencial'
            ],
            cta: 'Ativar Plano Grátis',
            highlight: false
        },
        {
            name: 'Pro',
            price: 'R$ 99,90',
            period: '/mês (Oferta de Lançamento)',
            description: 'Para crescer com controle, produtividade e visão gerencial da operação.',
            features: [
                'Terminais PDV Ilimitados',
                'Compras & Doca com recebimento',
                'Vendas analíticas e histórico gerencial',
                'Módulo SFA (Força de Vendas)',
                'Módulo RH (Holerite e Ponto GPS)',
                'Emissão NFe/NFCe Automática',
                'Gestão Financeira e DRE',
                'Auditoria e Controle de Acesso',
                'Consultor M-IA (Gestor Inteligente)',
                'Suporte VIP Prioritário'
            ],
            cta: 'Assinar Plano Pro',
            highlight: true
        }
    ];

    const faqs = [
        { q: "O sistema atende distribuidores e atacadistas?", a: "Sim! O MercadinhoSys foi construído com arquitetura de ERP de ponta. Temos controle rigoroso de estoque, grades, lotes, comissionamento multinível e módulo SFA (Força de Vendas) para representantes comerciais." },
        { q: "E se a minha internet cair, o PDV para?", a: "Nunca. Nosso PDV possui tecnologia Offline-First. Você continua vendendo e emitindo cupons normalmente. Assim que a internet voltar, tudo é sincronizado para a nuvem automaticamente." },
        { q: "Como funciona o controle de ponto do RH?", a: "É um RH de verdade! Seus funcionários batem ponto pelo celular ou tablet com registro de Foto e Geolocalização (GPS). O sistema gera relatórios completos e até holerites para sua equipe." },
        { q: "Consigo limitar o que meus funcionários acessam?", a: "Com certeza. Temos um controle de acesso granular de nível empresarial. Você define exatamente o que o Caixa, o Gerente e o Repositor podem ver e fazer. E tudo fica registrado no nosso log de Auditoria." },
        { q: "O que entra no plano Grátis e quando vale migrar para o Pro?", a: "O plano Grátis entrega o mínimo operacional: <strong>PDV, caixa, produtos, clientes, fornecedores e visão executiva</strong>. O plano Pro libera a gestão profissional completa, com <strong>compras, vendas analíticas, fiscal, inteligência, equipe e módulos avançados</strong>. Para quem quer sair do básico e ganhar escala com controle, o Pro é o caminho natural." },
        { q: "Existe fidelidade ou multa de cancelamento?", a: "Não. Acreditamos na qualidade do nosso sistema. Você assina, usa, e se não gostar, pode cancelar a qualquer momento sem pegadinhas ou taxas escondidas." }
    ];

    const testimonials = [
        {
            name: "Roberto Almeida",
            role: "Dono da Rede Super Bom",
            type: "Atacadista",
            text: "Eu usava um ERP famoso que me custava rios de dinheiro e era super difícil de usar. O MercadinhoSys me entregou tudo que eu precisava: Força de vendas, DRE, fiscal afiado e controle de estoque de alto nível, por uma fração do preço.",
            initial: "R",
            color: "bg-blue-500"
        },
        {
            name: "Carla Mendes",
            role: "Gerente, Mercadinho da Vila",
            type: "Varejo Local",
            text: "Antes o caixa parava quando a internet caía. Agora a gente vende sem parar! O módulo de RH também salvou minha vida, consigo tirar o holerite de todos os funcionários com dois cliques.",
            initial: "C",
            color: "bg-emerald-500"
        },
        {
            name: "Fernando Costa",
            role: "Distribuidora Costa Bebidas",
            type: "Distribuidora",
            text: "Nossos vendedores externos usam o aplicativo SFA na rua. O pedido cai na matriz na hora, a nota fiscal é emitida em segundos e a entrega já sai. Automação pura! Recomendo de olhos fechados.",
            initial: "F",
            color: "bg-purple-500"
        }
    ];

    return (
        <div className="h-screen overflow-y-auto overflow-x-hidden bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] selection:bg-[#2E9BFF] selection:text-[#06101F] custom-scrollbar relative scroll-smooth">
            
            <AnimatePresence>
                {showSplash && <SplashIntro onComplete={() => setShowSplash(false)} />}
            </AnimatePresence>

            <div className="bg-linear-to-r from-red-600 to-red-500 text-white py-2 px-4 text-center text-sm font-bold tracking-wide z-60 relative shadow-md">
                <span className="inline-block animate-pulse mr-2">⚠️</span> 
                ATENÇÃO: O SEU CONCORRENTE JÁ ESTÁ DIGITALIZADO. PARE DE PERDER DINHEIRO COM SISTEMAS OBSOLETOS.
            </div>

            {/* WhatsApp Floating Button */}
            <a
                href="https://wa.me/5511919889233"
                target="_blank"
                rel="noreferrer"
                className="fixed bottom-8 right-8 z-100 bg-emerald-500 text-white p-4 rounded-full shadow-2xl shadow-emerald-400/30 hover:scale-110 active:scale-95 transition-all flex items-center justify-center group"
            >
                <MessageCircle className="w-8 h-8" />
                <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-500 font-bold whitespace-nowrap">
                    Fale com Consultor
                </span>
            </a>

            {/* Navbar */}
            <nav className="fixed top-10 w-full z-50 bg-[#0A1220]/90 backdrop-blur-xl border-b border-[#24344F] transition-all">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-3 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                            <div className="w-12 h-12 bg-[#0A1220] rounded-xl flex items-center justify-center p-1 border border-[#24344F] group-hover:border-[#2E9BFF] transition-all overflow-hidden shadow-lg shadow-[#2E9BFF]/10">
                                <img src="/assets/logo.png" alt="MercadinhoSys Logo" className="w-full h-full object-contain" />
                            </div>
                            <span className="text-2xl font-bold text-white tracking-tighter">
                                Mercadinho<span className="text-[#FF6A5C]">Sys</span>
                            </span>
                        </div>
                        <div className="hidden lg:flex items-center gap-8">
                            <a href="#erp-features" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Tecnologia ERP</a>
                            <a href="#how-it-works" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Como Funciona</a>
                            <a href="#testimonials" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Clientes</a>
                            <a href="#pricing" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Planos</a>
                            <a href="#contact" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Contato</a>
                            <button
                                onClick={() => navigate('/login')}
                                className="px-6 py-2.5 bg-transparent border border-[#2E9BFF] text-[#6FCBFF] rounded-xl font-bold text-sm hover:bg-[#2E9BFF]/10 transition-all shadow-[0_0_15px_rgba(46,155,255,0.15)]"
                            >
                                ACESSAR PAINEL
                            </button>
                        </div>
                        <div className="lg:hidden flex items-center gap-4">
                            <button onClick={() => navigate('/login')} className="bg-transparent border border-[#2E9BFF] text-[#6FCBFF] px-4 py-2 rounded-lg font-bold text-xs">LOGIN</button>
                            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 text-[#8FA3C0]">
                                <div className="w-6 h-5 flex flex-col justify-between">
                                    <span className={`h-0.5 w-full bg-current transform transition-all duration-300 ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`}></span>
                                    <span className={`h-0.5 w-full bg-current transition-all duration-300 ${mobileMenuOpen ? 'opacity-0' : ''}`}></span>
                                    <span className={`h-0.5 w-full bg-current transform transition-all duration-300 ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`}></span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                <div className={`lg:hidden overflow-hidden transition-all duration-300 bg-[#101C31] border-b border-[#24344F] ${mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="px-4 py-6 space-y-4">
                        <a href="#erp-features" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Tecnologia ERP</a>
                        <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Como Funciona</a>
                        <a href="#testimonials" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Clientes</a>
                        <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Planos</a>
                    </div>
                </div>
            </nav>

            {/* HERO SECTION - THE DEFINITIVE ERP */}
            <section className="relative pt-40 pb-20 lg:pt-56 lg:pb-32 overflow-hidden">
                <div className="absolute top-0 right-0 -z-10 w-[900px] h-[900px] bg-[#1D4ED8]/20 rounded-full blur-[140px] translate-x-1/3 -translate-y-1/3"></div>
                <div className="absolute bottom-0 left-0 -z-10 w-[700px] h-[700px] bg-[#FF6A5C]/10 rounded-full blur-[120px] -translate-x-1/4 translate-y-1/4"></div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center">
                    <motion.div
                        initial={{ opacity: 0, y: -30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="text-center max-w-4xl flex flex-col items-center"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#2E9BFF]/10 backdrop-blur-sm border border-[#2E9BFF]/30 text-[#6FCBFF] rounded-full text-xs font-bold tracking-widest uppercase mb-6 shadow-[0_0_15px_rgba(46,155,255,0.2)]">
                            <Activity className="w-4 h-4" /> ERP SaaS para Mercados e Distribuição
                        </div>
                        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] lg:leading-[1.05] mb-8 text-white">
                            Pare de perder venda, margem e tempo. <br className="hidden sm:block" />
                            <span className="bg-linear-to-r from-[#2E9BFF] to-[#6FCBFF] bg-clip-text text-transparent">Controle sua operação em um só lugar.</span>
                        </h1>
                        <p className="text-xl lg:text-2xl text-[#8FA3C0] leading-relaxed mb-6 font-medium max-w-3xl">
                            PDV rápido, estoque confiável, compras organizadas, caixa sob controle e visão clara do negócio para <span className="text-white font-bold">mercados, mercearias, conveniências e distribuidores</span>.
                        </p>
                        <p className="text-lg text-[#8FA3C0] mb-10 max-w-3xl">
                            O <strong>MercadinhoSys</strong> reduz fila no caixa, melhora o controle de estoque, organiza o recebimento de mercadorias e transforma dados soltos em decisão operacional.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
                            {[
                                'Fila no caixa -> PDV ágil',
                                'Estoque confuso -> controle por produto e lote',
                                'Gestão no escuro -> visão executiva'
                            ].map((item) => (
                                <div key={item} className="px-4 py-2 rounded-full border border-[#24344F] bg-[#101C31]/80 text-sm font-medium text-[#DCE8F7]">
                                    {item}
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                                className="w-full sm:w-auto px-10 py-4 bg-[#2E9BFF] text-[#0A1220] rounded-[10px] font-bold text-xl hover:bg-[#6FCBFF] transition-all flex items-center justify-center shadow-[0_0_30px_rgba(46,155,255,0.4)] border border-[#2E9BFF]"
                            >
                                Conhecer Planos
                            </motion.button>

                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleDemoAccess}
                                className="w-full sm:w-auto px-10 py-4 bg-[#101C31] text-[#DCE8F7] border border-[#24344F] rounded-[10px] font-bold text-xl hover:bg-[#1A2C4D] transition-all text-center flex items-center justify-center gap-3"
                            >
                                Acessar Demonstração
                            </motion.button>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 50 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 1, delay: 0.2 }}
                        className="relative w-full max-w-[1000px] mx-auto rounded-t-[32px] rounded-b-[16px] shadow-[0_0_80px_rgba(46,155,255,0.2)] border-x-4 border-t-4 border-b-24 border-[#101C31] bg-[#0A1220] overflow-hidden group"
                    >
                        <div className="absolute top-0 left-0 right-0 h-8 bg-[#101C31] border-b border-[#24344F] flex items-center px-4 gap-2 z-20">
                            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                            <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                        </div>
                        <div className="absolute inset-0 bg-linear-to-t from-[#0A1220]/80 via-transparent to-transparent z-10 pointer-events-none"></div>
                        <video 
                            src="/assets/vídeo marketing.mp4" 
                            autoPlay 
                            loop 
                            muted 
                            playsInline 
                            className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-1000 mt-8"
                        />
                        <div className="absolute bottom-8 left-8 right-8 z-20 flex justify-between items-end">
                            <div className="flex flex-col gap-2">
                                <div className="border border-[#2E9BFF]/50 text-[#6FCBFF] font-bold text-xs tracking-wider uppercase rounded-full px-4 py-1.5 w-max bg-[#101C31]/90 backdrop-blur-md">Automação Completa</div>
                                <div className="text-white font-bold text-3xl md:text-4xl drop-shadow-md">Controle absoluto da <br/>sua operação.</div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* TRUST BAR */}
            <div className="py-8 border-y border-[#24344F] bg-[#0c1627]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <p className="text-[#4F6A8F] text-sm font-bold uppercase tracking-widest mb-6">A confiança de quem entende de negócio</p>
                    <div className="flex flex-wrap justify-center items-center gap-12 lg:gap-24 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
                        {/* Fake logos using text/icons since we don't have images */}
                        <div className="flex items-center gap-2 font-black text-2xl text-white"><ShoppingCart className="w-8 h-8"/> SuperMais</div>
                        <div className="flex items-center gap-2 font-black text-2xl text-white"><Truck className="w-8 h-8"/> DistriTech</div>
                        <div className="flex items-center gap-2 font-black text-2xl text-white"><Briefcase className="w-8 h-8"/> Atacadão Forte</div>
                        <div className="flex items-center gap-2 font-black text-2xl text-white"><MapPin className="w-8 h-8"/> Lojas Local</div>
                    </div>
                </div>
            </div>

            {/* THE "1001 REASONS" / COMPLETE ERP FEATURES */}
            <section id="erp-features" className="py-24 bg-[#101C31] relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-4xl mx-auto mb-20">
                        <h2 className="text-red-500 font-bold tracking-[2px] text-xs uppercase mb-4 animate-pulse">Chega de Travar no Horário de Pico</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
                            Sistema Lento = <br/>
                            <span className="bg-linear-to-r from-red-500 to-[#FF6A5C] bg-clip-text text-transparent">Cliente na Concorrência.</span>
                        </h3>
                        <p className="text-xl text-[#8FA3C0]">
                            Nós entendemos a dor de ver fila crescendo, operador travado e cliente desistindo da compra. O MercadinhoSys foi desenhado para o varejo real: resposta rápida, operação fluida e menos atrito no balcão.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {/* HIGH CONVERSION AI CARD */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="bg-linear-to-b from-[#0A1220] to-[#101C31] p-8 rounded-[20px] border-2 border-emerald-500/50 hover:border-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.2)] transition-all group relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all"></div>
                            
                            <div className="absolute top-4 right-4 bg-linear-to-r from-emerald-500 to-teal-400 text-white text-[10px] font-black uppercase tracking-widest py-1 px-3 rounded-full shadow-lg shadow-emerald-500/30 animate-pulse">
                                Exclusividade
                            </div>
                            
                            <div className="w-14 h-14 bg-[#101C31] border border-emerald-500/30 rounded-2xl flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform">
                                <MessageCircle className="w-7 h-7 text-emerald-400" />
                            </div>
                            
                            <h4 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                                Diretor M-IA 360°
                            </h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4 text-sm">
                                O fim dos prejuízos invisíveis. Nossa Inteligência Artificial audita suas <strong>margens de lucro, estoque e folha de pagamento 24h por dia</strong>. Receba alertas precisos de vazamento de caixa antes do mês fechar. 
                                <br/><br/>
                                <span className="text-emerald-400 font-bold">Gerencie com a frieza dos dados, não com a intuição.</span>
                            </p>
                        </motion.div>

                        {/* Feature 1 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#2E9BFF] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#2E9BFF]/10 group-hover:border-[#2E9BFF]/30 transition-all">
                                <Briefcase className="w-7 h-7 text-[#2E9BFF]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Força de Vendas (SFA)</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Ideal para atacadistas. Seus representantes fazem pedidos na rua, de forma offline. O pedido sincroniza, separa no estoque e a nota é gerada automaticamente.</p>
                        </motion.div>

                        {/* Feature 2 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#FF6A5C] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#FF6A5C]/10 group-hover:border-[#FF6A5C]/30 transition-all">
                                <Users className="w-7 h-7 text-[#FF6A5C]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">RH Real & Departamento Pessoal</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Gestão completa de funcionários. Emissão de holerites detalhados, controle de descontos, benefícios e faltas. Diga adeus às planilhas de pagamento.</p>
                        </motion.div>

                        {/* Feature 3 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-emerald-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30 transition-all">
                                <MapPin className="w-7 h-7 text-emerald-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Controle de Ponto Inteligente</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Seus colaboradores batem ponto pelo sistema, que exige uma <strong>foto (selfie)</strong> e captura a <strong>geolocalização (GPS)</strong> exata para evitar fraudes.</p>
                        </motion.div>

                        {/* Feature 4 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-amber-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-amber-500/10 group-hover:border-amber-500/30 transition-all">
                                <ShieldCheck className="w-7 h-7 text-amber-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Auditoria e Segurança Militar</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Controle de acesso granular: defina o que cada perfil pode ver. Além disso, temos um log de auditoria rastreando tudo que acontece no sistema.</p>
                        </motion.div>

                        {/* Feature 5 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#2E9BFF] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#2E9BFF]/10 group-hover:border-[#2E9BFF]/30 transition-all">
                                <FileText className="w-7 h-7 text-[#2E9BFF]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Fiscal NFe/NFCe Automático</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Homologado na SEFAZ. Importação de XML nativa para entrada de notas, preenchendo o estoque automaticamente. Emissão de NFCe em 8 segundos no balcão.</p>
                        </motion.div>

                        {/* Feature 6 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-purple-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-purple-500/10 group-hover:border-purple-500/30 transition-all">
                                <Activity className="w-7 h-7 text-purple-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Gestão de Despesas e DRE</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Controle completo de contas a pagar, contas a receber (fiado/crediário), fluxo de caixa real e DRE gerencial para você saber exatamente o seu lucro líquido.</p>
                        </motion.div>
                        {/* Feature 7 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.6 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-pink-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-pink-500/10 group-hover:border-pink-500/30 transition-all">
                                <Truck className="w-7 h-7 text-pink-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Delivery e Logística Integrada</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Gestão completa de entregas, roteirização e controle de motoboys. Seus clientes pedem, o sistema separa no estoque e o entregador já sabe a rota.</p>
                        </motion.div>

                        {/* Feature 7 - Replaced with 8 to fit grid since we added Consultor IA at the top */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.7 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-cyan-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-cyan-500/10 group-hover:border-cyan-500/30 transition-all">
                                <Star className="w-7 h-7 text-cyan-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Design Premium e UX Intuitiva</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Diga adeus àqueles sistemas feios, cinzas e confusos dos anos 90. Nossa interface é belíssima, fluida e feita para qualquer um aprender a usar em menos de 10 minutos.</p>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* SCREENSHOTS / SYSTEM PREVIEW SECTION */}
            <section className="py-24 bg-[#0c1627] border-y border-[#24344F] relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-4xl mx-auto mb-20">
                        <h2 className="text-red-500 font-bold tracking-[2px] text-xs uppercase mb-4">Por dentro da Máquina</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
                            Não vendemos promessas. <br/>
                            Entregamos <span className="bg-linear-to-r from-red-500 to-[#FF6A5C] bg-clip-text text-transparent">Poder de Controle.</span>
                        </h3>
                        <p className="text-xl text-[#8FA3C0]">
                            Dê uma olhada no motor do MercadinhoSys. Um painel de comando desenvolvido para quem precisa de dados rápidos, precisos e sem complicação. O seu negócio na palma da sua mão.
                        </p>
                    </div>

                    <div className="space-y-32">
                        {/* Dashboard Screenshot */}
                        <div className="flex flex-col lg:flex-row items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <Activity className="w-4 h-4" /> Visão 360 Graus
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">Dashboard Financeiro em Tempo Real</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    Acabe com a cegueira financeira. Acompanhe seu faturamento, despesas e DRE (Demonstração do Resultado do Exercício) ao vivo. Saiba exatamente qual é o seu lucro líquido diário. Sem surpresas no fim do mês.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> Fluxo de Caixa Diário</li>
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> Gráficos de Receitas vs Despesas</li>
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> Alertas automáticos do Gestor M-IA</li>
                                </ul>
                            </div>
                            <div className="lg:w-1/2 relative group w-full">
                                <div className="absolute inset-0 bg-red-500/10 blur-[80px] rounded-full group-hover:bg-red-500/20 transition-all duration-700"></div>
                                <div className="relative rounded-2xl border border-[#24344F] overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] group-hover:border-red-500/50 transition-colors">
                                    <div className="h-8 bg-[#101C31] border-b border-[#24344F] flex items-center px-4 gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                                    </div>
                                    <img src="/screenshots/dashboard.png" alt="Dashboard do Sistema" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>

                        {/* PDV Screenshot */}
                        <div className="flex flex-col lg:flex-row-reverse items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <ShoppingCart className="w-4 h-4" /> Frente de Caixa Imparável
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">PDV Offline-First de Alta Velocidade</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    A internet caiu? A sua loja não para. Nosso PDV continua operando, vendendo e emitindo cupons normalmente. Assim que a rede voltar, o sistema sincroniza tudo com a nuvem em segundos. Venda mais, sem filas e sem stress.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Emissão de NFCe em 8 Segundos</li>
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Sincronização em Nuvem (Offline-First)</li>
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Integração com Balança e Leitor de Código</li>
                                </ul>
                            </div>
                            <div className="lg:w-1/2 relative group w-full">
                                <div className="absolute inset-0 bg-emerald-500/10 blur-[80px] rounded-full group-hover:bg-emerald-500/20 transition-all duration-700"></div>
                                <div className="relative rounded-2xl border border-[#24344F] overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] group-hover:border-emerald-500/50 transition-colors">
                                    <div className="h-8 bg-[#101C31] border-b border-[#24344F] flex items-center px-4 gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                                    </div>
                                    <img src="/screenshots/pdv.png" alt="PDV Offline" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>

                        {/* Produtos Screenshot */}
                        <div className="flex flex-col lg:flex-row items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <Package className="w-4 h-4" /> Gestão Total
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">Estoque Milimetricamente Rastreado</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    Gerencie milhares de produtos sem perder um único item. Acompanhe movimentações, custos e saiba exatamente quando repor o estoque antes que acabe. Receba alertas de produtos parados e sem giro de vendas.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Tabela de Preço Custo vs Margem</li>
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Alertas de Ruptura de Estoque</li>
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Importação Automática via XML (NFe)</li>
                                </ul>
                            </div>
                            <div className="lg:w-1/2 relative group w-full">
                                <div className="absolute inset-0 bg-blue-500/10 blur-[80px] rounded-full group-hover:bg-blue-500/20 transition-all duration-700"></div>
                                <div className="relative rounded-2xl border border-[#24344F] overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] group-hover:border-blue-500/50 transition-colors">
                                    <div className="h-8 bg-[#101C31] border-b border-[#24344F] flex items-center px-4 gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                                    </div>
                                    <img src="/screenshots/products.png" alt="Gestão de Estoque" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="how-it-works" className="py-24 bg-[#0A1220] border-y border-[#24344F]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-20">
                        <h2 className="text-red-500 font-bold tracking-[1.5px] text-xs uppercase mb-4">O Relógio está correndo</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">Implantação Expressa. Comece em Minutos.</h3>
                        <p className="text-xl text-[#8FA3C0]">Sistemas engessados demoram meses e te cobram taxas absurdas de implantação. Nossa nuvem permite que você corte a sangria e comece a lucrar hoje mesmo.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 relative">
                        {/* Connecting Line */}
                        <div className="hidden md:block absolute top-1/2 left-[10%] right-[10%] h-0.5 bg-linear-to-r from-red-600/20 via-red-500 to-red-600/20 -translate-y-1/2 z-0"></div>

                        <div className="relative z-10 bg-[#101C31] p-10 rounded-[20px] border border-[#24344F] text-center shadow-xl">
                            <div className="w-16 h-16 bg-[#2E9BFF] text-white rounded-full flex items-center justify-center text-2xl font-black mx-auto mb-6 shadow-[0_0_20px_rgba(46,155,255,0.4)]">1</div>
                            <h4 className="text-xl font-bold text-white mb-4">Cadastro Rápido</h4>
                            <p className="text-[#8FA3C0]">Crie sua conta e configure os dados básicos da sua empresa e certificado digital (A1) em minutos, sem burocracia.</p>
                        </div>

                        <div className="relative z-10 bg-[#101C31] p-10 rounded-[20px] border border-[#24344F] text-center shadow-xl">
                            <div className="w-16 h-16 bg-[#2E9BFF] text-white rounded-full flex items-center justify-center text-2xl font-black mx-auto mb-6 shadow-[0_0_20px_rgba(46,155,255,0.4)]">2</div>
                            <h4 className="text-xl font-bold text-white mb-4">Importação Massiva</h4>
                            <p className="text-[#8FA3C0]">Suba seus produtos, clientes e fornecedores via planilha ou XML. O sistema estrutura sua base instantaneamente.</p>
                        </div>

                        <div className="relative z-10 bg-[#101C31] p-10 rounded-[20px] border border-[#24344F] text-center shadow-xl">
                            <div className="w-16 h-16 bg-[#2E9BFF] text-white rounded-full flex items-center justify-center text-2xl font-black mx-auto mb-6 shadow-[0_0_20px_rgba(46,155,255,0.4)]">3</div>
                            <h4 className="text-xl font-bold text-white mb-4">Venda e Lucre</h4>
                            <p className="text-[#8FA3C0]">Libere os acessos para o caixa, vendedores externos e RH. Acompanhe tudo em tempo real no seu Dashboard de bolso.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* TESTIMONIALS SECTION */}
            <section id="testimonials" className="py-24 bg-[#101C31] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-[#2E9BFF]/5 via-[#101C31] to-[#101C31] pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-3xl mx-auto mb-20">
                        <h2 className="text-[#8FA3C0] font-bold tracking-[1.5px] text-xs uppercase mb-4">Prova Social</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">Quem usa, não troca.</h3>
                        <p className="text-xl text-[#8FA3C0]">Nossa taxa de retenção é de 99.8%. Veja o que donos de negócios como o seu estão dizendo sobre a nossa tecnologia.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {testimonials.map((test, i) => (
                            <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="bg-[#0A1220] p-8 rounded-[24px] border border-[#24344F] relative shadow-lg">
                                <div className="flex gap-1 mb-6">
                                    {[...Array(5)].map((_, idx) => (
                                        <Star key={idx} className="w-5 h-5 fill-yellow-500 text-yellow-500" />
                                    ))}
                                </div>
                                <p className="text-white italic leading-relaxed mb-8 text-lg">"{test.text}"</p>
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-full ${test.color} flex items-center justify-center text-white font-bold text-xl`}>
                                        {test.initial}
                                    </div>
                                    <div>
                                        <h5 className="font-bold text-white text-lg">{test.name}</h5>
                                        <p className="text-[#8FA3C0] text-sm">{test.role}</p>
                                        <span className="inline-block mt-1 px-2 py-0.5 bg-[#101C31] border border-[#24344F] rounded text-xs text-[#6FCBFF]">{test.type}</span>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* COMPARISON SECTION */}
            <section className="py-24 bg-[#101C31] border-y border-[#24344F] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-red-500/5 via-[#101C31] to-[#101C31] pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-4xl mx-auto mb-16">
                        <h2 className="text-red-500 font-bold tracking-[2px] text-xs uppercase mb-4">A Verdade Inconveniente do Mercado</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">ERPs tradicionais <span className="text-[#8FA3C0] font-normal text-3xl mx-4">vs</span> MercadinhoSys</h3>
                        <p className="text-xl text-[#8FA3C0]">Compare o que realmente pesa na decisão: implantação, facilidade de uso, velocidade operacional e custo para crescer sem depender de projeto caro.</p>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar pb-8 px-4">
                        <div className="min-w-[800px] border border-[#24344F] rounded-[24px] bg-[#0A1220] shadow-2xl overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="p-6 border-b border-[#24344F] text-[#8FA3C0] font-bold text-lg w-1/3">Critério Corporativo</th>
                                        <th className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-[#8FA3C0] font-bold text-lg bg-[#101C31]/50 w-1/3 text-center">Gigantes Tradicionais <br/><span className="text-xs font-normal opacity-70">(Sankhya, SAP, TOTVS)</span></th>
                                        <th className="p-6 border-b-2 border-red-500 text-white font-black text-xl bg-linear-to-t from-red-500/10 to-transparent text-center w-1/3">MercadinhoSys</th>
                                    </tr>
                                </thead>
                                <tbody className="text-[#DCE8F7]">
                                    <tr className="hover:bg-[#101C31]/30 transition-colors">
                                        <td className="p-6 border-b border-[#24344F] font-bold text-lg">Custo de Implantação</td>
                                        <td className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-amber-500 font-bold bg-[#101C31]/50 text-center">R$ 50.000 a R$ 200.000+</td>
                                        <td className="p-6 border-b border-[#24344F] text-emerald-400 font-black text-xl bg-red-500/5 text-center">R$ 0 (Setup Automático)</td>
                                    </tr>
                                    <tr className="hover:bg-[#101C31]/30 transition-colors">
                                        <td className="p-6 border-b border-[#24344F] font-bold text-lg">Tempo de Treinamento</td>
                                        <td className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-amber-500 font-bold bg-[#101C31]/50 text-center">3 a 8 Meses</td>
                                        <td className="p-6 border-b border-[#24344F] text-emerald-400 font-bold bg-red-500/5 text-center text-xl">Minutos (UX Premium)</td>
                                    </tr>
                                    <tr className="hover:bg-[#101C31]/30 transition-colors">
                                        <td className="p-6 border-b border-[#24344F] font-bold text-lg">Gestão Financeira e Auditoria</td>
                                        <td className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-amber-500 bg-[#101C31]/50 text-center">Relatórios complexos que demandam analistas</td>
                                        <td className="p-6 border-b border-[#24344F] text-emerald-400 font-bold bg-red-500/5 text-center text-xl flex flex-col items-center gap-2">
                                            Diretor M-IA Integrado
                                            <span className="text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full w-max mx-auto">Alertas de vazamento 24h</span>
                                        </td>
                                    </tr>
                                    <tr className="hover:bg-[#101C31]/30 transition-colors">
                                        <td className="p-6 border-b border-[#24344F] font-bold text-lg">Estabilidade em Operação de Caixa</td>
                                        <td className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-red-500 font-bold bg-[#101C31]/50 text-center">Dependência de servidores ou redes perfeitas</td>
                                        <td className="p-6 border-b border-[#24344F] text-emerald-400 font-black text-xl bg-red-500/5 text-center">PDV 100% Offline-First</td>
                                    </tr>
                                    <tr className="hover:bg-[#101C31]/30 transition-colors">
                                        <td className="p-6 font-bold text-lg">Contrato e Fidelidade</td>
                                        <td className="p-6 border-r border-[#24344F] text-red-500 font-bold bg-[#101C31]/50 text-center">1 a 3 anos de amarrações e multas</td>
                                        <td className="p-6 text-emerald-400 font-black text-xl bg-red-500/5 text-center">SaaS Livre (Cancele Quando Quiser)</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </section>

            {/* PRICING SECTION */}
            <section id="pricing" className="py-24 bg-[#0A1220] border-t border-[#24344F]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <h2 className="text-red-500 font-bold tracking-[1.5px] text-xs uppercase mb-4">Decisão de Sobrevivência</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">Comece simples. Evolua com controle.</h3>
                        <p className="text-xl text-[#8FA3C0]">Escolha entre testar a operação essencial sem investimento inicial ou liberar a gestão profissional completa. Sem taxas escondidas. Cancele quando quiser.</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                        {tiers.map((tier, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                className={`bg-[#101C31] rounded-[24px] p-10 border ${tier.highlight ? 'border-[#2E9BFF] shadow-[0_0_40px_rgba(46,155,255,0.15)] relative transform md:-translate-y-4' : 'border-[#24344F]'}`}
                            >
                                {tier.highlight && (
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-linear-to-r from-[#2E9BFF] to-[#1D4ED8] text-white px-6 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-lg">
                                        RECOMENDADO PARA ESCALAR
                                    </div>
                                )}
                                <h4 className="text-3xl font-bold text-white mb-3">{tier.name}</h4>
                                <p className="text-[#8FA3C0] h-14">{tier.description}</p>
                                
                                <div className="my-8 pb-8 border-b border-[#24344F]">
                                    <span className="text-5xl font-black text-white">{tier.price}</span>
                                    <span className="text-[#8FA3C0] ml-2">{tier.period}</span>
                                </div>

                                <ul className="space-y-4 mb-10 min-h-[320px]">
                                    {tier.features.map((feature, idx) => (
                                        <li key={idx} className="flex items-start gap-4">
                                            <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${tier.highlight ? 'bg-[#2E9BFF]/20 text-[#2E9BFF]' : 'bg-gray-800 text-gray-400'}`}>
                                                <Check className="w-4 h-4" />
                                            </div>
                                            <span className="text-[#DCE8F7] font-medium">{feature}</span>
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => handlePlanSelect(tier)}
                                    className={`w-full py-5 rounded-[12px] font-bold text-lg transition-all ${
                                        tier.highlight 
                                        ? 'bg-linear-to-r from-[#2E9BFF] to-[#1D4ED8] text-white hover:shadow-[0_0_20px_rgba(46,155,255,0.4)] hover:scale-[1.02]'
                                        : 'bg-transparent border border-[#2E9BFF] text-[#2E9BFF] hover:bg-[#2E9BFF]/10'
                                    }`}>
                                    {tier.cta}
                                </button>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ SECTION */}
            <section className="py-24 bg-[#101C31] border-y border-[#24344F]">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-[#8FA3C0] font-bold tracking-[1.5px] text-xs uppercase mb-4">Tira Dúvidas</h2>
                        <h3 className="text-4xl font-bold text-white">Perguntas Frequentes</h3>
                    </div>

                    <div className="space-y-4">
                        {faqs.map((faq, index) => (
                            <div key={index} className="bg-[#0A1220] border border-[#24344F] rounded-2xl overflow-hidden transition-all">
                                <button 
                                    className="w-full px-6 py-5 text-left flex justify-between items-center focus:outline-none"
                                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                                >
                                    <span className="font-bold text-white text-lg">{faq.q}</span>
                                    {openFaq === index ? <ChevronUp className="w-6 h-6 text-[#2E9BFF] shrink-0" /> : <ChevronDown className="w-6 h-6 text-[#8FA3C0] shrink-0" />}
                                </button>
                                <AnimatePresence>
                                    {openFaq === index && (
                                        <motion.div 
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="px-6 pb-5 text-[#8FA3C0] leading-relaxed"
                                        >
                                            <div dangerouslySetInnerHTML={{ __html: faq.a }} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CONTACT SECTION */}
            <section id="contact" className="py-24 bg-[#0A1220]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-linear-to-br from-[#101C31] to-[#0A1220] rounded-[32px] border border-[#24344F] overflow-hidden shadow-2xl relative">
                        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-[#2E9BFF] via-[#FF6A5C] to-[#2E9BFF]"></div>
                        <div className="grid lg:grid-cols-2">
                            <div className="p-10 lg:p-16 border-b lg:border-b-0 lg:border-r border-[#24344F] flex flex-col justify-center">
                                <h3 className="text-4xl font-bold text-white mb-6">Pronto para transformar sua gestão?</h3>
                                <p className="text-[#8FA3C0] text-lg mb-10 leading-relaxed">
                                    Nossa equipe de especialistas está pronta para entender o seu negócio e realizar a implantação completa. Fale conosco hoje mesmo.
                                </p>
                                <div className="space-y-8">
                                    <div className="flex items-center gap-5 group">
                                        <div className="w-14 h-14 bg-[#101C31] border border-[#24344F] rounded-2xl flex items-center justify-center group-hover:border-[#2E9BFF] transition-all">
                                            <Phone className="w-6 h-6 text-[#2E9BFF]" />
                                        </div>
                                        <div>
                                            <p className="text-[#8FA3C0] text-xs font-bold uppercase tracking-widest mb-1">Central de Vendas</p>
                                            <p className="text-2xl font-black text-white">(11) 91988-9233</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-5 group">
                                        <div className="w-14 h-14 bg-[#101C31] border border-[#24344F] rounded-2xl flex items-center justify-center group-hover:border-[#FF6A5C] transition-all">
                                            <Mail className="w-6 h-6 text-[#FF6A5C]" />
                                        </div>
                                        <div>
                                            <p className="text-[#8FA3C0] text-xs font-bold uppercase tracking-widest mb-1">E-mail Comercial</p>
                                            <p className="text-xl font-bold text-white">vendas@mercadinhosys.com.br</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="p-10 lg:p-16 bg-[#101C31]/50 backdrop-blur-sm">
                                <form onSubmit={handleLeadSubmit} className="space-y-6">
                                    <div>
                                        <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">Nome Completo</label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                            <input required type="text" placeholder="Seu nome" value={leadName} onChange={(e) => setLeadName(e.target.value)}
                                                className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] transition-all placeholder-[#4F6A8F]"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">E-mail Corporativo</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                            <input required type="email" placeholder="exemplo@suaempresa.com.br" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)}
                                                className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] transition-all placeholder-[#4F6A8F]"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">WhatsApp</label>
                                        <div className="relative">
                                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                            <input required type="tel" placeholder="(11) 99999-9999" value={leadWhatsApp} onChange={(e) => setLeadWhatsApp(e.target.value)}
                                                className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] transition-all placeholder-[#4F6A8F]"
                                            />
                                        </div>
                                    </div>
                                    <button type="submit" disabled={loadingLead} className="w-full py-4 bg-[#2E9BFF] text-[#0A1220] rounded-[12px] font-black text-lg hover:bg-white transition-all flex items-center justify-center mt-4 shadow-[0_0_20px_rgba(46,155,255,0.3)]">
                                        {loadingLead ? <div className="w-6 h-6 border-2 border-[#0A1220] border-t-transparent rounded-full animate-spin"></div> : 'SOLICITAR DEMONSTRAÇÃO'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 bg-[#0A1220] border-t border-[#24344F]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                        <div className="flex items-center gap-3">
                            <img src="/assets/logo.png" alt="Logo Footer" className="w-10 h-10 rounded-md" />
                            <span className="text-2xl font-black text-white tracking-tighter">
                                Mercadinho<span className="text-[#FF6A5C]">Sys</span>
                            </span>
                        </div>
                        <div className="flex flex-wrap justify-center gap-8 text-sm font-bold text-[#8FA3C0]">
                            <a href="#erp-features" className="hover:text-[#2E9BFF]">Tecnologia</a>
                            <a href="#testimonials" className="hover:text-[#2E9BFF]">Clientes</a>
                            <a href="#pricing" className="hover:text-[#2E9BFF]">Planos</a>
                            <a href="/ajuda" className="hover:text-[#2E9BFF]">Ajuda / Base de Conhecimento</a>
                            <a href="/termos" className="hover:text-[#2E9BFF]">Termos de Uso</a>
                            <a href="/privacidade" className="hover:text-[#2E9BFF]">Privacidade</a>
                            <a href="/login" className="hover:text-white bg-[#101C31] px-3 py-1 rounded-full border border-[#24344F]">Acesso Cliente</a>
                        </div>
                    </div>
                    <div className="mt-8 pt-8 border-t border-[#24344F] text-center flex flex-col md:flex-row justify-between items-center gap-4 text-[#4F6A8F] text-sm">
                        <p>&copy; {new Date().getFullYear()} MercadinhoSys Tecnologia. Todos os direitos reservados.</p>
                        <p>O ERP construído para quem faz o varejo acontecer.</p>
                    </div>
                </div>
            </footer>
            
            {/* CONVERSION MODAL */}
            {conversionModalOpen && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-[#0A1220]/90 backdrop-blur-md overflow-y-auto">
                    <div className="bg-[#101C31] border border-[#2E9BFF]/30 w-full max-w-5xl rounded-[24px] shadow-[0_0_50px_rgba(46,155,255,0.15)] overflow-hidden relative flex flex-col md:flex-row">
                        <button onClick={() => setConversionModalOpen(false)} className="absolute top-4 right-4 z-10 text-[#8FA3C0] hover:text-white bg-[#0A1220] rounded-full p-2 border border-[#24344F]">
                            <X className="w-5 h-5" />
                        </button>

                        <div className="bg-linear-to-b from-[#0A1220] to-[#101C31] border-r border-[#24344F] w-full md:w-5/12 p-10 flex flex-col justify-between relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-[#2E9BFF]/5 rounded-full blur-[80px] pointer-events-none"></div>
                            <div className="relative z-10">
                                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 text-[#2E9BFF] rounded-full text-xs font-black uppercase mb-6">
                                    <Star className="w-4 h-4 fill-[#2E9BFF]" /> Escolha Profissional
                                </div>
                                <h3 className="text-4xl font-black text-white mb-2">{selectedPlan?.name}</h3>
                                <div className="flex items-baseline gap-1 mb-10">
                                    <span className="text-5xl font-black text-white">{selectedPlan?.price}</span>
                                    <span className="text-[#8FA3C0] font-medium text-lg">/mês</span>
                                </div>

                                <ul className="space-y-5 mb-8">
                                    <li className="flex items-start gap-4">
                                        <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5"><Check className="w-4 h-4"/></div>
                                        <p className="text-[#DCE8F7] text-sm leading-relaxed"><strong>Sem fidelidade.</strong> Cancele quando quiser, sem ressentimentos.</p>
                                    </li>
                                    <li className="flex items-start gap-4">
                                        <div className="w-6 h-6 rounded-full bg-[#2E9BFF]/20 text-[#2E9BFF] flex items-center justify-center shrink-0 mt-0.5"><Lock className="w-4 h-4"/></div>
                                        <p className="text-[#DCE8F7] text-sm leading-relaxed"><strong>Preço travado.</strong> O valor não sofrerá reajustes anuais surpresa.</p>
                                    </li>
                                    <li className="flex items-start gap-4">
                                        <div className="w-6 h-6 rounded-full bg-[#FF6A5C]/20 text-[#FF6A5C] flex items-center justify-center shrink-0 mt-0.5"><ShieldCheck className="w-4 h-4"/></div>
                                        <p className="text-[#DCE8F7] text-sm leading-relaxed"><strong>Garantia de 7 dias.</strong> Risco zero. Reembolso integral automático.</p>
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="w-full md:w-7/12 p-10 bg-[#101C31]">
                            <h3 className="text-3xl font-black text-white mb-2">Configure seu Acesso</h3>
                            <p className="text-[#8FA3C0] mb-8 text-lg">Crie sua conta para acessar o checkout seguro.</p>

                            <form onSubmit={handleCheckout} className="space-y-6">
                                <div>
                                    <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">E-mail de Acesso (Administrador)</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                        <input required type="email" placeholder="seu@email.com" value={onboardingEmail} onChange={(e) => setOnboardingEmail(e.target.value)}
                                            className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] placeholder-[#4F6A8F]"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">WhatsApp do Titular</label>
                                    <div className="relative">
                                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                        <input required type="tel" placeholder="(11) 99999-9999" value={onboardingWhatsApp} onChange={(e) => setOnboardingWhatsApp(e.target.value)}
                                            className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] placeholder-[#4F6A8F]"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">Nome da Empresa / Loja</label>
                                    <div className="relative">
                                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                        <input required type="text" placeholder="Ex: Supermercado Central" value={onboardingStoreName} onChange={(e) => setOnboardingStoreName(e.target.value)}
                                            className="w-full bg-[#0A1220] border border-[#24344F] rounded-[12px] py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#2E9BFF] placeholder-[#4F6A8F]"
                                        />
                                    </div>
                                </div>
                                <div className="mt-4 flex items-start gap-3 bg-[#0A1220]/50 p-4 rounded-xl border border-[#24344F]">
                                    <input 
                                        type="checkbox" 
                                        id="terms" 
                                        checked={termsAccepted}
                                        onChange={(e) => setTermsAccepted(e.target.checked)}
                                        className="mt-1 w-5 h-5 bg-[#0A1220] border-[#4F6A8F] rounded text-[#2E9BFF] focus:ring-[#2E9BFF] focus:ring-offset-[#101C31] cursor-pointer"
                                    />
                                    <label htmlFor="terms" className="text-[#8FA3C0] text-sm leading-relaxed cursor-pointer">
                                        Li, compreendi e aceito os <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-[#2E9BFF] hover:underline font-bold">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-[#2E9BFF] hover:underline font-bold">Política de Privacidade</a>.
                                    </label>
                                </div>
                                <button type="submit" disabled={loadingCheckout || !termsAccepted} className={`w-full py-4 mt-8 text-white rounded-[12px] font-black text-lg transition-all flex items-center justify-center ${termsAccepted ? 'bg-linear-to-r from-[#2E9BFF] to-[#1D4ED8] hover:shadow-[0_0_25px_rgba(46,155,255,0.4)] hover:scale-[1.02]' : 'bg-[#24344F] text-[#8FA3C0] cursor-not-allowed'}`}>
                                    {loadingCheckout ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'IR PARA O PAGAMENTO SEGURO'}
                                </button>
                                <p className="text-center text-[#4F6A8F] text-xs font-medium mt-4 flex items-center justify-center gap-1">
                                    <Lock className="w-3 h-3" /> Transação 100% segura e criptografada
                                </p>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LandingPage;
