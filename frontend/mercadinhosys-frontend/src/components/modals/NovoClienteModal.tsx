import React, { useState } from 'react';
import { X, Building2, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_CONFIG } from '../../api/apiConfig';

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
  senha_admin: string;
  confirmar_senha: string;
}

const NovoClienteModal: React.FC<NovoClienteModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
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
    senha_admin: '',
    confirmar_senha: ''
  });

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const validateStep1 = () => {
    if (!formData.nome_fantasia.trim()) {
      toast.error('Nome fantasia é obrigatório');
      return false;
    }
    if (!formData.razao_social.trim()) {
      toast.error('Razão social é obrigatória');
      return false;
    }
    if (!formData.cnpj.trim() && !formData.cpf.trim()) {
      toast.error('CNPJ ou CPF é obrigatório');
      return false;
    }
    if (!formData.telefone.trim()) {
      toast.error('Telefone é obrigatório');
      return false;
    }
    if (!formData.email_estabelecimento.trim()) {
      toast.error('Email do estabelecimento é obrigatório');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!formData.nome_admin.trim()) {
      toast.error('Nome do administrador é obrigatório');
      return false;
    }
    if (!formData.email_admin.trim()) {
      toast.error('Email do administrador é obrigatório');
      return false;
    }
    if (!formData.senha_admin.trim()) {
      toast.error('Senha é obrigatória');
      return false;
    }
    if (formData.senha_admin.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return false;
    }
    if (formData.senha_admin !== formData.confirmar_senha) {
      toast.error('As senhas não conferem');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateStep1() || !validateStep2()) {
      return;
    }

    setIsLoading(true);
    toast.loading('Provisionando ambiente do cliente...', { id: 'onboarding' });

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
        senha_admin: formData.senha_admin
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
        toast.success('Ambiente criado com sucesso!', { id: 'onboarding' });

        // Mostrar dados de acesso
        const acessoInfo = `
          🎉 Cliente provisionado com sucesso!
          
          📋 Dados de Acesso:
          Login: ${data.data.acesso.login}
          Senha: ${data.data.acesso.senha}
          URL: ${data.data.acesso.url_acesso}
          
          📧 Enviamos os dados por email para: ${data.data.administrador.email}
        `;

        toast.success(acessoInfo, { duration: 8000 });

        onSuccess();
        onClose();
        resetForm();
      } else {
        toast.error(data.error || 'Erro ao criar ambiente', { id: 'onboarding' });
      }
    } catch (error) {
      console.error('Erro no onboarding:', error);
      toast.error('Erro de conexão. Tente novamente.', { id: 'onboarding' });
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
      senha_admin: '',
      confirmar_senha: ''
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90dvh] overflow-y-auto my-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Building2 className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Informações do Estabelecimento
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nome Fantasia *
                    </label>
                    <input
                      type="text"
                      value={formData.nome_fantasia}
                      onChange={(e) => handleInputChange('nome_fantasia', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Mercadinho da Família"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Razão Social *
                    </label>
                    <input
                      type="text"
                      value={formData.razao_social}
                      onChange={(e) => handleInputChange('razao_social', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Comércio de Alimentos Ltda"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={formData.cnpj}
                      onChange={(e) => handleInputChange('cnpj', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="00.000.000/0000-00"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CPF (para MEI)
                    </label>
                    <input
                      type="text"
                      value={formData.cpf}
                      onChange={(e) => handleInputChange('cpf', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="000.000.000-00"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Telefone *
                    </label>
                    <input
                      type="tel"
                      value={formData.telefone}
                      onChange={(e) => handleInputChange('telefone', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="(00) 00000-0000"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email do Estabelecimento *
                    </label>
                    <input
                      type="email"
                      value={formData.email_estabelecimento}
                      onChange={(e) => handleInputChange('email_estabelecimento', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="contato@mercado.com"
                      disabled={isLoading}
                    />
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
                    value={formData.cep}
                    onChange={(e) => handleInputChange('cep', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="CEP"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.logradouro}
                    onChange={(e) => handleInputChange('logradouro', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2"
                    placeholder="Logradouro"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.numero}
                    onChange={(e) => handleInputChange('numero', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Número"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.bairro}
                    onChange={(e) => handleInputChange('bairro', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Bairro"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.cidade}
                    onChange={(e) => handleInputChange('cidade', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Cidade"
                    disabled={isLoading}
                  />
                  <input
                    type="text"
                    value={formData.estado}
                    onChange={(e) => handleInputChange('estado', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Dados do Administrador (Dono)
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={formData.nome_admin}
                      onChange={(e) => handleInputChange('nome_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="João da Silva"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.email_admin}
                      onChange={(e) => handleInputChange('email_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="joao@mercado.com"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Senha *
                    </label>
                    <input
                      type="password"
                      value={formData.senha_admin}
                      onChange={(e) => handleInputChange('senha_admin', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Mínimo 6 caracteres"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Confirmar Senha *
                    </label>
                    <input
                      type="password"
                      value={formData.confirmar_senha}
                      onChange={(e) => handleInputChange('confirmar_senha', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Repita a senha"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="mt-6 p-4 bg-green-50 rounded-md">
                  <h4 className="font-medium text-green-900 mb-2">✨ Recursos que serão criados:</h4>
                  <ul className="text-sm text-green-800 space-y-1">
                    <li>• Estabelecimento com plano Gratuito</li>
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
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                onClick={prevStep}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isLoading}
              >
                ← Anterior
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
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
