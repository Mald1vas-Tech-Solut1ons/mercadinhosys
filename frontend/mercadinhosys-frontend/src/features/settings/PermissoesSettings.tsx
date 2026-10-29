import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RotateCcw, ShieldCheck } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../components/elements/Toast';

interface Nivel { nivel: number; rotulo: string }
interface Regra { niveis: number[]; pin: boolean }
interface Acao extends Regra { chave: string; rotulo: string; grupo: string; padrao: Regra }

/**
 * Configurações → Sistema & Segurança → Permissões.
 * Para cada ação sensível, o admin escolhe quais cargos podem fazê-la e se ela exige o
 * PIN de um Admin/Gerente (ex.: caixa cadastra cliente só com PIN). A regra vale no
 * servidor; quando exige PIN, qualquer tela pede o PIN sozinha. O admin sempre pode tudo.
 */
const PermissoesSettings = () => {
    const [niveis, setNiveis] = useState<Nivel[]>([]);
    const [acoes, setAcoes] = useState<Acao[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [alterado, setAlterado] = useState(false);

    const aplicar = (dados: { niveis: Nivel[]; acoes: Acao[] }) => {
        setNiveis(dados.niveis);
        setAcoes(dados.acoes);
        setAlterado(false);
    };

    useEffect(() => {
        apiClient.get('/configuracao/permissoes')
            .then((r) => aplicar(r.data))
            .catch(() => showToast.error('Não foi possível carregar as permissões'))
            .finally(() => setCarregando(false));
    }, []);

    const grupos = useMemo(() => {
        const mapa = new Map<string, Acao[]>();
        acoes.forEach((a) => mapa.set(a.grupo, [...(mapa.get(a.grupo) || []), a]));
        return Array.from(mapa.entries());
    }, [acoes]);

    const mudar = (chave: string, fn: (a: Acao) => Acao) => {
        setAcoes((lista) => lista.map((a) => (a.chave === chave ? fn(a) : a)));
        setAlterado(true);
    };

    const alternarNivel = (chave: string, nivel: number) => mudar(chave, (a) => ({
        ...a,
        niveis: a.niveis.includes(nivel) ? a.niveis.filter((n) => n !== nivel) : [...a.niveis, nivel].sort(),
    }));

    const salvar = async () => {
        setSalvando(true);
        try {
            const corpo = Object.fromEntries(acoes.map((a) => [a.chave, { niveis: a.niveis.filter((n) => n !== 1), pin: a.pin }]));
            const r = await apiClient.put('/configuracao/permissoes', { acoes: corpo });
            aplicar(r.data);
            showToast.success('Permissões salvas. Já valem para todos os caixas.');
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Erro ao salvar permissões');
        } finally {
            setSalvando(false);
        }
    };

    const restaurarPadrao = () => {
        setAcoes((lista) => lista.map((a) => ({ ...a, niveis: [1, ...a.padrao.niveis.filter((n) => n !== 1)], pin: a.padrao.pin })));
        setAlterado(true);
    };

    if (carregando) {
        return <p className="text-sm text-gray-500 dark:text-gray-400">Carregando permissões…</p>;
    }

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                        <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Permissões por ação
                    </h3>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                        Marque quais cargos podem fazer cada ação. Com <strong>PIN</strong> ligado, quem não é
                        Admin/Gerente só conclui com o PIN de um deles. O Admin sempre pode tudo.
                    </p>
                </div>
                <button type="button" onClick={restaurarPadrao}
                    className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                </button>
            </div>

            {grupos.map(([grupo, lista]) => (
                <section key={grupo} className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{grupo}</h4>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-100 dark:border-gray-700">
                        {lista.map((acao) => (
                            <li key={acao.chave} className="p-3 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{acao.rotulo}</span>
                                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                                        <KeyRound className="w-3.5 h-3.5 text-amber-600" /> PIN
                                        <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={acao.pin}
                                            onChange={() => mudar(acao.chave, (a) => ({ ...a, pin: !a.pin }))} />
                                    </label>
                                </div>
                                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Cargos que podem: ${acao.rotulo}`}>
                                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Admin</span>
                                    {niveis.map((n) => {
                                        const ativo = acao.niveis.includes(n.nivel);
                                        return (
                                            <button key={n.nivel} type="button" aria-pressed={ativo}
                                                onClick={() => alternarNivel(acao.chave, n.nivel)}
                                                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${ativo
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
                                                {n.rotulo}
                                            </button>
                                        );
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            <div className="flex justify-end">
                <button type="button" onClick={salvar} disabled={!alterado || salvando}
                    className="min-h-[44px] px-5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                    {salvando ? 'Salvando…' : 'Salvar permissões'}
                </button>
            </div>
        </div>
    );
};

export default PermissoesSettings;
