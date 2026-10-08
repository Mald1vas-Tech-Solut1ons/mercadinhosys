import React, { useState, useEffect } from 'react';
import { X, Search, Package, MapPin, User, Truck, ChevronRight, DollarSign, Plus, Minus, Trash2, Camera, Barcode } from 'lucide-react';
import { motion } from 'framer-motion';
import { deliveryService, Motorista, Veiculo } from './deliveryService';
import { productsService } from '../products/productsService';
import { customerService } from '../customers/customerService';
import toast from 'react-hot-toast';
import MultiPaymentManager, { PagamentoItem } from '../pdv/components/MultiPaymentManager';
import { FormaPagamentoPDV } from '../pdv/pdvService';
import BarcodeScanner from '../pdv/components/BarcodeScanner';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
    initialCart?: any[];
    initialCustomer?: any;
    initialPagamentos?: PagamentoItem[];
}

const UnifiedDeliverySaleModal: React.FC<Props> = ({ isOpen, onClose, onCreated, initialCart = [], initialCustomer = null, initialPagamentos = [] }) => {
    console.log("UnifiedDeliverySaleModal: Renderizado! isOpen=", isOpen);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Data for lookups
    const [allProducts, setAllProducts] = useState<any[]>([]);
    const [allCustomers, setAllCustomers] = useState<any[]>([]);
    const [motoristas, setMotoristas] = useState<Motorista[]>([]);
    const [veiculos, setVeiculos] = useState<Veiculo[]>([]);

    // Search states
    const [prodSearch, setProdSearch] = useState('');
    const [custSearch, setCustSearch] = useState('');
    const [scannerAberto, setScannerAberto] = useState(false);

    // Form state
    const [selectedCustomer, setSelectedCustomer] = useState<any>(initialCustomer);
    const [cart, setCart] = useState<any[]>(initialCart);
    const [logistics, setLogistics] = useState({
        motorista_id: '',
        veiculo_id: '',
        taxa_entrega: 0,
        distancia_km: 5,
        endereco_cep: initialCustomer?.cep || '',
        endereco_logradouro: initialCustomer?.endereco || '',
        endereco_numero: initialCustomer?.numero || '',
        endereco_bairro: initialCustomer?.bairro || '',
        endereco_referencia: '',
        observacoes: ''
    });

    const [pagamentosDelivery, setPagamentosDelivery] = useState<PagamentoItem[]>(initialPagamentos);
    const [cobrarTaxa, setCobrarTaxa] = useState(false);
    const [pagamentoNaEntrega, setPagamentoNaEntrega] = useState(initialPagamentos.length === 0);
    const formasDisponiveis: FormaPagamentoPDV[] = [
        { tipo: 'dinheiro', label: 'Dinheiro', taxa: 0, permite_troco: true },
        { tipo: 'pix', label: 'PIX', taxa: 0, permite_troco: false },
        { tipo: 'cartao_credito', label: 'C. Crédito', taxa: 0, permite_troco: false },
        { tipo: 'cartao_debito', label: 'C. Débito', taxa: 0, permite_troco: false },
        { tipo: 'fiado', label: 'Fiado', taxa: 0, permite_troco: false },
    ];

    useEffect(() => {
        if (isOpen) {
            loadInitialData();
            resetForm();
        }
    }, [isOpen]);

    const loadInitialData = async () => {
        try {
            const [custs, mots, veics] = await Promise.all([
                customerService.list(),
                deliveryService.getMotoristas(),
                deliveryService.getVeiculos()
            ]);
            setAllCustomers(custs || []);
            setMotoristas(mots.motoristas || []);
            setVeiculos(veics.veiculos || []);
        } catch (error) {
            toast.error("Erro ao carregar dados auxiliares");
        }
    };

    const resetForm = () => {
        setStep(1);
        setSelectedCustomer(initialCustomer);
        setCart(initialCart);
        setLogistics({
            motorista_id: '', veiculo_id: '', taxa_entrega: 0,
            distancia_km: 5,
            endereco_cep: initialCustomer?.cep || '', 
            endereco_logradouro: initialCustomer?.endereco || '', 
            endereco_numero: initialCustomer?.numero || '',
            endereco_bairro: initialCustomer?.bairro || '', 
            endereco_referencia: '', observacoes: ''
        });
        setPagamentosDelivery(initialPagamentos);
        setPagamentoNaEntrega(initialPagamentos.length === 0);
        setCobrarTaxa(false);
    };

    const addToCart = (product: any) => {
        const exists = cart.find(item => item.produto_id === product.id);
        if (exists) {
            setCart(cart.map(item => item.produto_id === product.id ? { ...item, quantidade: item.quantidade + 1, total_item: (item.quantidade + 1) * item.preco_unitario } : item));
        } else {
            setCart([...cart, {
                produto_id: product.id,
                nome: product.nome,
                quantidade: 1,
                preco_unitario: product.preco_venda,
                total_item: product.preco_venda
            }]);
        }
        toast.success(`${product.nome} adicionado`);
    };

    const removeFromCart = (id: number) => setCart(cart.filter(i => i.produto_id !== id));

    const updateQty = (id: number, delta: number) => {
        setCart(cart.map(item => {
            if (item.produto_id === id) {
                const newQty = Math.max(1, item.quantidade + delta);
                return { ...item, quantidade: newQty, total_item: newQty * item.preco_unitario };
            }
            return item;
        }));
    };

    const calculateTotal = () => cart.reduce((acc, curr) => acc + curr.total_item, 0) + (cobrarTaxa ? logistics.taxa_entrega : 0);

    const handleSubmit = async () => {
        if (cart.length === 0) return toast.error("Adicione itens ao carrinho");
        if (!logistics.motorista_id || !logistics.veiculo_id) return toast.error("Selecione motorista e veículo");

        const totalVenda = calculateTotal();
        const totalPago = pagamentosDelivery.reduce((sum, p) => sum + p.valor, 0);

        if (!pagamentoNaEntrega && totalPago < (totalVenda - 0.01)) {
            return toast.error(`Valor pago insuficiente (R$ ${totalPago.toFixed(2)}). Faltam R$ ${(totalVenda - totalPago).toFixed(2)}`);
        }

        try {
            setLoading(true);
            const taxa = cobrarTaxa ? logistics.taxa_entrega : 0;
            const payload = {
                cliente_id: selectedCustomer?.id,
                itens: cart,
                subtotal: totalVenda - taxa,
                total: totalVenda,
                pagamentos: pagamentoNaEntrega 
                    ? [{ forma_pagamento: "entrega", valor: totalVenda }]
                    : pagamentosDelivery.map(p => ({
                        forma_pagamento: p.forma,
                        valor: p.valor,
                        bandeira: p.bandeira
                    })),
                ...logistics,
                taxa_entrega: taxa
            };
            const res = await deliveryService.criarVendaEntrega(payload);
            if (res.success) {
                toast.success(`Venda #${res.codigo} criada com sucesso!`);
                onCreated();
                onClose();
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Erro ao processar venda");
        } finally {
            setLoading(false);
        }
    };

    const handleCepBlur = async () => {
        const cep = logistics.endereco_cep.replace(/\D/g, '');
        if (cep.length === 8) {
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    setLogistics(prev => ({
                        ...prev,
                        endereco_logradouro: data.logradouro || prev.endereco_logradouro,
                        endereco_bairro: data.bairro || prev.endereco_bairro,
                    }));
                    toast.success("Endereço preenchido automaticamente!");
                }
            } catch (error) {
                console.error("Erro ao buscar CEP", error);
            }
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const delayDebounceFn = setTimeout(async () => {
            if (prodSearch.trim().length >= 2) {
                try {
                    const prods = await productsService.search(prodSearch.trim());
                    setAllProducts(prods || []);
                } catch (error) {
                    console.error("Erro na busca de produtos:", error);
                }
            } else {
                setAllProducts([]);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [prodSearch, isOpen]);

    if (!isOpen) return null;

    const filteredProds = allProducts.filter(p => 
        p.nome?.toLowerCase().includes(prodSearch?.toLowerCase() || '') ||
        p.codigo_barras?.toLowerCase().includes(prodSearch?.toLowerCase() || '')
    );
    const filteredCusts = allCustomers.filter(c => c.nome?.toLowerCase().includes(custSearch?.toLowerCase() || ''));

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />

            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] border border-white/10"
            >
                {/* Header Profissional */}
                <div className="p-8 bg-linear-to-r from-blue-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white/10 rounded-xl backdrop-blur-sm">
                                <Truck className="w-6 h-6" />
                            </div>
                            <h2 className="text-2xl font-black tracking-tight uppercase">Venda Entrega <span className="text-blue-200">Express</span></h2>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                            <span className={`text-xs font-bold px-3 py-1 rounded-full ${step === 1 ? 'bg-white text-blue-700' : 'bg-white/20 text-white'}`}>1. Carrinho</span>
                            <ChevronRight className="w-3 h-3 opacity-50" />
                            <span className={`text-xs font-bold px-3 py-1 rounded-full ${step === 2 ? 'bg-white text-blue-700' : 'bg-white/20 text-white'}`}>2. Logística</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-full transition-all active:scale-90">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                    {/* Lado Esquerdo: Seleção ou Resumo */}
                    <div className="flex-1 p-8 overflow-y-auto custom-scrollbar border-r border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-black/20">
                        {step === 1 ? (
                            <div className="space-y-8">
                                {/* Busca Cliente */}
                                <section>
                                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <User className="w-4 h-4" /> Cliente Responsável
                                    </h3>
                                    <div className="relative group">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                        <input
                                            type="text"
                                            placeholder="Buscar cliente por nome ou CPF..."
                                            value={custSearch}
                                            onChange={(e) => setCustSearch(e.target.value)}
                                            className="w-full pl-12 pr-4 py-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                                        />
                                        {custSearch && (
                                            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-20 max-h-48 overflow-y-auto">
                                                {filteredCusts.map(c => (
                                                    <button
                                                        key={c.id}
                                                        onClick={() => { setSelectedCustomer(c); setCustSearch(''); setLogistics({ ...logistics, endereco_cep: c.cep, endereco_logradouro: c.logradouro, endereco_numero: c.numero, endereco_bairro: c.bairro }); }}
                                                        className="w-full p-4 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-50 dark:border-gray-800 last:border-0"
                                                    >
                                                        <p className="font-bold text-gray-900 dark:text-white">{c.nome}</p>
                                                        <p className="text-xs text-gray-500">{c.cpf || 'Sem CPF'} • {c.celular || 'Sem celular'}</p>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {selectedCustomer && (
                                        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 flex items-center justify-between">
                                            <div>
                                                <p className="font-black text-blue-900 dark:text-blue-100 tracking-tight">{selectedCustomer.nome}</p>
                                                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{selectedCustomer.endereco || 'Endereço vinculado'}</p>
                                            </div>
                                            <button onClick={() => setSelectedCustomer(null)} className="text-xs font-bold text-red-500 hover:underline">Remover</button>
                                        </div>
                                    )}
                                </section>

                                {/* Adicionar Produtos */}
                                <section>
                                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <Package className="w-4 h-4" /> Itens do Pedido
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setScannerAberto(true)}
                                            title="Escanear código de barras"
                                            className="p-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow shrink-0"
                                        >
                                            <Camera className="w-5 h-5" />
                                        </button>
                                        <div className="relative group flex-1">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                            <input
                                                type="text"
                                                placeholder="Buscar produtos pelo nome ou código de barras..."
                                                value={prodSearch}
                                                onChange={(e) => setProdSearch(e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                                            />
                                            {prodSearch && (
                                                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-20 max-h-64 overflow-y-auto">
                                                    {filteredProds.map(p => (
                                                        <button
                                                            key={p.id}
                                                            onClick={() => { addToCart(p); setProdSearch(''); }}
                                                            className="w-full p-4 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-50 dark:border-gray-800 last:border-0 flex items-center justify-between"
                                                        >
                                                            <div>
                                                                <p className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                                    {p.nome}
                                                                    {p.codigo_barras && (
                                                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">{p.codigo_barras}</span>
                                                                    )}
                                                                </p>
                                                                <p className="text-xs text-gray-500">Estoque: {p.estoque_atual} • R$ {p.preco_venda.toFixed(2)}</p>
                                                            </div>
                                                            <Plus className="w-5 h-5 text-blue-500" />
                                                        </button>
                                                    ))}
                                                    {/* Diferente da compra: numa VENDA não dá pra vender o que não
                                                        está cadastrado — sem fallback COSMOS aqui, só orienta. */}
                                                    {filteredProds.length === 0 && (
                                                        <div className="p-4 flex items-center gap-2 text-sm text-gray-500">
                                                            <Barcode className="w-4 h-4 shrink-0" />
                                                            <span>Nenhum produto encontrado. Cadastre o produto em Produtos antes de vendê-lo.</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        ) : (
                            /* Passo 2: Detalhes Logísticos */
                            <div className="space-y-8">
                                <section className="grid grid-cols-1 md:grid-cols-2 gap-6 font-bold">
                                    <div>
                                        <label className="text-[10px] uppercase text-gray-400 tracking-widest block mb-2">Motorista Escolhido</label>
                                        <select
                                            value={logistics.motorista_id}
                                            onChange={(e) => setLogistics({ ...logistics, motorista_id: e.target.value })}
                                            className="w-full p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Selecione o Entregador</option>
                                            {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase text-gray-400 tracking-widest block mb-2">Veículo da Entrega</label>
                                        <select
                                            value={logistics.veiculo_id}
                                            onChange={(e) => setLogistics({ ...logistics, veiculo_id: e.target.value })}
                                            className="w-full p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Selecione o Veículo</option>
                                            {veiculos.map(v => <option key={v.id} value={v.id}>{v.placa} - {v.modelo} ({v.tipo})</option>)}
                                        </select>
                                    </div>
                                </section>

                                <section>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                            <DollarSign className="w-4 h-4" /> Pagamento Delivery
                                        </h3>
                                        
                                        <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm">
                                            <input 
                                                type="checkbox" 
                                                checked={pagamentoNaEntrega}
                                                onChange={(e) => setPagamentoNaEntrega(e.target.checked)}
                                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                            />
                                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                                Pagar na Entrega
                                            </span>
                                        </label>
                                    </div>
                                    {!pagamentoNaEntrega ? (
                                        <div className="bg-white dark:bg-gray-800 p-6 rounded-4xl border border-gray-100 dark:border-gray-700">
                                            <MultiPaymentManager
                                                totalVenda={calculateTotal()}
                                                formasDisponiveis={formasDisponiveis}
                                                pagamentosatuais={pagamentosDelivery}
                                                onAdicionar={(forma, valor, bandeira) => {
                                                    const novo = { id: Date.now().toString(), forma, valor, bandeira };
                                                    setPagamentosDelivery([...pagamentosDelivery, novo]);
                                                }}
                                                onRemover={(id) => setPagamentosDelivery(pagamentosDelivery.filter(p => p.id !== id))}
                                            />
                                        </div>
                                    ) : (
                                        <div className="bg-orange-50 dark:bg-orange-900/10 p-6 rounded-4xl border border-orange-200 dark:border-orange-800/30 flex items-center justify-center">
                                            <p className="text-sm font-bold text-orange-600 dark:text-orange-400 text-center">
                                                O motorista fará a cobrança no momento da entrega.
                                            </p>
                                        </div>
                                    )}
                                </section>

                                <section>
                                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <MapPin className="w-4 h-4" /> Dados de Destino
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                                        <input
                                            placeholder="CEP"
                                            className="md:col-span-2 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none"
                                            value={logistics.endereco_cep}
                                            onChange={(e) => setLogistics({ ...logistics, endereco_cep: e.target.value })}
                                            onBlur={handleCepBlur}
                                        />
                                        <input
                                            placeholder="Logradouro"
                                            className="md:col-span-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none"
                                            value={logistics.endereco_logradouro}
                                            onChange={(e) => setLogistics({ ...logistics, endereco_logradouro: e.target.value })}
                                        />
                                        <input
                                            placeholder="Nº"
                                            className="md:col-span-1 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none"
                                            value={logistics.endereco_numero}
                                            onChange={(e) => setLogistics({ ...logistics, endereco_numero: e.target.value })}
                                        />
                                        <input
                                            placeholder="Bairro"
                                            className="md:col-span-2 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl outline-none"
                                            value={logistics.endereco_bairro}
                                            onChange={(e) => setLogistics({ ...logistics, endereco_bairro: e.target.value })}
                                        />
                                        <div className="md:col-span-3 flex flex-col justify-end">
                                            <label className="flex items-center gap-2 cursor-pointer mb-2 ml-1">
                                                <input 
                                                    type="checkbox" 
                                                    checked={cobrarTaxa}
                                                    onChange={(e) => setCobrarTaxa(e.target.checked)}
                                                    className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                                />
                                                <span className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Cobrar Taxa?</span>
                                            </label>
                                            {cobrarTaxa && (
                                                <input
                                                    placeholder="Taxa (R$)"
                                                    type="number"
                                                    className="w-full p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900 text-blue-600 font-black rounded-2xl outline-none"
                                                    value={logistics.taxa_entrega}
                                                    onChange={(e) => setLogistics({ ...logistics, taxa_entrega: parseFloat(e.target.value) || 0 })}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>

                    {/* Lado Direito: Carrinho e Ações */}
                    <div className="w-full md:w-96 p-8 flex flex-col bg-white dark:bg-gray-900 border-t md:border-t-0 border-gray-100 dark:border-gray-800">
                        <div className="flex-1 overflow-y-auto space-y-4 mb-8">
                            <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2">
                                <DollarSign className="w-5 h-5 text-blue-600" /> Carrinho Atual
                            </h3>
                            {cart.length === 0 ? (
                                <div className="text-center py-12 opacity-30 italic text-sm">Seu carrinho está vazio</div>
                            ) : (
                                <div className="space-y-3">
                                    {cart.map(item => (
                                        <div key={item.produto_id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="font-bold text-sm text-gray-800 dark:text-white truncate max-w-[150px]">{item.nome}</span>
                                                <button onClick={() => removeFromCart(item.produto_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2 bg-white dark:bg-gray-700 rounded-lg p-1">
                                                    <button onClick={() => updateQty(item.produto_id, -1)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded"><Minus className="w-3 h-3" /></button>
                                                    <span className="text-xs font-black min-w-[20px] text-center">{item.quantidade}</span>
                                                    <button onClick={() => updateQty(item.produto_id, 1)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded"><Plus className="w-3 h-3" /></button>
                                                </div>
                                                <span className="font-black text-blue-600">R$ {item.total_item.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Checkout Footer */}
                        <div className="space-y-6 shrink-0">
                            <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-900/30">
                                <div className="flex justify-between text-blue-600/70 text-xs font-black mb-1">
                                    <span>SUBTOTAL</span>
                                    <span>R$ {(calculateTotal() - logistics.taxa_entrega).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-blue-600/70 text-xs font-black border-b border-blue-100 dark:border-blue-900/30 pb-3 mb-3">
                                    <span>TAXA</span>
                                    <span>R$ {logistics.taxa_entrega.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-blue-900 dark:text-blue-100">
                                    <span className="text-sm font-black uppercase">Total Geral</span>
                                    <span className="text-2xl font-black">R$ {calculateTotal().toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                {step === 1 ? (
                                    <button
                                        disabled={cart.length === 0}
                                        onClick={() => setStep(2)}
                                        className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-4xl font-bold shadow-xl shadow-blue-500/30 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                                    >
                                        Próximo Passo <ChevronRight className="w-5 h-5" />
                                    </button>
                                ) : (
                                    <div className="flex gap-3">
                                        <button onClick={() => setStep(1)} className="p-4 bg-gray-100 dark:bg-gray-800 rounded-3xl text-gray-500"><ChevronRight className="w-6 h-6 rotate-180" /></button>
                                        <button
                                            disabled={loading}
                                            onClick={handleSubmit}
                                            className="flex-1 py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-4xl font-bold shadow-xl shadow-indigo-500/30 flex items-center justify-center gap-3 transition-all active:scale-95"
                                        >
                                            {loading ? 'Processando...' : 'Finalizar Venda'} <Truck className="w-5 h-5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>

            {scannerAberto && (
                <BarcodeScanner
                    onScan={(codigo) => { setScannerAberto(false); setProdSearch(codigo); }}
                    onClose={() => setScannerAberto(false)}
                />
            )}
        </div>
    );
};

export default UnifiedDeliverySaleModal;
