import { ProtectedDocumentLink } from '@/components/common/ProtectedDocumentLink';
import React, { useState, useEffect } from 'react';
import {
    Users,
    Truck,
    Plus,
    Check,
    X,
    Star,
    ShieldCheck,
    User,
    Hash,
    Smartphone,
    Upload,
    ClipboardCheck,
    AlertTriangle,
    IdCard,
    Pencil,
    FileText,
} from 'lucide-react';
import { deliveryService, Motorista, Veiculo, CreateMotoristaData, CreateVeiculoData } from './deliveryService';
import ChecklistModal from './ChecklistModal';
import ConformidadeModal from './ConformidadeModal';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const motoristaVazio: CreateMotoristaData = {
    nome: '', cpf: '', rg: '', cnh: '', categoria_cnh: 'B', validade_cnh: '',
    telefone: '', celular: '', email: '', tipo_vinculo: 'terceirizado', percentual_comissao: 10,
};

const veiculoVazio: CreateVeiculoData = {
    placa: '', renavam: '', modelo: '', ano: new Date().getFullYear(), tipo: 'carro', cor: '',
    consumo_medio: 10, data_vencimento_licenciamento: '', data_vencimento_seguro: '',
};

/** Badge de vencimento (CNH, licenciamento, seguro) — vermelho vencido, âmbar perto de vencer. */
function BadgeVencimento({ label, dias, vencido }: { label: string; dias?: number | null; vencido?: boolean }) {
    if (dias == null) return null;
    if (vencido) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-black uppercase"><AlertTriangle className="w-3 h-3" /> {label} vencida</span>;
    }
    if (dias <= 30) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase">{label} vence em {dias}d</span>;
    }
    return null;
}

const DriverManagement: React.FC = () => {
    const [motoristas, setMotoristas] = useState<Motorista[]>([]);
    const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
    const [loading, setLoading] = useState(true);

    const [isMotoristaModalOpen, setIsMotoristaModalOpen] = useState(false);
    const [isVeiculoModalOpen, setIsVeiculoModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [checklistVeiculo, setChecklistVeiculo] = useState<Veiculo | null>(null);
    const [conformidadeAberta, setConformidadeAberta] = useState(false);

    // null = cadastrando novo; id = editando um já existente (permite anexar
    // documento a motorista/veículo cadastrado antes desta funcionalidade existir)
    const [editandoMotoristaId, setEditandoMotoristaId] = useState<number | null>(null);
    const [editandoVeiculoId, setEditandoVeiculoId] = useState<number | null>(null);

    const [newMotorista, setNewMotorista] = useState<CreateMotoristaData>(motoristaVazio);
    const [cnhArquivo, setCnhArquivo] = useState<File | null>(null);
    const [newVeiculo, setNewVeiculo] = useState<CreateVeiculoData>(veiculoVazio);
    const [crlvArquivo, setCrlvArquivo] = useState<File | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [motRes, veiRes] = await Promise.all([
                deliveryService.getMotoristas(false), // Buscar todos p/ gestão
                deliveryService.getVeiculos()
            ]);
            if (motRes.success) setMotoristas(motRes.motoristas);
            if (veiRes.success) setVeiculos(veiRes.veiculos);
        } catch (error) {
            toast.error('Erro ao carregar frota');
        } finally {
            setLoading(false);
        }
    };

    const abrirNovoMotorista = () => {
        setEditandoMotoristaId(null);
        setNewMotorista(motoristaVazio);
        setCnhArquivo(null);
        setIsMotoristaModalOpen(true);
    };

    const abrirEdicaoMotorista = (m: Motorista) => {
        setEditandoMotoristaId(m.id);
        setNewMotorista({
            nome: m.nome, cpf: m.cpf, rg: m.rg || '', cnh: m.cnh || '',
            categoria_cnh: m.categoria_cnh || 'B', validade_cnh: m.validade_cnh || '',
            telefone: m.telefone || '', celular: m.celular || '', email: m.email || '',
            tipo_vinculo: m.tipo_vinculo || 'terceirizado', percentual_comissao: m.percentual_comissao ?? 10,
        });
        setCnhArquivo(null);
        setIsMotoristaModalOpen(true);
    };

    const handleAddMotorista = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            const res = editandoMotoristaId
                ? await deliveryService.atualizarMotorista(editandoMotoristaId, newMotorista)
                : await deliveryService.criarMotorista(newMotorista);
            if (res.success) {
                const motoristaId = res.motorista.id;
                if (cnhArquivo) {
                    try { await deliveryService.uploadDocumentoMotorista(motoristaId, cnhArquivo); }
                    catch (e: any) { toast.error(e?.response?.data?.error || 'Motorista salvo, mas o upload da CNH falhou.'); }
                }
                toast.success(editandoMotoristaId ? 'Motorista atualizado!' : 'Motorista cadastrado com sucesso!');
                setIsMotoristaModalOpen(false);
                setEditandoMotoristaId(null);
                setNewMotorista(motoristaVazio);
                setCnhArquivo(null);
                fetchData();
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao salvar motorista');
        } finally {
            setSubmitting(false);
        }
    };

    const fecharModalMotorista = () => {
        setIsMotoristaModalOpen(false);
        setEditandoMotoristaId(null);
        setCnhArquivo(null);
    };

    const fecharModalVeiculo = () => {
        setIsVeiculoModalOpen(false);
        setEditandoVeiculoId(null);
        setCrlvArquivo(null);
    };

    const abrirNovoVeiculo = () => {
        setEditandoVeiculoId(null);
        setNewVeiculo(veiculoVazio);
        setCrlvArquivo(null);
        setIsVeiculoModalOpen(true);
    };

    const abrirEdicaoVeiculo = (v: Veiculo) => {
        setEditandoVeiculoId(v.id);
        setNewVeiculo({
            placa: v.placa, renavam: v.renavam || '', modelo: v.modelo, ano: v.ano || new Date().getFullYear(),
            tipo: v.tipo, cor: '', consumo_medio: v.consumo_medio || 10,
            data_vencimento_licenciamento: v.data_vencimento_licenciamento || '',
            data_vencimento_seguro: v.data_vencimento_seguro || '',
        });
        setCrlvArquivo(null);
        setIsVeiculoModalOpen(true);
    };

    const handleAddVeiculo = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            const res = editandoVeiculoId
                ? await deliveryService.atualizarVeiculo(editandoVeiculoId, newVeiculo)
                : await deliveryService.criarVeiculo(newVeiculo);
            if (res.success) {
                const veiculoId = res.veiculo.id;
                if (crlvArquivo) {
                    try { await deliveryService.uploadDocumentoVeiculo(veiculoId, crlvArquivo); }
                    catch (e: any) { toast.error(e?.response?.data?.error || 'Veículo salvo, mas o upload do CRLV falhou.'); }
                }
                toast.success(editandoVeiculoId ? 'Veículo atualizado!' : 'Veículo cadastrado com sucesso!');
                setIsVeiculoModalOpen(false);
                setEditandoVeiculoId(null);
                setNewVeiculo(veiculoVazio);
                setCrlvArquivo(null);
                fetchData();
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao salvar veículo');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6 space-y-8 max-w-[1600px] mx-auto">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Motoristas Section */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
                                <Users className="w-6 h-6" />
                            </div>
                            <h2 className="text-xl font-bold dark:text-white">Motoristas Parceiros</h2>
                        </div>
                        <button
                            onClick={abrirNovoMotorista}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
                        >
                            <Plus className="w-4 h-4" /> Novo Motorista
                        </button>
                    </div>

                    <div className="grid gap-4">
                        {loading ? (
                            Array(3).fill(0).map((_, i) => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />)
                        ) : motoristas.length === 0 ? (
                            <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-3xl text-gray-400">
                                Nenhum motorista cadastrado ainda.
                            </div>
                        ) : motoristas.map((m) => (
                            <motion.div
                                key={m.id}
                                whileHover={{ scale: 1.01 }}
                                className="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center relative">
                                            <User className="w-8 h-8 text-gray-400" />
                                            {m.disponivel && (
                                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
                                            )}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-gray-900 dark:text-white">{m.nome}</h4>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="flex items-center text-xs text-amber-500 font-bold">
                                                    <Star className="w-3 h-3 mr-1 fill-current" /> {m.avaliacao_media || '5.0'}
                                                </span>
                                                <span className="text-xs text-gray-400 flex items-center">
                                                    <Truck className="w-3 h-3 mr-1" /> {m.total_entregas} entregas
                                                </span>
                                                {m.categoria_cnh && (
                                                    <span className="text-xs text-gray-400 flex items-center">
                                                        <IdCard className="w-3 h-3 mr-1" /> CNH {m.categoria_cnh}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {m.cnh_documento_url && (
                                            <ProtectedDocumentLink url={m.cnh_documento_url}
                                                className="p-2 hover:bg-gray-50 dark:hover:bg-gray-900 rounded-xl text-gray-400 transition-colors" title="Ver documento da CNH">
                                                <FileText className="w-5 h-5" />
                                            </ProtectedDocumentLink>
                                        )}
                                        <button onClick={() => abrirEdicaoMotorista(m)}
                                            className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl text-indigo-500 transition-colors" title="Editar / anexar CNH">
                                            <Pencil className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <BadgeVencimento label="CNH" dias={m.cnh_dias_para_vencer} vencido={m.cnh_vencida} />
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Veículos Section */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white">
                                <Truck className="w-6 h-6" />
                            </div>
                            <h2 className="text-xl font-bold dark:text-white">Frota de Veículos</h2>
                        </div>
                        <button
                            onClick={abrirNovoVeiculo}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                        >
                            <Plus className="w-4 h-4" /> Novo Veículo
                        </button>
                    </div>

                    <div className="grid gap-4">
                        {loading ? (
                            Array(3).fill(0).map((_, i) => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />)
                        ) : veiculos.length === 0 ? (
                            <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-3xl text-gray-400">
                                Nenhum veículo cadastrado na frota.
                            </div>
                        ) : veiculos.map((v) => (
                            <div
                                key={v.id}
                                className="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600">
                                            <Truck className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-bold text-gray-900 dark:text-white uppercase">{v.placa}</h4>
                                                <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded text-[10px] font-black text-gray-500">{v.tipo}</span>
                                            </div>
                                            <p className="text-sm text-gray-500 mt-1">{v.modelo}{v.renavam ? ` · RENAVAM ${v.renavam}` : ''}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {v.crlv_documento_url && (
                                            <ProtectedDocumentLink url={v.crlv_documento_url}
                                                className="p-2 hover:bg-gray-50 dark:hover:bg-gray-900 rounded-xl text-gray-400 transition-colors" title="Ver documento do CRLV">
                                                <FileText className="w-5 h-5" />
                                            </ProtectedDocumentLink>
                                        )}
                                        <button onClick={() => setChecklistVeiculo(v)}
                                            className="p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl text-emerald-600 transition-colors" title="Fazer checklist de saída">
                                            <ClipboardCheck className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => abrirEdicaoVeiculo(v)}
                                            className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl text-indigo-500 transition-colors" title="Editar / anexar CRLV">
                                            <Pencil className="w-5 h-5" />
                                        </button>
                                        <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${v.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            {v.ativo ? <Check className="w-3 h-3 mr-1" /> : <X className="w-3 h-3 mr-1" />}
                                            {v.ativo ? 'Operante' : 'Manutenção'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                    <BadgeVencimento label="Licenciamento" dias={v.licenciamento_dias_para_vencer} vencido={v.licenciamento_vencido} />
                                    <BadgeVencimento label="Seguro" dias={v.seguro_dias_para_vencer} vencido={v.seguro_vencido} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Modais com AnimatePresence */}
            <AnimatePresence>
                {isMotoristaModalOpen && (
                    <div className="fixed inset-0 z-100 flex items-center justify-center p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={fecharModalMotorista}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden max-h-[92vh] overflow-y-auto"
                        >
                            <form onSubmit={handleAddMotorista} className="p-8 space-y-6">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-2xl font-black dark:text-white">{editandoMotoristaId ? 'Editar Motorista' : 'Cadastrar Motorista'}</h3>
                                    <button type="button" onClick={fecharModalMotorista} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full">
                                        <X className="w-6 h-6 text-gray-400" />
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Nome Completo</label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                required value={newMotorista.nome} onChange={e => setNewMotorista({ ...newMotorista, nome: e.target.value })}
                                                className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">CPF</label>
                                        <div className="relative">
                                            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                required value={newMotorista.cpf} onChange={e => setNewMotorista({ ...newMotorista, cpf: e.target.value })}
                                                className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">RG</label>
                                        <input
                                            value={newMotorista.rg} onChange={e => setNewMotorista({ ...newMotorista, rg: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Número da CNH</label>
                                        <input
                                            required value={newMotorista.cnh} onChange={e => setNewMotorista({ ...newMotorista, cnh: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Categoria CNH</label>
                                        <select
                                            value={newMotorista.categoria_cnh} onChange={e => setNewMotorista({ ...newMotorista, categoria_cnh: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                        >
                                            {['A', 'B', 'AB', 'C', 'D', 'E'].map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Validade da CNH</label>
                                        <input
                                            type="date" value={newMotorista.validade_cnh}
                                            onChange={e => setNewMotorista({ ...newMotorista, validade_cnh: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Celular</label>
                                        <div className="relative">
                                            <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                value={newMotorista.celular} onChange={e => setNewMotorista({ ...newMotorista, celular: e.target.value })}
                                                className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">% Comissão</label>
                                        <input
                                            type="number" step="0.1" value={newMotorista.percentual_comissao}
                                            onChange={e => setNewMotorista({ ...newMotorista, percentual_comissao: Number(e.target.value) })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-indigo-500 transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase ml-1">Upload da CNH (PDF, JPG ou PNG)</label>
                                    <label className="flex items-center gap-2 cursor-pointer w-full px-4 py-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                                        <Upload className="w-4 h-4" /> {cnhArquivo ? cnhArquivo.name : 'Selecionar arquivo…'}
                                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setCnhArquivo(e.target.files?.[0] || null)} />
                                    </label>
                                </div>

                                <button
                                    disabled={submitting}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-xl shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {submitting ? 'Salvando...' : editandoMotoristaId ? 'Salvar Alterações' : 'Finalizar Cadastro'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}

                {isVeiculoModalOpen && (
                    <div className="fixed inset-0 z-100 flex items-center justify-center p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={fecharModalVeiculo}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white dark:bg-gray-900 w-full max-w-md rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden max-h-[92vh] overflow-y-auto"
                        >
                            <form onSubmit={handleAddVeiculo} className="p-8 space-y-6">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-2xl font-black dark:text-white">{editandoVeiculoId ? 'Editar Veículo' : 'Novo Veículo'}</h3>
                                    <button type="button" onClick={fecharModalVeiculo} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full">
                                        <X className="w-6 h-6 text-gray-400" />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">Placa (Ex: ABC1D23)</label>
                                            <input
                                                required maxLength={8} value={newVeiculo.placa}
                                                onChange={e => setNewVeiculo({ ...newVeiculo, placa: e.target.value.toUpperCase() })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">RENAVAM</label>
                                            <input
                                                value={newVeiculo.renavam} onChange={e => setNewVeiculo({ ...newVeiculo, renavam: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Modelo / Marca</label>
                                        <input
                                            required value={newVeiculo.modelo}
                                            onChange={e => setNewVeiculo({ ...newVeiculo, modelo: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">Tipo</label>
                                            <select
                                                value={newVeiculo.tipo} onChange={e => setNewVeiculo({ ...newVeiculo, tipo: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            >
                                                <option value="moto">Moto</option>
                                                <option value="carro">Carro</option>
                                                <option value="van">Van</option>
                                                <option value="caminhao">Caminhão</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">Ano</label>
                                            <input
                                                type="number" value={newVeiculo.ano}
                                                onChange={e => setNewVeiculo({ ...newVeiculo, ano: Number(e.target.value) })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">Vencimento Licenciamento</label>
                                            <input
                                                type="date" value={newVeiculo.data_vencimento_licenciamento}
                                                onChange={e => setNewVeiculo({ ...newVeiculo, data_vencimento_licenciamento: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase ml-1">Vencimento Seguro</label>
                                            <input
                                                type="date" value={newVeiculo.data_vencimento_seguro}
                                                onChange={e => setNewVeiculo({ ...newVeiculo, data_vencimento_seguro: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-2xl focus:ring-2 ring-emerald-500 transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase ml-1">Upload do CRLV (PDF, JPG ou PNG)</label>
                                        <label className="flex items-center gap-2 cursor-pointer w-full px-4 py-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                                            <Upload className="w-4 h-4" /> {crlvArquivo ? crlvArquivo.name : 'Selecionar arquivo…'}
                                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setCrlvArquivo(e.target.files?.[0] || null)} />
                                        </label>
                                    </div>
                                </div>

                                <button
                                    disabled={submitting}
                                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {submitting ? 'Salvando...' : editandoVeiculoId ? 'Salvar Alterações' : 'Confirmar Veículo'}
                                </button>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <ChecklistModal veiculo={checklistVeiculo} onClose={() => { setChecklistVeiculo(null); fetchData(); }} />
            <ConformidadeModal open={conformidadeAberta} onClose={() => setConformidadeAberta(false)} />

            {/* Banner Informativo */}
            <div className="bg-white dark:bg-gray-800 p-8 rounded-4xl border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row items-center justify-between gap-8 mt-12 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                <div className="space-y-4 relative z-10">
                    <div className="flex items-center gap-2 text-indigo-600 font-black text-xs uppercase tracking-[0.2em]">
                        <ShieldCheck className="w-4 h-4" /> Segurança Logística
                    </div>
                    <h3 className="text-2xl font-bold dark:text-white">Conformidade Total</h3>
                    <p className="text-gray-500 max-w-xl">
                        Todos os seus motoristas passam por verificação automática de CNH.
                        O sistema alerta sobre vencimentos de licenciamento e revisões preventivas da frota.
                    </p>
                </div>
                <button onClick={() => setConformidadeAberta(true)} className="px-8 py-4 bg-gray-900 dark:bg-white dark:text-gray-950 text-white font-bold rounded-2xl hover:bg-gray-800 transition-all relative z-10 shadow-xl active:scale-95">
                    Relatório de Conformidade
                </button>
            </div>
        </div>
    );
};

export default DriverManagement;
