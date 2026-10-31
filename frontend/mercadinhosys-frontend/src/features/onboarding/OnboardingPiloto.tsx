import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Lock, ShoppingCart, Package, Wallet, Sparkles, X } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { authService } from '../../features/auth/authService';

/**
 * Onboarding executável do piloto (FASE 2.3).
 *
 * O "Tour & Ajuda" tem 13 passos de pitch e responde a uma pergunta que o dono
 * não fez ("o que este produto faz"). Ele quer saber como abrir o caixa e vender
 * o primeiro pão — com cliente esperando na porta.
 *
 * Aqui são 4 cards, em ordem fixa, e cada botão FAZ a coisa em vez de explicar.
 * O progresso NÃO é estado hardcoded: cada "feito" deriva dos dados reais da loja
 * (caixa aberto?, nº de produtos cadastrados, vendas de hoje). Só o "dispensado"
 * (o dono fechou a pílula) vive no localStorage — é estado de UI, não de operação.
 */

interface DadosLoja {
    caixaAberto: boolean;
    produtosCadastrados: number;
    vendasHoje: number;
    carregado: boolean;
}

interface ItemOnboarding {
    chave: string;
    titulo: string;
    descricao: string;
    acao: string;
    rota: string;
    icone: typeof Wallet;
    feito: boolean;
}

const CHAVE_DISPENSADO = 'onboarding_piloto_dispensado_v1';

function chaveDispensado(): string {
    const user = authService.getCurrentUser() as { estabelecimento_id?: number | string } | null;
    const estab = user?.estabelecimento_id ?? 'padrao';
    return `${CHAVE_DISPENSADO}_${estab}`;
}

const OnboardingPiloto: React.FC = () => {
    const navigate = useNavigate();
    const [dados, setDados] = useState<DadosLoja>({
        caixaAberto: false,
        produtosCadastrados: 0,
        vendasHoje: 0,
        carregado: false,
    });
    const [dispensado, setDispensado] = useState<boolean>(() => {
        try {
            return localStorage.getItem(chaveDispensado()) === '1';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        let vivo = true;
        (async () => {
            let caixaAberto = false;
            let produtos = 0;
            let vendas = 0;

            // Caixa aberto? (/caixas/atual devolve null/data sem id quando não há caixa aberto)
            try {
                const caixa = await apiClient.get('/caixas/atual');
                caixaAberto = Boolean(caixa.data?.data?.id);
            } catch {
                // sem sinal de caixa: mantém "fechado" (não derruba o onboarding)
            }

            // Nº de produtos cadastrados e vendas de hoje vêm do dashboard científico (dados reais).
            try {
                const dash = await apiClient.get('/dashboard/cientifico?days=1');
                const d = dash.data?.data || dash.data || {};
                produtos = Number(d.inventory?.total_produtos || 0);
                vendas = Number(d.financials?.count ?? d.summary?.revenue?.sample_size ?? 0);
            } catch {
                // dashboard indisponível: mantém zeros — nunca inventa número
            }

            if (vivo) {
                setDados({ caixaAberto, produtosCadastrados: produtos, vendasHoje: vendas, carregado: true });
            }
        })();
        return () => {
            vivo = false;
        };
    }, []);

    const dispensar = () => {
        setDispensado(true);
        try {
            localStorage.setItem(chaveDispensado(), '1');
        } catch {
            // localStorage indisponível (modo privado): a pílula volta na próxima sessão
        }
    };

    const passos: ItemOnboarding[] = [
        {
            chave: 'abrir_caixa',
            titulo: 'Abrir meu caixa',
            descricao: dados.caixaAberto
                ? 'Caixa aberto. Bom turno!'
                : 'Informe o troco que está na gaveta. O sistema já sugere o valor de ontem.',
            acao: 'Abrir caixa',
            rota: '/pdv?manage=true',
            icone: Wallet,
            feito: dados.caixaAberto,
        },
        {
            chave: 'primeiro_produto',
            titulo: 'Cadastrar meu primeiro produto',
            descricao: dados.produtosCadastrados > 0
                ? `${dados.produtosCadastrados} produto(s) cadastrado(s).`
                : 'Bipe o código de barras: o nome e a foto vêm sozinhos.',
            acao: 'Cadastrar produto',
            rota: '/products',
            icone: Package,
            feito: dados.produtosCadastrados > 0,
        },
        {
            chave: 'primeira_venda',
            titulo: 'Fazer minha primeira venda',
            descricao: dados.vendasHoje > 0
                ? `${dados.vendasHoje} venda(s) hoje.`
                : 'Bipe, escolha o pagamento e conclua. Leva menos de um minuto.',
            acao: 'Ir para o PDV',
            rota: '/pdv',
            icone: ShoppingCart,
            feito: dados.vendasHoje > 0,
        },
        {
            chave: 'fechar_caixa',
            titulo: 'Fechar meu caixa',
            descricao: !dados.caixaAberto && dados.vendasHoje > 0
                ? 'Caixa fechado. O resumo do dia saiu pronto.'
                : 'Confira a gaveta e feche o turno. O resumo do dia sai pronto.',
            acao: 'Fechar caixa',
            rota: '/pdv?manage=true',
            icone: Lock,
            feito: !dados.caixaAberto && dados.vendasHoje > 0,
        },
    ];

    const concluidos = passos.filter(p => p.feito).length;
    const total = passos.length;

    // Só esconde sozinho quando os dados chegaram e está tudo feito — nunca durante o carregamento.
    if (dispensado || (dados.carregado && concluidos === total)) return null;

    const proximo = passos.find(p => !p.feito);
    const percentual = total > 0 ? Math.round((concluidos / total) * 100) : 0;

    return (
        <section className="mb-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-900 dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-black text-gray-900 dark:text-white">
                        <Sparkles className="h-5 w-5 text-blue-600" />
                        Primeiros passos na loja
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {dados.carregado
                            ? `${concluidos} de ${total} concluídos. Cada botão faz, não explica.`
                            : 'Carregando o estado da loja…'}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                        {concluidos}/{total}
                    </span>
                    <button
                        type="button"
                        onClick={dispensar}
                        aria-label="Fechar onboarding"
                        title="Fechar"
                        className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Barra de progresso */}
            <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${percentual}%` }}
                />
            </div>

            <ol className="grid gap-2 md:grid-cols-2">
                {passos.map((passo, indice) => {
                    const feito = passo.feito;
                    const Icone = feito ? Check : passo.icone;
                    const destacado = proximo?.chave === passo.chave;
                    return (
                        <li
                            key={passo.chave}
                            className={`rounded-xl border p-3 ${feito
                                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
                                : destacado
                                    ? 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30'
                                    : 'border-gray-200 dark:border-gray-700'}`}
                        >
                            <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${feito ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                                    <Icone className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                                        {indice + 1}. {passo.titulo}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{passo.descricao}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={() => navigate(passo.rota)}
                                            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-blue-700"
                                        >
                                            {passo.acao}
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>

            <p className="mt-3 text-xs text-gray-400">
                Quer o tour completo do produto? Ele continua no botão "Tour &amp; Ajuda" do menu.
            </p>
        </section>
    );
};

export default OnboardingPiloto;
