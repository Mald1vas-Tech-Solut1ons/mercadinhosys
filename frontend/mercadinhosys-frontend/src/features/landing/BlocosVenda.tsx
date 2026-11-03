import React from 'react';
import { Link } from 'react-router-dom';
import { Check, MessageCircle, ShieldCheck, Sparkles, ShoppingCart, ScanBarcode, UserCheck, Wrench, Store } from 'lucide-react';
import { linkWhatsApp, WHATSAPP_EXIBICAO, REGIOES_ATENDIDAS } from './site';

/*
 * Blocos de venda compartilhados entre a landing e as páginas de nicho.
 * A mensagem é a mesma do panfleto do porta a porta: o sistema trabalha por você,
 * a gente implanta junto, 2 meses grátis e só paga se fizer sentido.
 */

/** Conversa da M-IA igual à do panfleto: mostra a IA AGINDO, não só respondendo. */
export const ChatMIA: React.FC<{ exemplo?: string }> = ({ exemplo = 'Cadastra camiseta preta M, R$ 49,90' }) => (
    <div className="w-full max-w-sm mx-auto rounded-[28px] border-4 border-[#101C31] bg-[#0A1220] shadow-[0_0_60px_rgba(46,155,255,0.15)] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-[#101C31]">
            <span className="w-10 h-10 rounded-full bg-[#FFD43B] text-[#0A1220] flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
            <div>
                <p className="font-bold text-white leading-tight">Consultor M-IA</p>
                <p className="text-xs text-emerald-400">sabe tudo da sua loja</p>
            </div>
        </div>
        <div className="p-4 space-y-3 text-sm">
            <p className="bg-[#101C31] border border-[#24344F] text-[#DCE8F7] rounded-2xl rounded-tl-sm p-3">Bom dia! Seu produto mais vendido está abaixo do estoque mínimo.</p>
            <p className="inline-flex items-center gap-2 bg-[#FFD43B] text-[#0A1220] font-bold rounded-xl px-3 py-2"><ShoppingCart className="w-4 h-4" /> Gerar pedido de compra</p>
            <p className="ml-auto max-w-[85%] bg-[#2E9BFF] text-white rounded-2xl rounded-tr-sm p-3">{exemplo}</p>
            <p className="bg-[#101C31] border border-[#24344F] text-[#DCE8F7] rounded-2xl rounded-tl-sm p-3">Pronto: categoria e NCM preenchidos. Confirma?</p>
            <p className="inline-flex items-center gap-2 bg-emerald-600 text-white font-bold rounded-xl px-3 py-2"><Check className="w-4 h-4" /> Confirmar cadastro</p>
        </div>
    </div>
);

/** O que o sistema FAZ pelo lojista (os 4 trabalhos que ele tirava das costas). */
export const TrabalhosDoSistema: React.FC = () => (
    <div className="grid sm:grid-cols-2 gap-4">
        {[
            { icone: ScanBarcode, titulo: 'Bipou, cadastrou', texto: 'Pelo código de barras o produto entra com nome, marca e foto.' },
            { icone: Sparkles, titulo: 'Você pede, a IA faz', texto: 'Cadastra produto por texto, gera pedido de compra e cria lembrete.' },
            { icone: ShieldCheck, titulo: 'Avisa antes do prejuízo', texto: 'Estoque baixo, validade chegando, fiado atrasado e boleto vencendo.' },
            { icone: Store, titulo: 'Mostra o lucro de verdade', texto: 'Despesas, contas a pagar e o que sobrou no mês, não só o que entrou.' },
        ].map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="flex gap-4 p-5 rounded-2xl bg-[#0A1220] border border-[#24344F]">
                <span className="w-11 h-11 shrink-0 rounded-xl bg-[#2E9BFF]/10 border border-[#2E9BFF]/30 flex items-center justify-center"><Icone className="w-5 h-5 text-[#6FCBFF]" /></span>
                <div>
                    <p className="font-bold text-white">{titulo}</p>
                    <p className="text-sm text-[#8FA3C0] mt-1">{texto}</p>
                </div>
            </div>
        ))}
    </div>
);

/** Implantação feita pelo próprio desenvolvedor: é o diferencial do porta a porta. */
export const ImplantaComVoce: React.FC = () => (
    <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
        {[
            { n: 1, titulo: 'A gente vai até você', texto: 'Conversa na sua loja, entende como você vende e o que precisa controlar.' },
            { n: 2, titulo: 'A gente configura tudo', texto: 'Importamos seus produtos, cadastramos a equipe e deixamos o caixa pronto para vender.' },
            { n: 3, titulo: 'Você anda sozinho', texto: 'Nos 2 meses grátis você aprende no dia a dia, com o desenvolvedor a um WhatsApp de distância.' },
        ].map(p => (
            <div key={p.n} className="relative p-6 sm:p-8 rounded-[20px] bg-[#101C31] border border-[#24344F]">
                <span className="w-12 h-12 rounded-full bg-[#2E9BFF] text-white font-black text-xl flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(46,155,255,0.4)]">{p.n}</span>
                <p className="text-lg font-bold text-white mb-2">{p.titulo}</p>
                <p className="text-[#8FA3C0]">{p.texto}</p>
            </div>
        ))}
    </div>
);

/** Credibilidade: sistema brasileiro, quem fez é quem atende. */
export const FaleComDesenvolvedor: React.FC = () => (
    <div className="grid sm:grid-cols-3 gap-4">
        {[
            { icone: UserCheck, titulo: 'Você fala com quem fez', texto: 'Sem central de atendimento: o desenvolvedor do sistema te atende pelo WhatsApp.' },
            { icone: ShieldCheck, titulo: 'Seus dados protegidos', texto: 'Os dados de cada loja ficam separados, e tudo que acontece no sistema fica registrado.' },
            { icone: Wrench, titulo: '100% brasileiro', texto: 'Feito para o comércio brasileiro: fiado, Pix, crediário e o jeito de vender daqui.' },
        ].map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="p-5 rounded-2xl bg-[#0A1220] border border-[#24344F]">
                <Icone className="w-6 h-6 text-emerald-400 mb-3" />
                <p className="font-bold text-white">{titulo}</p>
                <p className="text-sm text-[#8FA3C0] mt-1">{texto}</p>
            </div>
        ))}
    </div>
);

/** Primeira cliente real (autorizada). Nada de depoimento inventado. */
export const PrimeiraCliente: React.FC = () => (
    <div className="max-w-3xl mx-auto p-6 sm:p-10 rounded-[24px] bg-[#0A1220] border border-[#24344F] text-center">
        <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-5">Primeira cliente</span>
        <p className="text-xl sm:text-2xl font-bold text-white leading-snug mb-5">
            Leiga em sistema, aprendeu a usar em poucos minutos e hoje controla a loja inteira pelo MercadinhoSys.
        </p>
        <div className="flex items-center justify-center gap-3">
            <span className="w-12 h-12 rounded-full bg-emerald-500 text-white font-bold text-xl flex items-center justify-center">V</span>
            <div className="text-left">
                <p className="font-bold text-white">Vera Moreti Felipe</p>
                <p className="text-sm text-[#8FA3C0]">Saldão Capraro Outlet</p>
            </div>
        </div>
    </div>
);

/** Oferta do panfleto, com a promessa por extenso. */
export const OfertaDoisMeses: React.FC<{ origem: string; onCadastro: () => void }> = ({ origem, onCadastro }) => (
    <div className="max-w-4xl mx-auto rounded-[28px] bg-[#FFD43B] text-[#0A1220] p-6 sm:p-10 shadow-[0_0_60px_rgba(255,212,59,0.15)]">
        <span className="inline-block px-4 py-1.5 rounded-full bg-[#0A1220] text-[#FFD43B] text-xs font-black uppercase tracking-widest mb-4">Oferta de lançamento</span>
        <p className="text-4xl sm:text-6xl font-black leading-none mb-3">2 meses grátis</p>
        <p className="text-lg sm:text-xl font-semibold mb-2">
            Você só paga se gostar e se fizer sentido para o seu negócio.
        </p>
        <p className="text-base sm:text-lg mb-6">
            Depois, <strong>R$ 99,90/mês</strong> com preço travado: menos de R$ 3,40 por dia.
        </p>
        <ul className="grid sm:grid-cols-2 gap-2 mb-8 text-sm sm:text-base font-semibold">
            {['Implantação feita junto com você', 'Sem taxa de implantação', 'Sem fidelidade, sem multa', 'Sem cartão para começar'].map(i => (
                <li key={i} className="flex items-center gap-2"><Check className="w-5 h-5 shrink-0" /> {i}</li>
            ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-3">
            <a
                href={linkWhatsApp(`Olá! Vi o MercadinhoSys (${origem}) e quero os 2 meses grátis com implantação.`)}
                target="_blank" rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#0A1220] text-white font-bold text-lg hover:bg-[#101C31] transition-colors"
            >
                <MessageCircle className="w-5 h-5" /> Chamar no WhatsApp
            </a>
            <button
                type="button" onClick={onCadastro}
                className="flex-1 px-6 py-4 rounded-xl border-2 border-[#0A1220] font-bold text-lg hover:bg-[#0A1220]/5 transition-colors"
            >
                Criar minha conta grátis
            </button>
        </div>
        <p className="text-xs mt-5 opacity-80">*Emissão de nota fiscal com custo à parte. Consulte as condições no atendimento.</p>
    </div>
);

/** Rodapé público: regiões atendidas e todos os nichos (links internos ajudam o Google). */
export const RodapeRegioes: React.FC = () => (
    <div className="text-center text-sm text-[#8FA3C0] space-y-2">
        <p>Atendimento presencial em <strong className="text-white">{REGIOES_ATENDIDAS.join(', ')}</strong>.</p>
        <p>WhatsApp <a className="text-white font-bold" href={linkWhatsApp('Olá! Quero conhecer o MercadinhoSys.')} target="_blank" rel="noreferrer">{WHATSAPP_EXIBICAO}</a> · <Link to="/" className="hover:text-white">mercadinhosys</Link></p>
    </div>
);
