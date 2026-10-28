import { useEffect, useMemo, useState } from 'react';
import { Grid3x3, Plus, Loader2 } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { showToast } from '../../../utils/toast';

interface Celula {
    id: number;
    nome: string;
    numeracao: string;
    cor: string | null;
    quantidade: number;
    quantidade_minima: number;
    codigo_interno: string;
    vendidos: number;
}

interface Grade {
    modelo: { id: number; nome: string } | null;
    numeracoes: string[];
    cores: string[];
    celulas: Celula[];
    total: number;
    total_vendidos?: number;
}

const NUMEROS_ADULTO = ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44'];
const NUMEROS_INFANTIL = ['18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32'];

const chave = (n: string, c: string | null) => `${n}|${c || ''}`;

interface GradePanelProps {
    produtoId: number;
    /** Sugestões vindas do cadastro (atributos "numeracao"/"tamanhos" e "cores"). */
    numerosSugeridos?: string[];
    coresSugeridas?: string[];
    onAlterada?: () => void;
}

/** Grade por número/cor: cada célula é um produto vendável com estoque próprio. */
const GradePanel = ({ produtoId, numerosSugeridos = [], coresSugeridas = [], onAlterada }: GradePanelProps) => {
    const [grade, setGrade] = useState<Grade | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [editando, setEditando] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [numeros, setNumeros] = useState<string[]>([]);
    const [numeroAvulso, setNumeroAvulso] = useState('');
    const [coresTexto, setCoresTexto] = useState('');
    const [quantidades, setQuantidades] = useState<Record<string, string>>({});

    const carregar = async () => {
        setCarregando(true);
        try {
            const { data } = await apiClient.get(`/produtos/${produtoId}/grade`);
            setGrade(data.grade);
        } catch {
            setGrade(null);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { carregar(); }, [produtoId]);

    const temGrade = !!grade?.modelo && grade.celulas.length > 0;
    const cores = useMemo(
        () => coresTexto.split(',').map((c) => c.trim()).filter(Boolean),
        [coresTexto],
    );
    const coresGrade = cores.length ? cores : [null];
    const existentes = useMemo(
        () => new Set((grade?.celulas || []).map((c) => chave(c.numeracao, c.cor))),
        [grade],
    );

    const abrirFormulario = () => {
        setNumeros(temGrade ? [] : numerosSugeridos.filter(Boolean));
        setCoresTexto((temGrade ? grade!.cores : coresSugeridas).join(', '));
        setQuantidades({});
        setEditando(true);
    };

    const alternarNumero = (n: string) =>
        setNumeros((atual) => (atual.includes(n) ? atual.filter((x) => x !== n) : [...atual, n]));

    const incluirAvulso = () => {
        const n = numeroAvulso.trim();
        if (n && !numeros.includes(n)) setNumeros([...numeros, n]);
        setNumeroAvulso('');
    };

    const salvar = async () => {
        if (!numeros.length) {
            showToast.error('Escolha ao menos um número.');
            return;
        }
        setSalvando(true);
        try {
            const qtds: Record<string, number> = {};
            Object.entries(quantidades).forEach(([k, v]) => { if (Number(v) > 0) qtds[k] = Number(v); });
            const { data } = await apiClient.post(`/produtos/${produtoId}/grade`, {
                numeracoes: numeros, cores, quantidades: qtds,
            });
            setGrade(data.grade);
            setEditando(false);
            showToast.success(`${data.criadas} variação(ões) criada(s) na grade.`);
            onAlterada?.();
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Não foi possível criar a grade.');
        } finally {
            setSalvando(false);
        }
    };

    const qtdCelula = (n: string, c: string | null) =>
        grade?.celulas.find((x) => x.numeracao === n && (x.cor || null) === (c || null));

    if (carregando) {
        return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando grade...</div>;
    }

    // Giro por número: destaca o que mais vende, para comprar a grade certa.
    const maisVendido = Math.max(0, ...(grade?.celulas || []).map((c) => c.vendidos || 0));
    const numerosOrdenados = [...numeros].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Grid3x3 className="w-4 h-4 text-emerald-500" /> Grade por Número
                    {temGrade && <span className="ml-2 normal-case tracking-normal font-bold text-gray-500 dark:text-gray-400">· {grade!.total} un em estoque · {grade!.total_vendidos ?? 0} vendidas</span>}
                </h3>
                {!editando && (
                    <button onClick={abrirFormulario}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                        <Plus className="w-3.5 h-3.5" /> {temGrade ? 'Adicionar números' : 'Criar grade'}
                    </button>
                )}
            </div>

            {temGrade && (
                <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs text-center">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 text-[10px] font-black text-gray-500 uppercase dark:text-gray-400">
                            <tr>
                                <th className="px-3 py-2 text-left">Cor</th>
                                {grade!.numeracoes.map((n) => <th key={n} className="px-3 py-2">{n}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {(grade!.cores.length ? grade!.cores : [null]).map((c) => (
                                <tr key={c || 'sem-cor'}>
                                    <td className="px-3 py-2 text-left font-bold text-gray-700 dark:text-gray-300">{c || '—'}</td>
                                    {grade!.numeracoes.map((n) => {
                                        const cel = qtdCelula(n, c);
                                        if (!cel) return <td key={n} className="px-3 py-2 text-gray-300">·</td>;
                                        const cor = cel.quantidade <= 0 ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                                            : cel.quantidade <= cel.quantidade_minima ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                                : 'text-gray-900 dark:text-white';
                                        return (
                                            <td key={n} className={`px-3 py-2 font-black ${cor}`} title={`${cel.nome} · ${cel.codigo_interno}`}>
                                                {cel.quantidade}
                                                <span className={`block text-[10px] font-semibold ${cel.vendidos > 0 && cel.vendidos === maisVendido ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                                    {cel.vendidos} vend.
                                                </span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
                        Número grande = estoque; embaixo, quanto já vendeu (verde = o mais vendido). Vermelho = esgotado · amarelo = no mínimo.
                    </p>
                </div>
            )}

            {!temGrade && !editando && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Separe o estoque por número (e cor): cada um vira um item com código e estoque próprios, e este produto passa a ser o modelo.
                </p>
            )}

            {editando && (
                <div className="space-y-4 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-900/10">
                    <div>
                        <p className="text-[10px] font-black text-gray-500 uppercase mb-2 dark:text-gray-400">Números</p>
                        {[NUMEROS_ADULTO, NUMEROS_INFANTIL].map((lista, i) => (
                            <div key={i} className="flex flex-wrap gap-1.5 mb-2">
                                {lista.map((n) => {
                                    const ativo = numeros.includes(n);
                                    return (
                                        <button key={n} type="button" onClick={() => alternarNumero(n)}
                                            className={`min-w-[38px] px-2 py-1 rounded-lg text-xs font-bold border ${ativo
                                                ? 'bg-emerald-600 text-white border-emerald-600'
                                                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}>
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        <div className="flex gap-2">
                            <input value={numeroAvulso} onChange={(e) => setNumeroAvulso(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); incluirAvulso(); } }}
                                placeholder="Outro (ex: 37/38, P, M)"
                                className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                            <button type="button" onClick={incluirAvulso} className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 text-xs font-bold">Incluir</button>
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-black text-gray-500 uppercase mb-2 dark:text-gray-400">Cores (opcional, separadas por vírgula)</p>
                        <input value={coresTexto} onChange={(e) => setCoresTexto(e.target.value)} placeholder="Ex: Preto, Branco"
                            className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
                    </div>

                    {numerosOrdenados.length > 0 && (
                        <div className="overflow-x-auto">
                            <p className="text-[10px] font-black text-gray-500 uppercase mb-2 dark:text-gray-400">Estoque inicial de cada número</p>
                            <table className="text-xs text-center">
                                <thead>
                                    <tr>
                                        <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400">Cor</th>
                                        {numerosOrdenados.map((n) => <th key={n} className="px-2 py-1 text-gray-500 dark:text-gray-400">{n}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {coresGrade.map((c) => (
                                        <tr key={c || 'sem-cor'}>
                                            <td className="px-2 py-1 text-left font-bold text-gray-700 dark:text-gray-300">{c || '—'}</td>
                                            {numerosOrdenados.map((n) => {
                                                const k = chave(n, c);
                                                return (
                                                    <td key={n} className="px-1 py-1">
                                                        {existentes.has(k) ? (
                                                            <span className="text-[10px] text-gray-400">já existe</span>
                                                        ) : (
                                                            <input type="number" min={0} inputMode="numeric" value={quantidades[k] ?? ''}
                                                                onChange={(e) => setQuantidades({ ...quantidades, [k]: e.target.value })}
                                                                placeholder="0"
                                                                className="w-14 px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center" />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditando(false)} disabled={salvando}
                            className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-bold">Cancelar</button>
                        <button type="button" onClick={salvar} disabled={salvando}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-60">
                            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar grade
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GradePanel;
