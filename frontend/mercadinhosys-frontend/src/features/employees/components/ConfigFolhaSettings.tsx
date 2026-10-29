import { useEffect, useState } from 'react';
import { Settings2, Save, Plus, Trash2, Percent, Calculator } from 'lucide-react';
import folhaService, { ConfiguracaoFolha } from '../folhaService';
import { showToast } from '../../../components/elements/Toast';
import { authService } from '../../auth/authService';
import { getNivel } from '../../../utils/permissions';

/**
 * Parâmetros de Folha — TUDO configurável (nada hardcoded): divisor de horas,
 * % hora extra, adicional noturno, FGTS, multa rescisória, desconto de VT,
 * dedução por dependente e as tabelas progressivas de INSS e IRRF.
 * Edição restrita a Admin/Gerente (nível ≤ 2); RH visualiza.
 */

const NumField = ({ label, value, onChange, suffix, disabled }: {
    label: string; value: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean;
}) => (
    <div>
        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{label}</label>
        <div className="relative">
            <input type="number" step="0.01" value={value} disabled={disabled}
                onChange={e => onChange(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white disabled:opacity-60" />
            {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-bold">{suffix}</span>}
        </div>
    </div>
);

export default function ConfigFolhaSettings() {
    const [cfg, setCfg] = useState<ConfiguracaoFolha | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const podeEditar = getNivel(authService.getCurrentUser()) <= 2;

    useEffect(() => {
        folhaService.getConfigFolha()
            .then(setCfg)
            .catch((e: any) => showToast.error(e?.response?.data?.message || 'Erro ao carregar parâmetros'))
            .finally(() => setLoading(false));
    }, []);

    const set = (patch: Partial<ConfiguracaoFolha>) => setCfg(c => c ? { ...c, ...patch } : c);

    const salvar = async () => {
        if (!cfg) return;
        setSaving(true);
        try {
            const salvo = await folhaService.updateConfigFolha(cfg);
            setCfg(salvo);
            showToast.success('Parâmetros de folha salvos!');
        } catch (e: any) {
            showToast.error(e?.response?.data?.message || 'Erro ao salvar');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !cfg) return <div className="py-12 text-center text-gray-500 text-sm dark:text-gray-400">Carregando parâmetros…</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"><Settings2 className="w-6 h-6" /></div>
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Parâmetros de Folha</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Tudo configurável — usado no holerite, rescisão e provisões</p>
                    </div>
                </div>
                {podeEditar && (
                    <button onClick={salvar} disabled={saving}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                        <Save className="w-4 h-4" /> {saving ? 'Salvando…' : 'Salvar parâmetros'}
                    </button>
                )}
            </div>

            {!podeEditar && (
                <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3">
                    Somente Admin ou Gerente podem alterar os parâmetros de folha. Você está no modo leitura.
                </div>
            )}

            {/* Percentuais gerais */}
            <div className="bg-white/80 dark:bg-gray-800/80 rounded-2xl p-6 border border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center gap-2 mb-4"><Percent className="w-5 h-5 text-indigo-500" /><h3 className="font-bold text-gray-900 dark:text-white">Percentuais e horas</h3></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <NumField label="Divisor horas/mês" value={cfg.divisor_horas_mensais} suffix="h" disabled={!podeEditar} onChange={v => set({ divisor_horas_mensais: Math.round(v) })} />
                    <NumField label="Hora extra" value={cfg.percentual_hora_extra} suffix="%" disabled={!podeEditar} onChange={v => set({ percentual_hora_extra: v })} />
                    <NumField label="Desconto VT" value={cfg.desconto_vt_percentual} suffix="%" disabled={!podeEditar} onChange={v => set({ desconto_vt_percentual: v })} />
                    <NumField label="FGTS" value={cfg.fgts_percentual} suffix="%" disabled={!podeEditar} onChange={v => set({ fgts_percentual: v })} />
                    <NumField label="Multa FGTS (dispensa)" value={cfg.multa_fgts_dispensa} suffix="%" disabled={!podeEditar} onChange={v => set({ multa_fgts_dispensa: v })} />
                    <NumField label="Multa FGTS (acordo)" value={cfg.multa_fgts_acordo} suffix="%" disabled={!podeEditar} onChange={v => set({ multa_fgts_acordo: v })} />
                    <NumField label="Dedução/dependente" value={cfg.deducao_por_dependente} suffix="R$" disabled={!podeEditar} onChange={v => set({ deducao_por_dependente: v })} />
                </div>
            </div>

            {/* Tabela INSS */}
            <FaixaEditor
                titulo="Tabela INSS (progressiva)"
                colunas={['Até (R$)', 'Alíquota (%)']}
                faixas={cfg.inss_faixas as any[]}
                podeEditar={podeEditar}
                onChange={(faixas) => set({ inss_faixas: faixas as any })}
                camposNumericos={['ate', 'aliquota']}
                novaLinha={{ ate: 0, aliquota: 0 }}
            />

            {/* Tabela IRRF */}
            <FaixaEditor
                titulo="Tabela IRRF (dedução)"
                colunas={['Até (R$)', 'Alíquota (%)', 'Dedução (R$)']}
                faixas={cfg.irrf_faixas as any[]}
                podeEditar={podeEditar}
                onChange={(faixas) => set({ irrf_faixas: faixas as any })}
                camposNumericos={['ate', 'aliquota', 'deducao']}
                novaLinha={{ ate: 0, aliquota: 0, deducao: 0 }}
            />
        </div>
    );
}

function FaixaEditor({ titulo, colunas, faixas, camposNumericos, novaLinha, podeEditar, onChange }: {
    titulo: string; colunas: string[]; faixas: any[]; camposNumericos: string[];
    novaLinha: any; podeEditar: boolean; onChange: (f: any[]) => void;
}) {
    const atualizar = (i: number, campo: string, valor: string) => {
        const copia = faixas.map((f, idx) => idx === i ? { ...f, [campo]: valor === '' ? null : parseFloat(valor) } : f);
        onChange(copia);
    };
    return (
        <div className="bg-white/80 dark:bg-gray-800/80 rounded-2xl p-6 border border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Calculator className="w-5 h-5 text-indigo-500" /><h3 className="font-bold text-gray-900 dark:text-white">{titulo}</h3></div>
                {podeEditar && (
                    <button onClick={() => onChange([...faixas, { ...novaLinha }])}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                        <Plus className="w-3.5 h-3.5" /> Faixa
                    </button>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <tr>{colunas.map(c => <th key={c} className="text-left px-3 py-2 font-bold uppercase text-xs">{c}</th>)}<th></th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {faixas.map((f, i) => (
                            <tr key={i}>
                                {camposNumericos.map((campo, ci) => (
                                    <td key={campo} className="px-3 py-2">
                                        <input type="number" step="0.01" disabled={!podeEditar}
                                            value={f[campo] ?? ''}
                                            placeholder={ci === 0 && f[campo] == null ? 'sem teto' : ''}
                                            onChange={e => atualizar(i, campo, e.target.value)}
                                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white disabled:opacity-60" />
                                    </td>
                                ))}
                                <td className="px-2">
                                    {podeEditar && (
                                        <button onClick={() => onChange(faixas.filter((_, idx) => idx !== i))} className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">Na última faixa, deixe "Até" vazio para representar "sem teto".</p>
        </div>
    );
}
