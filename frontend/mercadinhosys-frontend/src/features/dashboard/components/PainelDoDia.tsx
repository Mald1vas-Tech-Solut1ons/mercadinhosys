import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, MessageCircle, PackageX, Wallet } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { formatCurrency } from '../../../utils/formatters';

/**
 * Painel do dia — as três perguntas que o dono faz às 7h.
 *
 * O dashboard respondia a pergunta que ele NÃO faz ("visão executiva", 30 dias de
 * gráfico). Aqui cada cartão responde uma pergunta e traz o botão que resolve:
 *
 *   1. "Tá faltando o quê na gôndola?"  -> Repor agora
 *   2. "Alguém me deve e vence hoje?"   -> Cobrar no WhatsApp
 *   3. "Fechei bem ontem?"              -> Resolver o caixa esquecido
 *
 * Só aparece o que existe: sem dado, o cartão não é renderizado (nada de zero
 * inventado para preencher layout).
 */

interface AlertaOperacional {
    tipo: 'ruptura' | 'cobertura' | 'vencimento' | 'vencido';
    produto_id?: number;
}

interface Devedor {
    id?: number;
    nome?: string;
    celular?: string;
    saldo_devedor?: number;
    total_devido?: number;
    valor_devido?: number;
}

interface CaixaAtual {
    id?: number;
    data_abertura?: string;
    numero_caixa?: string;
}

const HORAS_CAIXA_ESQUECIDO = 14;

const linkWhatsApp = (celular?: string, nome?: string, valor?: number): string | null => {
    const digitos = (celular || '').replace(/\D/g, '');
    if (digitos.length < 10) return null;
    const comPais = digitos.startsWith('55') ? digitos : `55${digitos}`;
    const mensagem = `Ola${nome ? ` ${nome}` : ''}, tudo bem? Passando para lembrar do valor de ${formatCurrency(valor || 0)} em aberto na sua conta.`;
    return `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}`;
};

const PainelDoDia: React.FC<{ data: any }> = ({ data }) => {
    const navigate = useNavigate();
    const [alertas, setAlertas] = useState<AlertaOperacional[]>([]);
    const [caixa, setCaixa] = useState<CaixaAtual | null>(null);
    const [carregado, setCarregado] = useState(false);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const resposta = await apiClient.get('/dashboard/alertas');
                if (vivo) setAlertas(resposta.data?.alertas || []);
            } catch {
                // Painel do dia não pode derrubar o dashboard: sem alertas, sem cartão.
            }
            try {
                const resposta = await apiClient.get('/caixas/atual');
                if (vivo) setCaixa(resposta.data?.data || null);
            } catch {
                if (vivo) setCaixa(null);
            }
            if (vivo) setCarregado(true);
        })();
        return () => { vivo = false; };
    }, []);

    const faltando = alertas.filter(a => a.tipo === 'ruptura' || a.tipo === 'cobertura');
    const devedores: Devedor[] = data?.fiado?.top_devedores || [];
    const totalDevido = devedores.reduce(
        (soma, d) => soma + Number(d.saldo_devedor ?? d.total_devido ?? d.valor_devido ?? 0), 0,
    );

    const horasAberto = caixa?.data_abertura
        ? (Date.now() - new Date(caixa.data_abertura).getTime()) / 3_600_000
        : 0;
    const caixaEsquecido = horasAberto > HORAS_CAIXA_ESQUECIDO;

    const primeiroDevedor = devedores[0];

    const cartoes: { chave: string; pergunta: string; resposta: string; acao: string; icone: typeof Wallet; classe: string; onClick: () => void }[] = [];

    if (faltando.length > 0) {
        cartoes.push({
            chave: 'repor',
            pergunta: 'Tá faltando o quê na gôndola?',
            resposta: `${faltando.length} produto(s) com estoque zerado ou acabando`,
            acao: 'Repor agora',
            icone: PackageX,
            classe: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 text-red-900 dark:text-red-200',
            onClick: () => navigate('/products'),
        });
    }

    if (devedores.length > 0) {
        const link = linkWhatsApp(primeiroDevedor?.celular, primeiroDevedor?.nome, totalDevido);
        cartoes.push({
            chave: 'cobrar',
            pergunta: 'Alguém me deve?',
            resposta: `${devedores.length} cliente(s) · ${formatCurrency(totalDevido)} em aberto`,
            acao: link ? 'Cobrar no WhatsApp' : 'Ver clientes',
            icone: MessageCircle,
            classe: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
            onClick: () => {
                if (link) window.open(link, '_blank');
                else navigate('/customers');
            },
        });
    }

    if (caixaEsquecido) {
        cartoes.push({
            chave: 'caixa',
            pergunta: 'Ficou caixa aberto?',
            resposta: `Caixa${caixa?.numero_caixa ? ` ${caixa.numero_caixa}` : ''} aberto há ${Math.floor(horasAberto)}h — mistura turnos`,
            acao: 'Resolver',
            icone: AlertTriangle,
            classe: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
            onClick: () => navigate('/pdv?manage=true'),
        });
    }

    if (cartoes.length === 0) {
        // Só afirma que está tudo bem quando os dados já chegaram (nunca durante o carregamento).
        if (!carregado || !data) return null;
        return (
            <section aria-label="Resumo de pendências do dia" className="mb-4">
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    Tudo em dia: sem ruptura, sem fiado vencendo, caixa do dia ok
                </div>
            </section>
        );
    }

    return (
        <section aria-label="Pendências do dia" className="mb-4 grid gap-3 md:grid-cols-3">
            {cartoes.map(cartao => {
                const Icone = cartao.icone;
                return (
                    <div key={cartao.chave} className={`rounded-2xl border p-4 ${cartao.classe}`}>
                        <p className="flex items-center gap-2 text-sm font-bold opacity-90">
                            <Icone className="h-4 w-4 shrink-0" />
                            {cartao.pergunta}
                        </p>
                        <p className="mt-2 text-sm font-bold leading-snug">{cartao.resposta}</p>
                        <button
                            onClick={cartao.onClick}
                            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                        >
                            {cartao.acao}
                            <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                );
            })}
        </section>
    );
};

export default PainelDoDia;
