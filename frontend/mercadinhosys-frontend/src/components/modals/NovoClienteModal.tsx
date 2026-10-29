import React, { useState } from 'react';
import { X, Building2, CheckCircle } from 'lucide-react';
import { showToast } from '../../utils/toast';
import { API_CONFIG } from '../../api/apiConfig';
import { formatCnpj, formatCpf, formatPhone, formatCep, buscarCep } from '../../utils/cepUtils';
import { validarCPF } from '../../features/customers/components/inputMasks';
import { erroSenha } from '../../utils/validators';
import LinkAcessoPainel, { LinkAcesso } from './LinkAcessoPainel';

const LinkAcessoFalhou: React.FC<{ loja: string; onClose: () => void }> = ({ loja, onClose }) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[210] p-4">
    <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl dark:bg-gray-800">
      <h3 className="text-lg font-bold text-gray-900 mb-2 dark:text-gray-100">{loja} foi criada</h3>
      <p className="text-sm text-gray-600 mb-4 dark:text-gray-300">
        Não foi possível gerar o link de ativação agora. Abra a loja na lista e use "Enviar link de acesso".
      </p>
      <button onClick={onClose} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-semibold">Entendi</button>
    </div>
  </div>
);

interface NovoClienteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormData {
  // Dados do Estabelecimento
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  cpf: string;
  telefone: string;
  email_estabelecimento: string;
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;

  // Dados do Administrador
  nome_admin: string;
  email_admin: string;
  cpf_admin: string;
  senha_admin: string;
  confirmar_senha: string;
  // Plano de acesso
  tipo_acesso: 'trial' | 'gratuito';
  trial_dias: string;
}

const NovoClienteModal: React.FC<NovoClienteModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [acesso, setAcesso] = useState<LinkAcesso | null>(null);
  const [formData, setFormData] = useState<FormData>({
    // Dados do Estabelecimento
    nome_fantasia: '',
    razao_social: '',
    cnpj: '',
    cpf: '',
    telefone: '',
    email_estabelecimento: '',
    cep: '',
    logradouro: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: '',

    // Dados do Administrador
    nome_admin: '',
    email_admin: '',
    cpf_admin: '',
    senha_admin: '',
    confirmar_senha: '',
    // Plano de acesso: padrão = trial Pro por 30 dias
    tipo_acesso: 'trial',
    trial_dias: '30'
  });

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const validateStep1 = () => {
    if (!formData.nome_fantasia.trim()) {
      showToast.error('Nome fantasia é obrigatório');
      return false;
    }
    if (!formData.razao_social.trim()) {
      showToast.error('Razão social é obrigatória');
      return false;
    }
    if (!formData.cnpj.trim() && !formData.cpf.trim()) {
      showToast.error('CNPJ ou CPF é obrigatório');
      return false;
    }
    if (!formData.telefone.trim()) {
      showToast.error('Telefone é obrigatório');
      return false;
    }
    if (!formData.email_estabelecimento.trim()) {
      showToast.error('Email do estabelecimento é obrigatório');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!formData.nome_admin.trim()) {
      showToast.error('Nome do administrador é obrigatório');
      return false;
    }
    if (!formData.cpf_admin.trim()) {
      showToast.error('CPF do administrador é obrigatório');
      return false;
    }
    if (!validarCPF(formData.cpf_admin)) {
      showToast.error('CPF do administrador inválido');
      return false;
    }
    if (!formData.email_admin.trim()) {
      showToast.error('Email do administrador é obrigatório');
      return false;
    }
    // Senha opcional: em branco, o cliente cria a dele pelo link de ativação.
    const problemaSenha = formData.senha_admin ? erroSenha(formData.senha_admin) : null;
    if (problemaSenha) {
      showToast.error(problemaSenha);
      return false;
    }
    if (formData.senha_admin !== formData.confirmar_senha) {
      showToast.error('As senhas não conferem');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateStep1() || !validateStep2()) {
      return;
    }

    setIsLoading(true);
    showToast.loading('Provisionando ambiente do cliente...', { id: 'onboarding' });

    try {
      const payload = {
        nome_fantasia: formData.nome_fantasia.trim(),
        razao_social: formData.razao_social.trim(),
        cnpj: formData.cnpj.trim() || undefined,
        cpf: formData.cpf.trim() || undefined,
        telefone: formData.telefone.trim(),
        email_estabelecimento: formData.email_estabelecimento.trim(),
        cep: formData.cep.trim() || undefined,
        logradouro: formData.logradouro.trim() || undefined,
        numero: formData.numero.trim() || undefined,
        bairro: formData.bairro.trim() || undefined,
        cidade: formData.cidade.trim() || undefined,
        estado: formData.estado.trim() || undefined,
        nome_admin: formData.nome_admin.trim(),
        email_admin: formData.email_admin.trim(),
        cpf_admin: formData.cpf_admin.replace(/\D/g, ''),
        senha_admin: formData.senha_admin || undefined,
        plano: formData.tipo_acesso,          // 'trial' | 'gratuito'
        trial_dias: formData.tipo_acesso === 'trial'
          ? (parseInt(formData.trial_dias, 10) || 30)
          : undefined
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}/saas/onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('Ambiente criado com sucesso!', { id: 'onboarding' });
        onSuccess();
        // O painel de acesso fica aberto até o super admin mandar o link (o modal fecha junto).
        setAcesso({
          loja: data.data.estabelecimento.nome_fantasia,
          username: data.data.acesso.login,
          email: data.data.administrador.email,
          emailEnviado: Boolean(data.data.ativacao?.email_enviado),
          link: data.data.ativacao?.link_ativacao || '',
          telefone: formData.telefone,
        });
        resetForm();
      } else {
        showToast.error(data.error || 'Erro ao criar ambiente', { id: 'onboarding' });
      }
    } catch (error) {
      console.error('Erro no onboarding:', error);
      showToast.error('Erro de conexão. Tente novamente.', { id: 'onboarding' });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      nome_fantasia: '',
      razao_social: '',
      cnpj: '',
      cpf: '',
      telefone: '',
      email_estabelecimento: '',
      cep: '',
      logradouro: '',
      numero: '',
      bairro: '',
      cidade: '',
      estado: '',
      nome_admin: '',
      email_admin: '',
      cpf_admin: '',
      senha_admin: '',
      confirmar_senha: '',
      tipo_acesso: 'trial',
      trial_dias: '30'
    });
    setCurrentStep(1);
  };

  const nextStep = () => {
    if (currentStep === 1 && validateStep1()) {
      setCurrentStep(2);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isOpen) return null;

  if (acesso) {
    if (!acesso.link) {
      // Loja criada, mas o link falhou: o detalhe da loja tem "Enviar link de acesso".
      return (
        <LinkAcessoFalhou loja={acesso.loja} onClose={() => { setAcesso(null); onClose(); }} />
      );
    }
    return <LinkAcessoPainel acesso={acesso} onClose={() => { setAcesso(null); onClose(); }} />;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90dvh] overflow-y-auto my-auto dark:bg-gray-800">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between dark:bg-gray-800">
          <div className="flex items-center space-x-3">
            <Building2 className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Novo Cliente - Onboarding SaaS
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className={`flex items-center space-x-2 ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}>
                {currentStep > 1 ? <CheckCircle className="w-4 h-4" /> : '1'}
              </div>
              <span className="font-medium">Dados do Estabelecimento</span>
            </div>

            <div className={`flex-1 h-1 mx-4 ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />

            <div className={`flex items-center space-x-2 ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}>
                2
              </div>
              <span className="font-medium">Dados do Administrador</span>
            </div>
          </div>
        </div>

        {/* Form Content */}
        <div className="px-6 py-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4 dark:text-gray-100">
                  Informações do Estabelecimento
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Nome Fantasia *
                    </label>
                    <input
                      type="text"
                      value={formData.nome_fantasia}
                      onChange={(e) => handleInputChange('nome_fantasia', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="Mercadinho da Família"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Razão Social *
                    </label>
                    <input
                      type="text"
                      value={formData.razao_social}
                      onChange={(e) => handleInputChange('razao_social', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="Comércio de Alimentos Ltda"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={formatCnpj(formData.cnpj)}
                      onChange={(e) => handleInputChange('cnpj', e.target.value.replace(/\D/g, '').slice(0, 14))}
                      inputMode="numeric"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="00.000.000/0000-00"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      CPF (para MEI)
                    </label>
                    <input
                      type="text"
                      value={formatCpf(formData.cpf)}
                      onChange={(e) => handleInputChange('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
                      inputMode="numeric"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="000.000.000-00"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Telefone *
                    </label>
                    <input
                      type="tel"
                      value={formatPhone(formData.telefone)}
                      onChange={(e) => handleInputChange('telefone', e.target.value.replace(/\D/g, '').slice(0, 11))}
                      inputMode="tel"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="(00) 00000-0000"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Email do Estabelecimento *
                    </label>
                    <input
                      type="email"
                      value={formData.email_estabelecimento}
                      onChange={(e) => handleInputChange('email_estabelecimento', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="contato@mercado.com"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="mt-6 border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Plano de Acesso</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer ${formData.tipo_acesso === 'trial' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} dark:border-gray-700`}>
                      <input
                        type="radio"
                        name="tipo_acesso"
                        checked={formData.tipo_acesso === 'trial'}
                        onChange={() => handleInputChange('tipo_acesso', 'trial')}
                        className="mt-1"
                        disabled={isLoading}
                      />
                      <div>
                        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Trial Pro (recomendado)</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">Cliente usa tudo do Pro durante o período grátis. Depois bloqueia sozinho.</span>
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={formData.trial_dias}
                            onChange={(e) => handleInputChange('trial_dias', e.target.value.replace(/\D/g, '').slice(0, 3))}
                            className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                            placeholder="30"
                            disabled={isLoading || formData.tipo_acesso !== 'trial'}
                          />
                          <span className="text-xs text-gray-600 dark:text-gray-300">dias grátis (30 = 1 mês)</span>
                        </div>
                      </div>
                    </label>

                    <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer ${formData.tipo_acesso === 'gratuito' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} dark:border-gray-700`}>
                      <input
                        type="radio"
                        name="tipo_acesso"
                        checked={formData.tipo_acesso === 'gratuito'}
                        onChange={() => handleInputChange('tipo_acesso', 'gratuito')}
                        className="mt-1"
                        disabled={isLoading}
                      />
                      <div>
                        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Gratuito permanente</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">Limites do plano Gratuito: 100 produtos, 1 funcionário, sem módulos Pro.</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 rounded-md">
                  <p className="text-sm text-blue-800">
                    <strong>Endereço (opcional):</strong> Pode preencher agora ou depois nas configurações
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
                  <input
                    type="text"
                    value={formatCep(formData.cep)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                      handleInputChange('cep', digits);
                      // Autofill ViaCEP: com 8 dígitos completos, busca endereço
                      if (digits.length === 8 && digits !== formData.cep) {
                        buscarCep(digits).then((addr) => {
                          if (addr) {
                            setFormData(prev => ({
                              ...prev,
                              cep: digits,
                              logradouro: addr.logradouro || prev.logradouro,
                              bairro: addr.bairro || prev.bairro,
                              cidade: addr.localidade || prev.cidade,
                              estado: addr.uf || prev.estado
                            }));
                          }
                        });
                      }
                    }}
                    inputMode="numeric"
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    placeholder="CEP"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.logradouro}
                    onChange={(e) => handleInputChange('logradouro', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2 dark:border-gray-700"
                    placeholder="Logradouro"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.numero}
                    onChange={(e) => handleInputChange('numero', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    placeholder="Número"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.bairro}
                    onChange={(e) => handleInputChange('bairro', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    placeholder="Bairro"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.cidade}
                    onChange={(e) => handleInputChange('cidade', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    placeholder="Cidade"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.estado}
                    onChange={(e) => handleInputChange('estado', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    placeholder="UF"
                    maxLength={2}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4 dark:text-gray-100">
                  Dados do Administrador (Dono)
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={formData.nome_admin}
                      onChange={(e) => handleInputChange('nome_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="João da Silva"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email_admin}
                      onChange={(e) => handleInputChange('email_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="joao@mercado.com"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      CPF do Administrador *
                    </label>
                    <input
                      type="text"
                      value={formatCpf(formData.cpf_admin)}
                      onChange={(e) => handleInputChange('cpf_admin', e.target.value.replace(/\D/g, '').slice(0, 11))}
                      inputMode="numeric"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="000.000.000-00"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Senha (opcional)
                    </label>
                    <input
                      type="password"
                      value={formData.senha_admin}
                      onChange={(e) => handleInputChange('senha_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="Em branco: o cliente cria pelo link"
                      autoComplete="new-password"
                      disabled={isLoading}
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Recomendado deixar em branco: enviamos um link de ativação para o cliente criar a própria senha.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                      Confirmar Senha
                    </label>
                    <input
                      type="password"
                      value={formData.confirmar_senha}
                      onChange={(e) => handleInputChange('confirmar_senha', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                      placeholder="Repita a senha"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="mt-6 p-4 bg-green-50 rounded-md">
                  <h4 className="font-medium text-green-900 mb-2">✨ Recursos que serão criados:</h4>
                  <ul className="text-sm text-green-800 space-y-1">
                    <li>• Estabelecimento com {formData.tipo_acesso === 'trial' ? `Trial Pro por ${parseInt(formData.trial_dias, 10) || 30} dias` : 'plano Gratuito'}</li>
                    <li>• Usuário Administrador com todas as permissões</li>
                    <li>• Configurações básicas e horário comercial</li>
                    <li>• Caixa PDV-01 inicial</li>
                    <li>• 3 categorias de produtos (Geral, Bebidas, Mercearia)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-between dark:bg-gray-800">
          <div>
            {currentStep > 1 && (
              <button
                onClick={prevStep}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors dark:text-gray-300"
                disabled={isLoading}
              >
                ← Anterior
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors dark:text-gray-300"
              disabled={isLoading}
            >
              Cancelar
            </button>

            {currentStep === 1 && (
              <button
                onClick={nextStep}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                disabled={isLoading}
              >
                Próximo →
              </button>
            )}

            {currentStep === 2 && (
              <button
                onClick={handleSubmit}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center space-x-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Provisionando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Criar Ambiente</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NovoClienteModal;
