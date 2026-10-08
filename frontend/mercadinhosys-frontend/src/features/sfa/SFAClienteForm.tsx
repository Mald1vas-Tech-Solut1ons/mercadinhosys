import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/apiClient';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ArrowLeft, Save, Building2, MapPin, User, FileText, CheckCircle2 } from 'lucide-react';
import { showToast } from '../../utils/toast';

export default function SFAClienteForm() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [form, setForm] = useState({
        nome: '',
        cpf_cnpj: '',
        telefone: '',
        cep: '',
        endereco: '',
        numero: '',
        bairro: '',
        cidade: '',
        estado: '',
    });

    const handleViaCep = async (cep: string) => {
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length === 8) {
            try {
                const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
                const data = await res.json();
                if (!data.erro) {
                    setForm(prev => ({
                        ...prev,
                        endereco: data.logradouro || '',
                        bairro: data.bairro || '',
                        cidade: data.localidade || '',
                        estado: data.uf || ''
                    }));
                }
            } catch (error) {
                console.error("Erro no viacep", error);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            // CPF (11 dígitos) ou CNPJ (14) pelo tamanho; o vendedor entra na própria carteira no backend.
            const digitos = form.cpf_cnpj.replace(/\D/g, '');
            const ehPJ = digitos.length === 14;
            await apiClient.post('/clientes/', {
                tipo_pessoa: ehPJ ? 'PJ' : 'PF',
                nome: form.nome,
                razao_social: ehPJ ? form.nome : undefined,
                cpf: ehPJ ? undefined : digitos || undefined,
                cnpj: ehPJ ? digitos : undefined,
                celular: form.telefone,
                cep: form.cep,
                logradouro: form.endereco,
                numero: form.numero,
                bairro: form.bairro,
                cidade: form.cidade,
                estado: form.estado,
            });
            setSuccess(true);
            showToast.success('Cliente cadastrado com sucesso!');
            setTimeout(() => {
                navigate('/sfa/clientes');
            }, 2000);
        } catch (error: any) {
            const erros: string[] = error?.response?.data?.errors || [];
            showToast.error(erros.length ? erros.join(' · ') : error?.response?.data?.message || 'Erro ao cadastrar cliente.');
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 -m-6 items-center justify-center p-6 text-center">
                <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-12 h-12 text-emerald-500 animate-bounce" />
                </div>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">Cliente Registrado!</h2>
                <p className="text-slate-500 mb-8 max-w-xs">O cliente foi adicionado à sua carteira e está pronto para o primeiro pedido.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 -m-6 relative pb-28">
            <div className="sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-sm z-10 p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/sfa/clientes')} className="rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                        <ArrowLeft className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                    </Button>
                    <h1 className="font-bold text-lg text-slate-900 dark:text-white">Novo Cliente</h1>
                </div>
            </div>

            <div className="p-4 md:p-6 max-w-lg mx-auto w-full">
                <form onSubmit={handleSubmit} className="space-y-6">
                    
                    {/* Seção Dados Básicos */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
                            <User className="w-4 h-4 text-blue-500" /> Dados Principais
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Razão Social / Nome Completo *</label>
                                <Input required placeholder="Ex: Mercadinho São José" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">CNPJ ou CPF</label>
                                <div className="relative">
                                    <FileText className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                                    <Input placeholder="00.000.000/0001-00" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50 pl-10" value={form.cpf_cnpj} onChange={e => setForm({...form, cpf_cnpj: e.target.value})} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Telefone / WhatsApp</label>
                                <Input placeholder="(00) 00000-0000" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={form.telefone} onChange={e => setForm({...form, telefone: e.target.value})} />
                            </div>
                        </div>
                    </div>

                    {/* Seção Endereço */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
                            <Building2 className="w-4 h-4 text-emerald-500" /> Endereço Comercial
                        </h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">CEP</label>
                                    <div className="relative">
                                        <MapPin className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                                        <Input 
                                            placeholder="00000-000" 
                                            className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50 pl-10" 
                                            value={form.cep} 
                                            onChange={e => {
                                                setForm({...form, cep: e.target.value});
                                                if (e.target.value.length >= 8) handleViaCep(e.target.value);
                                            }} 
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Número</label>
                                    <Input placeholder="123" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={form.numero} onChange={e => setForm({...form, numero: e.target.value})} />
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Logradouro</label>
                                <Input placeholder="Rua, Avenida..." className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={form.endereco} onChange={e => setForm({...form, endereco: e.target.value})} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Bairro</label>
                                    <Input placeholder="Centro" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={form.bairro} onChange={e => setForm({...form, bairro: e.target.value})} />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 ml-1 mb-1 block">Cidade/UF</label>
                                    <Input placeholder="São Paulo/SP" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800/50" value={`${form.cidade} ${form.estado ? '- ' + form.estado : ''}`} readOnly />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button 
                            type="submit" 
                            disabled={submitting || !form.nome}
                            className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-bold text-lg shadow-xl shadow-slate-900/20 dark:shadow-blue-500/20 flex items-center justify-center transition-transform hover:-translate-y-1"
                        >
                            {submitting ? (
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <Save className="w-5 h-5 mr-2" /> Salvar Cliente
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
