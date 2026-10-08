import React, { useState, useEffect } from 'react';
import { X, Search, Package, MapPin, Truck, ChevronRight, DollarSign, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { deliveryService } from './deliveryService';
import toast from 'react-hot-toast';

interface CreateDeliveryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
}

const CreateDeliveryModal: React.FC<CreateDeliveryModalProps> = ({ isOpen, onClose, onCreated }) => {
    console.log("CreateDeliveryModal: Renderizado! isOpen=", isOpen);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [vendas, setVendas] = useState<any[]>([]);
    const [motoristas, setMotoristas] = useState<any[]>([]);
    const [selectedVenda, setSelectedVenda] = useState<any>(null);
    const [form, setForm] = useState({
        endereco_cep: '',
        endereco_logradouro: '',
        endereco_numero: '',
        endereco_complemento: '',
        endereco_bairro: '',
        endereco_cidade: 'Guarulhos',
        endereco_estado: 'SP',
        endereco_referencia: '',
        motorista_id: '',
        taxa_entrega: 0,
        pagamento_tipo: 'loja', // loja ou entrega
        pagamento_status: 'pago',
        observacoes: ''
    });

    useEffect(() => {
        if (isOpen) {
            fetchVendas();
            fetchMotoristas();
            setStep(1);
            setSelectedVenda(null);
        }
    }, [isOpen]);

    const fetchMotoristas = async () => {
        try {
            const res = await deliveryService.getMotoristas(true);
            setMotoristas(res.motoristas || res.data || []);
        } catch (error) {
            console.error("Erro ao buscar motoristas", error);
        }
    };

    const fetchVendas = async () => {
        try {
            setLoading(true);
            const res = await deliveryService.getVendasPendentes();
            if (res.success) setVendas(res.vendas);
        } catch (error) {
            toast.error('Erro ao buscar vendas pendentes');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectVenda = (venda: any) => {
        setSelectedVenda(venda);
        setForm({
            ...form,
            endereco_cep: venda.cliente?.cep || '',
            endereco_logradouro: venda.cliente?.logradouro || '',
            endereco_numero: venda.cliente?.numero || '',
            endereco_bairro: venda.cliente?.bairro || '',
            endereco_cidade: venda.cliente?.cidade || 'Guarulhos',
            endereco_estado: venda.cliente?.estado || 'SP',
            pagamento_status: 'pago' // Assumindo pago se feito na loja
        });
        setStep(2);
    };

    const handleCepBlur = async () => {
        const cep = form.endereco_cep.replace(/\D/g, '');
        if (cep.length === 8) {
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    setForm(prev => ({
                        ...prev,
                        endereco_logradouro: data.logradouro || prev.endereco_logradouro,
                        endereco_bairro: data.bairro || prev.endereco_bairro,
                        endereco_cidade: data.localidade || prev.endereco_cidade,
                        endereco_estado: data.uf || prev.endereco_estado
                    }));
                    toast.success("Endereço preenchido automaticamente!");
                }
            } catch (error) {
                console.error("Erro ao buscar CEP", error);
            }
        }
    };


    const handleSubmit = async () => {
        try {
            setLoading(true);
            const payload = {
                venda_id: selectedVenda.id,
                ...form
            };
            // Se não selecionou motorista, manda null ou tira do objeto
            if (!payload.motorista_id) {
                delete (payload as any).motorista_id;
            } else {
                payload.motorista_id = Number(payload.motorista_id) as any;
            }

            const res = await deliveryService.criarEntrega(payload);
            if (res.success) {
                toast.success('Entrega criada com sucesso!');
                onCreated();
                onClose();
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Erro ao criar entrega');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
            >
                {/* Header */}
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Nova Entrega</h2>
                        <p className="text-sm text-gray-500">Passo {step} de 2: {step === 1 ? 'Selecionar Venda' : 'Detalhes Operacionais'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                    {step === 1 ? (
                        <div className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar por código da venda ou cliente..."
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                {loading ? (
                                    <div className="text-center py-12 text-gray-500 font-medium">Carregando vendas pendentes...</div>
                                ) : vendas.length > 0 ? (
                                    vendas.map((venda) => (
                                        <button
                                            key={venda.id}
                                            onClick={() => handleSelectVenda(venda)}
                                            className="w-full p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl flex items-center justify-between group hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/5 transition-all text-left"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                                                    <Package className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-900 dark:text-white text-lg">#{venda.codigo}</div>
                                                    <div className="text-sm text-gray-500 font-medium">{venda.cliente?.nome || 'Consumidor Final'} • R$ {venda.total.toFixed(2)}</div>
                                                    <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">{venda.itens.length} produtos</div>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                                        </button>
                                    ))
                                ) : (
                                    <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-800">
                                        <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                                        <p className="text-gray-500 font-medium">Nenhuma venda pendente encontrada</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 pb-4">
                            {/* Venda & Itens Info */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-between border-b border-blue-100 dark:border-blue-900/30">
                                    <div className="flex items-center gap-2">
                                        <Package className="w-4 h-4 text-blue-600" />
                                        <span className="font-bold text-blue-700 dark:text-blue-300 text-sm">Resumo do Pedido #{selectedVenda.codigo}</span>
                                    </div>
                                    <button onClick={() => setStep(1)} className="text-xs font-black text-blue-600 hover:underline uppercase tracking-widest">Trocar</button>
                                </div>
                                <div className="p-4 space-y-2">
                                    {selectedVenda.itens.map((item: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600 dark:text-gray-400 font-medium">{item.qtd}x {item.nome}</span>
                                            <span className="w-2 h-2 rounded-full bg-blue-400/30" />
                                        </div>
                                    ))}
                                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-between font-bold text-gray-900 dark:text-white">
                                        <span>Total do Carrinho</span>
                                        <span>R$ {selectedVenda.total.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Address Section */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                                    <MapPin className="w-5 h-5 text-blue-600" />
                                    <h3 className="font-bold">Endereço de Entrega</h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">CEP</label>
                                        <input
                                            type="text"
                                            value={form.endereco_cep}
                                            onChange={(e) => setForm({ ...form, endereco_cep: e.target.value })}
                                            onBlur={handleCepBlur}
                                            placeholder="00000-000"
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-4">
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Logradouro</label>
                                        <input
                                            type="text"
                                            value={form.endereco_logradouro}
                                            onChange={(e) => setForm({ ...form, endereco_logradouro: e.target.value })}
                                            placeholder="Rua, Avenida..."
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Número</label>
                                        <input
                                            type="text"
                                            value={form.endereco_numero}
                                            onChange={(e) => setForm({ ...form, endereco_numero: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Bairro</label>
                                        <input
                                            type="text"
                                            value={form.endereco_bairro}
                                            onChange={(e) => setForm({ ...form, endereco_bairro: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Referência</label>
                                        <input
                                            type="text"
                                            value={form.endereco_referencia}
                                            onChange={(e) => setForm({ ...form, endereco_referencia: e.target.value })}
                                            placeholder="Ex: Perto do posto..."
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Operação Section */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                                    <Truck className="w-5 h-5 text-blue-600" />
                                    <h3 className="font-bold">Despacho & Operação</h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Motorista (Opcional)</label>
                                        <select
                                            value={form.motorista_id}
                                            onChange={(e) => setForm({ ...form, motorista_id: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer text-gray-900 dark:text-white"
                                        >
                                            <option value="">Deixar pendente...</option>
                                            {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Taxa de Entrega (R$)</label>
                                        <input
                                            type="number"
                                            value={form.taxa_entrega}
                                            onChange={(e) => setForm({ ...form, taxa_entrega: parseFloat(e.target.value) })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-blue-600"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Financial Section */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                                    <DollarSign className="w-5 h-5 text-blue-600" />
                                    <h3 className="font-bold">Pagamento</h3>
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1.5">Forma de Cobrança</label>
                                        <select
                                            value={form.pagamento_tipo}
                                            onChange={(e) => setForm({ ...form, pagamento_tipo: e.target.value, pagamento_status: e.target.value === 'loja' ? 'pago' : 'pendente' })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer text-gray-900 dark:text-white"
                                        >
                                            <option value="loja">Já Pago na Loja/App</option>
                                            <option value="entrega">Pagar no Momento da Entrega</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Observations */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                    <h3 className="font-bold">Observações Internas</h3>
                                </div>
                                <textarea
                                    value={form.observacoes}
                                    onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    placeholder="Instruções para o entregador, fragilidade, etc..."
                                    rows={3}
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                    >
                        Cancelar
                    </button>
                    {step === 2 && (
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 group"
                        >
                            {loading ? 'Processando...' : 'Confirmar Envio'}
                            <Truck className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </button>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default CreateDeliveryModal;
