import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Lock, ShoppingCart, Package, Wallet, Sparkles } from 'lucide-react';
import { authService } from '../../features/auth/authService';

/**
 * Onboarding executável do piloto (FASE 2.3).
 *
 * O "Tour & Ajuda" tem 13 passos de pitch e responde a uma pergunta que o dono
 * não fez ("o que este produto faz"). Ele quer saber como abrir o caixa e vender
 * o primeiro pão — com cliente esperando na porta.
 *
 * Aqui são 4 cards, em ordem fixa, e cada botão FAZ a coisa em vez de explicar.
 * O estado "feito" é por estabelecimento e vive no localStorage do aparelho
 * (é estado de onboarding, não configuração da operação — não vai para o banco).
 */

interface ItemOnboarding {
    chave: string;
    titulo: string;
    descricao: string;
    acao: string;
    rota: string;
    icone: typeof Wallet;
}

const PASSOS: ItemOnboarding[] = [
    {
        chave: 'abrir_caixa',
        titulo: 'Abrir meu caixa',
        descricao: 'Informe o troco que está na gaveta. O sistema já sugere o valor de ontem.',
        acao: 'Abrir caixa',
        rota: '/pdv?manage=true',
        icone: Wallet,
    },
    {
        chave: 'primeiro_produto',
        titulo: 'Cadastrar meu primeiro produto',
        descricao: 'Bipe o código de barras: o nome e a foto vêm sozinhos.',
        acao: 'Cadastrar produto',
        rota: '/products',
        icone: Package,
    },
    {
        chave: 'primeira_venda',
        titulo: 'Fazer minha primeira venda',
        descricao: 'Bipe, escolha o pagamento e conclua. Leva menos de um minuto.',
        acao: 'Ir para o PDV',
        rota: '/pdv',
        icone: ShoppingCart,
    },
    {
        chave: 'fechar_caixa',
        titulo: 'Fechar meu caixa',
        descricao: 'Confira a gaveta e feche o turno. O resumo do dia sai pronto.',
        acao: 'Fechar caixa',
        rota: '/pdv?manage=true',
        icone: Lock,
    },
];

const CHAVE_STORAGE = 'onboarding_piloto_v1';

function chaveDoEstabelecimento(): string {
    const user = authService.getCurrentUser() as { estabelecimento_id?: number | string } | null;
    const estab = user?.estabelecimento_id ?? 'padrao';
    return `${CHAVE_STORAGE}_${estab}`;
}

function lerFeitos(): Record<string, boolean> {
    try {
        return JSON.parse(localStorage.getItem(chaveDoEstabelecimento()) || '{}') || {};
    } catch {
        return {};
    }
}

const OnboardingPiloto: React.FC = () => {
    const navigate = useNavigate();
    const [feitos, setFeitos] = useState<Record<string, boolean>>(() => lerFeitos());

    useEffect(() => {
        try {
            localStorage.setItem(chaveDoEstabelecimento(), JSON.stringify(feitos));
        } catch {
            // localStorage indisponível (modo privado): o checklist vale só nesta sessão
        }
    }, [feitos]);

    const concluidos = PASSOS.filter(p => feitos[p.chave]).length;
    if (concluidos === PASSOS.length) return null;

    const proximo = PASSOS.find(p => !feitos[p.chave]);

    return (
        <section className="mb-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-900 dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-black text-gray-900 dark:text-white">
                        <Sparkles className="h-5 w-5 text-blue-600" />
                        Primeiros passos na loja
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {concluidos} de {PASSOS.length} concluídos. Cada botão faz, não explica.
                    </p>
                </div>
                <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                    {concluidos}/{PASSOS.length}
                </span>
            </div>

            <ol className="grid gap-2 md:grid-cols-2">
                {PASSOS.map((passo, indice) => {
                    const feito = !!feitos[passo.chave];
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
                                        {!feito && (
                                            <button
                                                onClick={() => setFeitos(prev => ({ ...prev, [passo.chave]: true }))}
                                                className="text-xs font-bold text-gray-500 underline hover:text-gray-700 dark:text-gray-400"
                                            >
                                                Já fiz
                                            </button>
                                        )}
                                        {feito && (
                                            <button
                                                onClick={() => setFeitos(prev => ({ ...prev, [passo.chave]: false }))}
                                                className="text-xs font-bold text-gray-400 underline hover:text-gray-600"
                                            >
                                                refazer
                                            </button>
                                        )}
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
