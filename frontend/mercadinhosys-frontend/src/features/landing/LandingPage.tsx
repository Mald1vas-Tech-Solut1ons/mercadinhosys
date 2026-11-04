import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../auth/authService';
import SegmentosGrid from './SegmentosGrid';
import { ChatMIA, FaleComDesenvolvedor, ImplantaComVoce, OfertaDoisMeses, PrimeiraCliente, TrabalhosDoSistema } from './BlocosVenda';
import { entrarNaDemo } from './entrarNaDemo';
import { linkWhatsApp, VENDAS, imagemOg, PRAZO_RESPOSTA } from './site';
import { BarraFixaCelular } from './SecoesVenda';
import { CalculadoraPerdas, DemoInterativa } from './SecoesVenda';
import MapaDoSite from './MapaDoSite';
import BannerCookies from './BannerCookies';
import { useSeo } from './useSeo';
import { idVisitante, rastrearEvento } from './telemetria';
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
    Briefcase,
    Users,
    FileText,
    Activity,
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
            onClick={onComplete}
            role="presentation"
            className="fixed inset-0 z-9999 flex flex-col items-center justify-center overflow-hidden cursor-pointer"
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
    const location = useLocation();
    useSeo(
        'MercadinhoSys: sistema de gestão com IA para todo tipo de comércio',
        'Sistema com IA para mercadinho, loja de roupas, moto peças, tabacaria e mais. Caixa, estoque, fiado e lucro real. 2 meses grátis com implantação.',
        '/',
        imagemOg('inicio'),
    );
    const [leadName, setLeadName] = useState('');
    const [leadEmail, setLeadEmail] = useState('');
    const [leadWhatsApp, setLeadWhatsApp] = useState('');
    const [loadingLead, setLoadingLead] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
        if (showSplash || !location.hash) return;
        const t = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 100);
        return () => clearTimeout(t);
    }, [showSplash, location.hash]);

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
                body: JSON.stringify({ nome: leadName, email: leadEmail, whatsapp: leadWhatsApp, origem: 'landing_page', visitante_id: idVisitante() }),
            });
            const result = await response.json();
            if (response.ok && result.success) {
                rastrearEvento('formulario_enviado', 'contato');
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

    const handleDemoAccess = entrarNaDemo;

    const faqs = [
        { q: "Como funcionam os 2 meses grátis?", a: "Você usa o sistema completo por 2 meses, sem cartão e sem pagar nada. Nesse tempo a gente implanta junto com você: importa seus produtos, configura a loja e acompanha até você andar sozinho. <strong>Só continua pagando se gostar e se fizer sentido para o seu negócio.</strong>" },
        { q: "E depois dos 2 meses, quanto custa?", a: "R$ 99,90 por mês no Plano Pro, com preço travado: menos de R$ 3,40 por dia. Sem taxa de implantação, sem fidelidade e sem multa para cancelar." },
        { q: "Serve para o meu tipo de comércio?", a: "Sim. O MercadinhoSys atende mercadinho, mercearia, supermercado, magazine e loja de variedades, armarinho, loja de roupas, calçados, celulares e eletrônicos, moto peças, tabacaria, suplementos, floricultura e jardinagem, material de construção, adega e conveniência e distribuidora. Cada tipo de produto tem cadastro próprio: grade de tamanho e cor, numeração, validade e lote, unidades por metro ou saco, peças por moto, voltagem e garantia, espécie da planta. E a mesma loja pode vender de tudo um pouco." },
        { q: "Por que o nome é MercadinhoSys se atende outros comércios?", a: "Porque é fácil como o caixa do mercadinho do bairro. Por trás do nome está um sistema completo: caixa, estoque, compras, fiado, financeiro, equipe, entregas e inteligência artificial." },
        { q: "Meus dados ficam seguros?", a: "Sim. Os dados de cada loja ficam separados, cada funcionário só vê o que você liberar e tudo o que acontece no sistema fica registrado. E você sabe quem fez o sistema: fala direto com o desenvolvedor." },
        { q: "Preciso de computador?", a: "Não é obrigatório. Funciona no celular, no tablet e no computador. A câmera do celular serve de leitor de código de barras." },
        { q: "E se a internet cair?", a: "O sistema funciona pela internet. Os cupons já emitidos ficam guardados no aparelho para reimprimir, e um chip de celular como reserva resolve a maioria das quedas." },
        { q: "Emite nota fiscal?", a: "A emissão de nota fiscal é um módulo à parte, com custo à parte. Consulte as condições no atendimento." },
        { q: "Consigo limitar o que meus funcionários acessam?", a: "Sim. Você define o que o caixa, o gerente e o repositor podem ver e fazer. Cancelar uma venda ou estornar pede o seu PIN, e tudo fica registrado." },
        { q: "O sistema atende distribuidores?", a: "Sim. O vendedor externo tira pedido no celular, o estoque é reservado e separado, e o cliente empresa (CNPJ) tem limite de crédito." }
    ];

    return (
        <div data-rolagem className="h-screen overflow-y-auto overflow-x-hidden bg-[#0A1220] font-['Space_Grotesk',sans-serif] text-[#DCE8F7] selection:bg-[#2E9BFF] selection:text-[#06101F] custom-scrollbar relative scroll-smooth">
            
            <AnimatePresence>
                {showSplash && <SplashIntro onComplete={() => setShowSplash(false)} />}
            </AnimatePresence>

            <a href="#oferta" className="block bg-[#FFD43B] text-[#0A1220] py-2 px-4 text-center text-xs sm:text-sm font-black tracking-wide z-60 relative shadow-md">
                <span className="sm:hidden">2 MESES GRÁTIS · SÓ PAGA SE GOSTAR</span>
                <span className="hidden sm:inline">2 MESES GRÁTIS: SÓ PAGA SE FIZER SENTIDO PARA O SEU NEGÓCIO</span>
            </a>

            {/* WhatsApp Floating Button */}
            <a
                href={linkWhatsApp('Olá! Vi o site do MercadinhoSys e quero saber mais.')}
                data-evento="whatsapp"
                data-rotulo="botao-flutuante"
                aria-label="Falar no WhatsApp"
                target="_blank"
                rel="noreferrer"
                className="hidden md:flex fixed bottom-8 right-8 z-100 bg-emerald-500 text-white p-4 rounded-full shadow-2xl shadow-emerald-400/30 hover:scale-110 active:scale-95 transition-all items-center justify-center group"
            >
                <MessageCircle className="w-8 h-8" />
                <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-500 font-bold whitespace-nowrap">
                    Fale com o desenvolvedor
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
                        <div className="hidden xl:flex items-center gap-7">
                            <a href="#segmentos" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Segmentos</a>
                            <a href="#ia" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">IA</a>
                            <a href="#how-it-works" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Implantação</a>
                            <a href="#oferta" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest whitespace-nowrap">2 meses grátis</a>
                            <a href="#contact" className="text-sm font-bold text-[#8FA3C0] hover:text-[#2E9BFF] transition-colors uppercase tracking-widest">Contato</a>
                            <button
                                onClick={() => navigate('/login')}
                                className="px-6 py-2.5 bg-transparent border border-[#2E9BFF] text-[#6FCBFF] rounded-xl font-bold text-sm hover:bg-[#2E9BFF]/10 transition-all shadow-[0_0_15px_rgba(46,155,255,0.15)]"
                            >
                                ACESSAR PAINEL
                            </button>
                        </div>
                        <div className="xl:hidden flex items-center gap-4">
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

                <div className={`xl:hidden overflow-hidden transition-all duration-300 bg-[#101C31] border-b border-[#24344F] ${mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="px-4 py-6 space-y-4">
                        <a href="#segmentos" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Segmentos</a>
                        <a href="#ia" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">IA que trabalha por você</a>
                        <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">Implantação</a>
                        <a href="#oferta" onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#DCE8F7]">2 meses grátis</a>
                    </div>
                </div>
            </nav>

            {/* HERO SECTION - THE DEFINITIVE ERP */}
            <section className="relative pt-32 sm:pt-40 pb-20 lg:pt-56 lg:pb-32 overflow-hidden">
                <div className="absolute top-0 right-0 -z-10 w-[900px] h-[900px] bg-[#1D4ED8]/20 rounded-full blur-[140px] translate-x-1/3 -translate-y-1/3"></div>
                <div className="absolute bottom-0 left-0 -z-10 w-[700px] h-[700px] bg-[#FF6A5C]/10 rounded-full blur-[120px] -translate-x-1/4 translate-y-1/4"></div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center">
                    <motion.div
                        initial={{ opacity: 0, y: -30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="text-center max-w-4xl flex flex-col items-center"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#2E9BFF]/10 backdrop-blur-sm border border-[#2E9BFF]/30 text-[#6FCBFF] rounded-full text-xs font-bold tracking-widest uppercase mb-4 sm:mb-6 shadow-[0_0_15px_rgba(46,155,255,0.2)]">
                            <Activity className="w-4 h-4" /> Gestão com IA para todo tipo de comércio
                        </div>
                        <h1 className="text-[42px] sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] lg:leading-[1.05] mb-5 sm:mb-8 text-white">
                            O sistema que <br className="hidden sm:block" />
                            <span className="text-[#FFD43B]">trabalha por você.</span>
                        </h1>
                        <p className="text-lg sm:text-xl lg:text-2xl text-[#8FA3C0] leading-relaxed mb-6 font-medium max-w-3xl">
                            Não é você que trabalha para o sistema. A IA do <span className="text-white font-bold">MercadinhoSys</span> cadastra produtos, acompanha a loja e diz o que fazer.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-3">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => { rastrearEvento('oferta_vista', 'topo'); document.getElementById('oferta')?.scrollIntoView({ behavior: 'smooth' }); }}
                                className="w-full sm:w-auto px-10 py-4 bg-[#2E9BFF] text-[#0A1220] rounded-[10px] font-bold text-xl hover:bg-[#6FCBFF] transition-all flex items-center justify-center shadow-[0_0_30px_rgba(46,155,255,0.4)] border border-[#2E9BFF]"
                            >
                                Quero 2 meses grátis
                            </motion.button>

                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleDemoAccess}
                                className="w-full sm:w-auto px-10 py-4 bg-[#101C31] text-[#DCE8F7] border border-[#24344F] rounded-[10px] font-bold text-xl hover:bg-[#1A2C4D] transition-all text-center flex items-center justify-center gap-3"
                            >
                                Ver funcionando
                            </motion.button>
                        </div>
                        <p className="text-sm text-[#8FA3C0] mb-10">Sem cartão, sem fidelidade. {PRAZO_RESPOSTA}</p>
                        <p className="text-lg text-[#8FA3C0] mb-10 max-w-3xl">
                            Caixa, estoque, fiado, financeiro e equipe para <strong className="text-white">mercadinho, magazine, loja de roupas, celulares, moto peças, floricultura</strong> e muito mais. Sistema 100% brasileiro, com o desenvolvedor do seu lado.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-3 mb-16">
                            {[
                                'Bipou, cadastrou',
                                'Avisa o que repor',
                                'Fiado sem caderno',
                                'Lucro de verdade na tela'
                            ].map((item) => (
                                <div key={item} className="px-4 py-2 rounded-full border border-[#24344F] bg-[#101C31]/80 text-sm font-medium text-[#DCE8F7]">
                                    {item}
                                </div>
                            ))}
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
                                <div className="border border-[#2E9BFF]/50 text-[#6FCBFF] font-bold text-xs tracking-wider uppercase rounded-full px-4 py-1.5 w-max bg-[#101C31]/90 backdrop-blur-md">MercadinhoSys</div>
                                <div className="text-white font-bold text-2xl md:text-4xl drop-shadow-md">Você atende. <br/>O sistema cuida do resto.</div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* SEGMENTOS: o lojista toca no tipo de comércio dele */}
            <section id="segmentos" className="py-16 sm:py-20 border-y border-[#24344F] bg-[#0c1627] scroll-mt-32">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-10">
                        <h2 className="text-[#6FCBFF] font-bold tracking-[2px] text-xs uppercase mb-4">Feito para o seu tipo de comércio</h2>
                        <h3 className="text-3xl lg:text-5xl font-bold text-white leading-tight mb-4">Qual é o seu negócio?</h3>
                        <p className="text-lg text-[#8FA3C0]">Toque no seu segmento e veja como o MercadinhoSys funciona na sua loja.</p>
                    </div>
                    <SegmentosGrid />
                </div>
            </section>

            {/* IA QUE AGE: a conversa do panfleto */}
            <section id="ia" className="py-20 sm:py-24 bg-[#0A1220] scroll-mt-32">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center">
                    <div>
                        <h2 className="text-[#FFD43B] font-bold tracking-[2px] text-xs uppercase mb-4">Consultor M-IA</h2>
                        <h3 className="text-3xl lg:text-5xl font-bold text-white leading-tight mb-6">Você pede. <br />A IA faz.</h3>
                        <p className="text-lg text-[#8FA3C0] mb-8">
                            Pergunte sobre vendas, estoque, contas ou equipe e receba a resposta com os números da sua loja.
                            Peça para cadastrar um produto, gerar o pedido de compra ou criar um lembrete, e ela faz, com a sua confirmação.
                        </p>
                        <TrabalhosDoSistema />
                    </div>
                    <ChatMIA />
                </div>
            </section>

            {/* DEMONSTRAÇÃO: o lojista toca e vê funcionando */}
            <section id="demo" className="py-20 sm:py-24 bg-[#101C31] border-y border-[#24344F] scroll-mt-32">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-12">
                        <h2 className="text-[#FFD43B] font-bold tracking-[2px] text-xs uppercase mb-4">Demonstração</h2>
                        <h3 className="text-3xl lg:text-5xl font-bold text-white leading-tight mb-4">Toque e veja funcionando</h3>
                        <p className="text-lg text-[#8FA3C0]">Caixa, estoque, IA e fiado. Ou entre na loja de demonstração e use o sistema de verdade.</p>
                    </div>
                    <DemoInterativa venda={VENDAS.mercadinho} origem="site" />
                </div>
            </section>

            {/* QUANTO VOCÊ PERDE: o custo de não ter controle */}
            <section className="py-20 sm:py-24 bg-[#0A1220]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-12">
                        <h2 className="text-red-400 font-bold tracking-[2px] text-xs uppercase mb-4">Faça a conta</h2>
                        <h3 className="text-3xl lg:text-5xl font-bold text-white leading-tight">Quanto a sua loja perde por mês sem controle?</h3>
                    </div>
                    <CalculadoraPerdas />
                </div>
            </section>

            {/* THE "1001 REASONS" / COMPLETE ERP FEATURES */}
            <section id="erp-features" className="py-24 bg-[#101C31] relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-4xl mx-auto mb-20">
                        <h2 className="text-[#6FCBFF] font-bold tracking-[2px] text-xs uppercase mb-4">Chega de caderno, planilha e app separado</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
                            Você atende. <br/>
                            <span className="bg-linear-to-r from-[#2E9BFF] to-[#6FCBFF] bg-clip-text text-transparent">O sistema cuida do resto.</span>
                        </h3>
                        <p className="text-xl text-[#8FA3C0]">
                            Caixa, estoque, compras, fiado, financeiro, equipe e entregas no mesmo lugar, no celular ou no computador.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {/* HIGH CONVERSION AI CARD */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="bg-linear-to-b from-[#0A1220] to-[#101C31] p-8 rounded-[20px] border-2 border-emerald-500/50 hover:border-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.2)] transition-all group relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all"></div>
                            
                            <div className="absolute top-4 right-4 bg-linear-to-r from-emerald-500 to-teal-400 text-white text-[10px] font-black uppercase tracking-widest py-1 px-3 rounded-full shadow-lg shadow-emerald-500/30 animate-pulse">
                                Exclusivo
                            </div>
                            
                            <div className="w-14 h-14 bg-[#101C31] border border-emerald-500/30 rounded-2xl flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform">
                                <MessageCircle className="w-7 h-7 text-emerald-400" />
                            </div>
                            
                            <h4 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                                Consultor M-IA
                            </h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4 text-sm">
                                Pergunte e receba a resposta com os números reais da sua loja: vendas, estoque, contas e equipe. Ele também <strong>cadastra produto, gera pedido de compra e cria lembrete</strong>, e emite relatório em PDF e planilha.
                                <br/><br/>
                                <span className="text-emerald-400 font-bold">Decida com os números, não no achismo.</span>
                            </p>
                        </motion.div>

                        {/* Feature 1 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#2E9BFF] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#2E9BFF]/10 group-hover:border-[#2E9BFF]/30 transition-all">
                                <Briefcase className="w-7 h-7 text-[#2E9BFF]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Vendedor Externo</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Para distribuidoras e atacados: o vendedor tira o pedido no celular, na rua. O estoque é reservado, a separação sai em ordem e o cliente empresa tem limite de crédito.</p>
                        </motion.div>

                        {/* Feature 2 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#FF6A5C] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#FF6A5C]/10 group-hover:border-[#FF6A5C]/30 transition-all">
                                <Users className="w-7 h-7 text-[#FF6A5C]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Equipe e Holerite</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Funcionários, holerite, descontos, benefícios e faltas no sistema. Adeus às planilhas de pagamento.</p>
                        </motion.div>

                        {/* Feature 3 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-emerald-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-emerald-500/10 group-hover:border-emerald-500/30 transition-all">
                                <MapPin className="w-7 h-7 text-emerald-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Ponto pelo Celular</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Seus funcionários batem ponto pelo celular com <strong>foto</strong> e <strong>localização</strong> registradas. Banco de horas e atrasos aparecem sozinhos.</p>
                        </motion.div>

                        {/* Feature 4 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-amber-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-amber-500/10 group-hover:border-amber-500/30 transition-all">
                                <ShieldCheck className="w-7 h-7 text-amber-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Segurança e Controle</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Cada funcionário só vê o que você liberar. Cancelar ou estornar pede o seu PIN, e tudo fica registrado: quem fez, o quê e quando.</p>
                        </motion.div>

                        {/* Feature 5 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-[#2E9BFF] transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-[#2E9BFF]/10 group-hover:border-[#2E9BFF]/30 transition-all">
                                <FileText className="w-7 h-7 text-[#2E9BFF]" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Nota do Fornecedor sem Digitar</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">A nota do fornecedor entra pelo XML ou pelo QR code e o estoque se atualiza sozinho. Emissão de nota fiscal na venda é módulo à parte, com custo à parte.</p>
                        </motion.div>

                        {/* Feature 6 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-purple-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-purple-500/10 group-hover:border-purple-500/30 transition-all">
                                <Activity className="w-7 h-7 text-purple-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Lucro de Verdade</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Contas a pagar, boletos a vencer, fiado e crediário, fluxo de caixa e o resultado do mês. Você sabe o que sobrou, não só o que entrou.</p>
                        </motion.div>
                        {/* Feature 7 */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.6 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-pink-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-pink-500/10 group-hover:border-pink-500/30 transition-all">
                                <Truck className="w-7 h-7 text-pink-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Delivery e Logística Integrada</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Entregas, motoboys e o que falta entregar no mesmo sistema. O pedido sai do estoque e você acompanha cada entrega.</p>
                        </motion.div>

                        {/* Feature 7 - Replaced with 8 to fit grid since we added Consultor IA at the top */}
                        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.7 }} className="bg-[#0A1220] p-8 rounded-[20px] border border-[#24344F] hover:border-cyan-500 transition-all group">
                            <div className="w-14 h-14 bg-[#101C31] rounded-2xl flex items-center justify-center mb-6 border border-[#24344F] group-hover:bg-cyan-500/10 group-hover:border-cyan-500/30 transition-all">
                                <Star className="w-7 h-7 text-cyan-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-3">Fácil de Verdade</h4>
                            <p className="text-[#8FA3C0] leading-relaxed mb-4">Nada de sistema cinza e confuso. A nossa primeira cliente, leiga em sistema, aprendeu a usar em poucos minutos.</p>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* SCREENSHOTS / SYSTEM PREVIEW SECTION */}
            <section className="py-24 bg-[#0c1627] border-y border-[#24344F] relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-4xl mx-auto mb-20">
                        <h2 className="text-[#6FCBFF] font-bold tracking-[2px] text-xs uppercase mb-4">Por dentro do sistema</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
                            Sua loja inteira <br/>
                            <span className="bg-linear-to-r from-[#2E9BFF] to-[#6FCBFF] bg-clip-text text-transparent">na palma da mão.</span>
                        </h3>
                        <p className="text-xl text-[#8FA3C0]">
                            Veja as telas que você vai usar todo dia: o painel do dono, o caixa e o estoque.
                        </p>
                    </div>

                    <div className="space-y-32">
                        {/* Dashboard Screenshot */}
                        <div className="flex flex-col lg:flex-row items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <Activity className="w-4 h-4" /> Visão 360 Graus
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">O Painel do Dono</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    Faturamento, despesas e o resultado do mês na mesma tela. Saiba quanto sobrou de verdade, sem surpresa no fim do mês.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> Fluxo de Caixa Diário</li>
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> Gráficos de Receitas vs Despesas</li>
                                    <li className="flex items-center gap-3"><Check className="text-red-500 w-5 h-5"/> O que fazer hoje, pelo Consultor M-IA</li>
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
                                    <img src="/screenshots/dashboard.png" alt="Painel do dono do MercadinhoSys" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>

                        {/* PDV Screenshot */}
                        <div className="flex flex-col lg:flex-row-reverse items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <ShoppingCart className="w-4 h-4" /> Frente de Caixa
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">Caixa Rápido no Balcão</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    Bipa com o leitor ou com a câmera do celular, recebe em dinheiro, Pix, cartão ou fiado e fecha o caixa conferido. Cancelamento só com o PIN do dono.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Dinheiro, Pix, cartão e fiado</li>
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Abertura e fechamento de caixa conferido</li>
                                    <li className="flex items-center gap-3"><Check className="text-emerald-500 w-5 h-5"/> Leitor de código de barras ou câmera do celular</li>
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
                                    <img src="/screenshots/pdv.png" alt="Frente de caixa do MercadinhoSys" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>

                        {/* Produtos Screenshot */}
                        <div className="flex flex-col lg:flex-row items-center gap-12">
                            <div className="lg:w-1/2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-full text-xs font-bold uppercase mb-4">
                                    <Package className="w-4 h-4" /> Gestão Total
                                </div>
                                <h4 className="text-3xl font-bold text-white mb-4">Estoque que Avisa</h4>
                                <p className="text-[#8FA3C0] text-lg leading-relaxed mb-6">
                                    Saiba o que repor antes de faltar, o que está parado ocupando dinheiro e o que está perto de vencer. Etiquetas de preço com código de barras saem do próprio sistema.
                                </p>
                                <ul className="space-y-3 text-[#DCE8F7]">
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Custo, preço e margem de cada produto</li>
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Aviso do que repor e do que vence</li>
                                    <li className="flex items-center gap-3"><Check className="text-blue-500 w-5 h-5"/> Nota do fornecedor pelo XML ou QR code</li>
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
                                    <img src="/screenshots/products.png" alt="Controle de estoque do MercadinhoSys" className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="how-it-works" className="py-24 bg-[#0A1220] border-y border-[#24344F] scroll-mt-32">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <h2 className="text-[#6FCBFF] font-bold tracking-[1.5px] text-xs uppercase mb-4">Sem taxa de implantação</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">A gente implanta com você.</h3>
                        <p className="text-xl text-[#8FA3C0]">Você não fica sozinho com um sistema novo. Quem fez o MercadinhoSys vai até a sua loja, configura tudo e acompanha os 2 primeiros meses.</p>
                    </div>
                    <ImplantaComVoce />
                    <div className="mt-10"><FaleComDesenvolvedor /></div>
                </div>
            </section>

            {/* PRIMEIRA CLIENTE (real, autorizada) */}
            <section id="testimonials" className="py-24 bg-[#101C31] relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-3xl mx-auto mb-12">
                        <h2 className="text-[#8FA3C0] font-bold tracking-[1.5px] text-xs uppercase mb-4">Quem já usa</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white">Fácil até para quem nunca usou sistema.</h3>
                    </div>
                    <PrimeiraCliente />
                </div>
            </section>

            {/* COMPARISON SECTION */}
            <section className="py-24 bg-[#101C31] border-y border-[#24344F] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-red-500/5 via-[#101C31] to-[#101C31] pointer-events-none"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-4xl mx-auto mb-16">
                        <h2 className="text-[#6FCBFF] font-bold tracking-[2px] text-xs uppercase mb-4">Compare antes de decidir</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">O jeito de sempre <span className="text-[#8FA3C0] font-normal text-3xl mx-4">vs</span> MercadinhoSys</h3>
                        <p className="text-xl text-[#8FA3C0]">Caderno, planilha, app separado ou sistema tradicional: veja o que muda no seu dia a dia.</p>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar pb-8 px-4">
                        <div className="min-w-[800px] border border-[#24344F] rounded-[24px] bg-[#0A1220] shadow-2xl overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="p-6 border-b border-[#24344F] text-[#8FA3C0] font-bold text-lg w-1/3">No dia a dia</th>
                                        <th className="p-6 border-b border-[#24344F] border-r border-[#24344F] text-[#8FA3C0] font-bold text-lg bg-[#101C31]/50 w-1/3 text-center">Caderno, planilha <br/><span className="text-xs font-normal opacity-70">e sistemas tradicionais</span></th>
                                        <th className="p-6 border-b-2 border-red-500 text-white font-black text-xl bg-linear-to-t from-red-500/10 to-transparent text-center w-1/3">MercadinhoSys</th>
                                    </tr>
                                </thead>
                                <tbody className="text-[#DCE8F7]">
                                    {[
                                        ['Começar a usar', 'Contrato, taxa de implantação e você configura sozinho', '2 meses grátis, a gente implanta com você'],
                                        ['Cadastrar produto', 'Digitar tudo à mão', 'Bipou, cadastrou, ou peça para a IA'],
                                        ['Fiado', 'Caderno que some e cobrança constrangedora', 'Limite por cliente e cobrança pelo WhatsApp'],
                                        ['Saber o lucro', 'Só no fim do mês, se der', 'Na tela, com despesas e boletos'],
                                        ['Suporte', 'Central de atendimento e protocolo', 'Direto com o desenvolvedor'],
                                        ['Contrato', 'Fidelidade e multa', 'Sem fidelidade, cancele quando quiser'],
                                    ].map(([criterio, antes, agora], i, todas) => (
                                        <tr key={criterio} className="hover:bg-[#101C31]/30 transition-colors">
                                            <td className={`p-6 font-bold text-lg ${i < todas.length - 1 ? 'border-b border-[#24344F]' : ''}`}>{criterio}</td>
                                            <td className={`p-6 border-r border-[#24344F] text-amber-500 font-bold bg-[#101C31]/50 text-center ${i < todas.length - 1 ? 'border-b' : ''}`}>{antes}</td>
                                            <td className={`p-6 text-emerald-400 font-black text-lg bg-red-500/5 text-center ${i < todas.length - 1 ? 'border-b border-[#24344F]' : ''}`}>{agora}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </section>

            {/* OFERTA: 2 meses grátis, só paga se fizer sentido */}
            <section id="oferta" className="py-24 bg-[#0A1220] border-t border-[#24344F] scroll-mt-32">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center max-w-3xl mx-auto mb-12">
                        <h2 className="text-[#FFD43B] font-bold tracking-[1.5px] text-xs uppercase mb-4">Risco zero</h2>
                        <h3 className="text-4xl lg:text-5xl font-bold text-white mb-6">Use 2 meses. Depois você decide.</h3>
                        <p className="text-xl text-[#8FA3C0]">Tudo isso por menos de R$ 3,40 por dia, e só se valer a pena para você.</p>
                    </div>
                    <OfertaDoisMeses origem="site" onCadastro={() => navigate('/register')} />
                    <div className="max-w-4xl mx-auto mt-10 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-[#DCE8F7]">
                        {['Caixa no computador, tablet ou celular', 'Estoque, validade e o que repor', 'Compras e nota do fornecedor pelo XML', 'Fiado e crediário com cobrança no WhatsApp',
                          'Financeiro e lucro de verdade', 'Equipe, ponto e holerite', 'Entregas e vendedor externo', 'Consultor M-IA e relatórios em PDF e planilha',
                          'Mais de uma loja na mesma conta', 'Suporte direto com o desenvolvedor'].map(item => (
                            <p key={item} className="flex items-start gap-3"><Check className="w-5 h-5 text-[#2E9BFF] shrink-0 mt-0.5" /> {item}</p>
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
                                    onClick={() => { if (openFaq !== index) rastrearEvento('faq', faq.q); setOpenFaq(openFaq === index ? null : index); }}
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
                            <div className="min-w-0 p-6 sm:p-10 lg:p-16 border-b lg:border-b-0 lg:border-r border-[#24344F] flex flex-col justify-center">
                                <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6">Quer ver na sua loja?</h3>
                                <p className="text-[#8FA3C0] text-lg mb-10 leading-relaxed">
                                    Chame no WhatsApp ou deixe seu contato. Quem fez o sistema vai até você, mostra funcionando e implanta junto, em Guarulhos, Zona Norte e Zona Leste de São Paulo.
                                </p>
                                <div className="space-y-8">
                                    <div className="flex items-center gap-5 group">
                                        <div className="w-14 h-14 bg-[#101C31] border border-[#24344F] rounded-2xl flex items-center justify-center group-hover:border-[#2E9BFF] transition-all">
                                            <Phone className="w-6 h-6 text-[#2E9BFF]" />
                                        </div>
                                        <div>
                                            <p className="text-[#8FA3C0] text-xs font-bold uppercase tracking-widest mb-1">WhatsApp do desenvolvedor</p>
                                            <p className="text-2xl font-black text-white">(11) 91988-9233</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-5 group">
                                        <div className="w-14 h-14 bg-[#101C31] border border-[#24344F] rounded-2xl flex items-center justify-center group-hover:border-[#FF6A5C] transition-all">
                                            <Mail className="w-6 h-6 text-[#FF6A5C]" />
                                        </div>
                                        <div>
                                            <p className="text-[#8FA3C0] text-xs font-bold uppercase tracking-widest mb-1">E-mail Comercial</p>
                                            <p className="text-lg sm:text-xl font-bold text-white break-all">vendas@mercadinhosys.com.br</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="min-w-0 p-6 sm:p-10 lg:p-16 bg-[#101C31]/50 backdrop-blur-sm">
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
                                        <label className="block text-[#8FA3C0] text-sm font-bold mb-2 uppercase tracking-wide">E-mail</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4F6A8F]" />
                                            <input required type="email" placeholder="seu@email.com" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)}
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
                                        {loadingLead ? <div className="w-6 h-6 border-2 border-[#0A1220] border-t-transparent rounded-full animate-spin"></div> : 'QUERO 2 MESES GRÁTIS'}
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
                        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-bold text-[#8FA3C0]">
                            <a href="#segmentos" className="hover:text-[#2E9BFF]">Segmentos</a>
                            <a href="#oferta" className="hover:text-[#2E9BFF]">2 meses grátis</a>
                            <a href="/ajuda" className="hover:text-[#2E9BFF]">Ajuda</a>
                            <a href="/termos" className="hover:text-[#2E9BFF]">Termos de Uso</a>
                            <a href="/privacidade" className="hover:text-[#2E9BFF]">Privacidade</a>
                            <a href="/login" className="hover:text-white bg-[#101C31] px-3 py-1 rounded-full border border-[#24344F]">Acesso Cliente</a>
                        </div>
                    </div>
                </div>
                <div className="mt-12"><MapaDoSite /></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="mt-8 pt-8 border-t border-[#24344F] text-center flex flex-col md:flex-row justify-between items-center gap-4 text-[#4F6A8F] text-sm">
                        <p>&copy; {new Date().getFullYear()} MercadinhoSys Tecnologia. Todos os direitos reservados.</p>
                        <p>Sistema 100% brasileiro, feito para quem faz o comércio acontecer.</p>
                    </div>
                </div>
            </footer>
            <BannerCookies />
            <BarraFixaCelular origem="site" onCadastro={() => navigate('/register')} />
        </div>
    );
};

export default LandingPage;
