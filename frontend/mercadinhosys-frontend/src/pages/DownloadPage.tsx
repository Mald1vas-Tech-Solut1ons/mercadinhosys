import React, { useState, useEffect } from 'react';
import { Download, Package, Shield, CheckCircle, AlertCircle, Clock, Users, Database } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import toast from 'react-hot-toast';

interface Plano {
  id: string;
  nome: string;
  preco: string;
  descricao: string;
  features: string[];
  limites: {
    clientes: number;
    fornecedores: number;
    produtos: number;
    funcionarios: number;
    vendas: number;
  };
  arquivos: {
    windows: string;
    linux: string;
    mac: string;
  };
}

const DownloadPage: React.FC = () => {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [planoSelecionado, setPlanoSelecionado] = useState<string>('basic');
  const [loading, setLoading] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  useEffect(() => {
    // Dados mock dos planos (em produção viria da API)
    setPlanos([
      {
        id: 'basic',
        nome: 'Básico',
        preco: 'R$ 97/mês',
        descricao: 'Perfeito para pequenos comércios',
        features: [
          'Até 20 clientes',
          'Até 10 fornecedores',
          'Até 100 produtos',
          'Até 5 funcionários',
          'PDV básico',
          'Dashboard básico',
          'Suporte por email'
        ],
        limites: {
          clientes: 20,
          fornecedores: 10,
          produtos: 100,
          funcionarios: 5,
          vendas: 500
        },
        arquivos: {
          windows: 'mercadinhosys-basic-windows.exe',
          linux: 'mercadinhosys-basic-linux.run',
          mac: 'mercadinhosys-basic-mac.dmg'
        }
      },
      {
        id: 'professional',
        nome: 'Professional',
        preco: 'R$ 197/mês',
        descricao: 'Ideal para comércios em crescimento',
        features: [
          'Até 100 clientes',
          'Até 50 fornecedores',
          'Até 1000 produtos',
          'Até 20 funcionários',
          'PDV completo',
          'Dashboard avançado',
          'Relatórios completos',
          'Suporte prioritário',
          'Integrações',
          'Backup automático'
        ],
        limites: {
          clientes: 100,
          fornecedores: 50,
          produtos: 1000,
          funcionarios: 20,
          vendas: 5000
        },
        arquivos: {
          windows: 'mercadinhosys-pro-windows.exe',
          linux: 'mercadinhosys-pro-linux.run',
          mac: 'mercadinhosys-pro-mac.dmg'
        }
      },
      {
        id: 'enterprise',
        nome: 'Enterprise',
        preco: 'Sob consulta',
        descricao: 'Para grandes redes e franquias',
        features: [
          'Clientes ilimitados',
          'Fornecedores ilimitados',
          'Produtos ilimitados',
          'Funcionários ilimitados',
          'Todos os recursos',
          'API completa',
          'Suporte 24/7',
          'Customização',
          'Servidor dedicado',
          'SLA garantido'
        ],
        limites: {
          clientes: -1,
          fornecedores: -1,
          produtos: -1,
          funcionarios: -1,
          vendas: -1
        },
        arquivos: {
          windows: 'mercadinhosys-enterprise-windows.exe',
          linux: 'mercadinhosys-enterprise-linux.run',
          mac: 'mercadinhosys-enterprise-mac.dmg'
        }
      }
    ]);
  }, []);

  const detectarSistemaOperacional = () => {
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'mac';
    if (userAgent.includes('linux')) return 'linux';

    // Fallback para sistemas menos comuns
    if (userAgent.includes('ubuntu') || userAgent.includes('debian')) return 'linux';

    return 'windows'; // Default
  };

  const sistemaOperacional = detectarSistemaOperacional();

  const handleDownload = async (plano: Plano) => {
    try {
      setLoading(true);
      setBaixando(plano.id);

      // Simular download (em produção faria o download real)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Registrar estatística de download
      await apiClient.post('/api/downloads/registrar', {
        plano: plano.id,
        sistema_operacional: sistemaOperacional,
        ip: '192.168.1.1' // Em produção pegaria IP real
      });

      toast.success(`Download do plano ${plano.nome} iniciado!`);

      // Simular início do download
      const link = document.createElement('a');
      link.href = '#'; // Em produção seria URL real do arquivo
      link.download = plano.arquivos[sistemaOperacional as keyof typeof plano.arquivos];
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setBaixando(null);

    } catch (error) {
      console.error('Erro no download:', error);
      toast.error('Erro ao iniciar download. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const getIconePlano = (planoId: string) => {
    switch (planoId) {
      case 'basic': return <Package className="w-6 h-6" />;
      case 'professional': return <Shield className="w-6 h-6" />;
      case 'enterprise': return <Database className="w-6 h-6" />;
      default: return <Package className="w-6 h-6" />;
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Baixe o MercadinhoSys
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Sistema completo para gestão do seu comércio
          </p>
          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span>100% Seguro • Sem vírus • Instalação rápida</span>
          </div>
        </div>

        {/* Cards dos Planos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {planos.map((plano) => (
            <div
              key={plano.id}
              className={`relative bg-white rounded-2xl shadow-lg p-8 border-2 transition-all duration-300 hover:shadow-xl cursor-pointer ${planoSelecionado === plano.id
                  ? 'border-blue-500 ring-4 ring-blue-200'
                  : 'border-gray-200 hover:border-gray-300'
                }`}
              onClick={() => setPlanoSelecionado(plano.id)}
            >
              {/* Badge Popular */}
              {plano.id === 'professional' && (
                <div className="absolute -top-4 -right-4 bg-orange-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                  MAIS POPULAR
                </div>
              )}

              {/* Header do Plano */}
              <div className="text-center mb-6">
                <div className="flex justify-center mb-4">
                  {getIconePlano(plano.id)}
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {plano.nome}
                </h3>
                <p className="text-3xl font-bold text-blue-600 mb-2">
                  {plano.preco}
                </p>
                <p className="text-gray-600">
                  {plano.descricao}
                </p>
              </div>

              {/* Features */}
              <div className="space-y-3 mb-6">
                {plano.features.map((feature, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </div>
                ))}
              </div>

              {/* Limites */}
              <div className="border-t pt-4">
                <h4 className="font-semibold text-gray-900 mb-3">Limites do Plano:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Clientes:</span>
                    <span className={`font-medium ${plano.limites.clientes === -1 ? 'text-green-600' : 'text-gray-900'
                      }`}>
                      {plano.limites.clientes === -1 ? 'Ilimitados' : plano.limites.clientes}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Fornecedores:</span>
                    <span className={`font-medium ${plano.limites.fornecedores === -1 ? 'text-green-600' : 'text-gray-900'
                      }`}>
                      {plano.limites.fornecedores === -1 ? 'Ilimitados' : plano.limites.fornecedores}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Produtos:</span>
                    <span className={`font-medium ${plano.limites.produtos === -1 ? 'text-green-600' : 'text-gray-900'
                      }`}>
                      {plano.limites.produtos === -1 ? 'Ilimitados' : plano.limites.produtos}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botão de Download */}
              <button
                onClick={() => handleDownload(plano)}
                disabled={loading || baixando === plano.id}
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {baixando === plano.id ? (
                  <>
                    <Clock className="w-5 h-5 animate-spin" />
                    <span>Baixando...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <span>Baixar para {sistemaOperacional === 'windows' ? 'Windows' : sistemaOperacional === 'mac' ? 'Mac' : 'Linux'}</span>
                  </>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Sistema Detectado */}
        <div className="bg-white rounded-xl shadow-md p-6 text-center">
          <div className="flex items-center justify-center space-x-2 text-gray-600">
            <AlertCircle className="w-5 h-5" />
            <span>
              Sistema detectado: <strong>{sistemaOperacional === 'windows' ? 'Windows' : sistemaOperacional === 'mac' ? 'macOS' : 'Linux'}</strong>
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Não é o seu sistema? <a href="#" className="text-blue-600 hover:underline">Clique aqui</a>
          </p>
        </div>

        {/* Informações Adicionais */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-xl shadow-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
              <Shield className="w-5 h-5 mr-2 text-green-500" />
              Instalação Segura
            </h3>
            <p className="text-gray-600 text-sm">
              Downloads verificados e livres de vírus. Instalação em menos de 5 minutos.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-500" />
              Suporte Técnico
            </h3>
            <p className="text-gray-600 text-sm">
              Suporte especializado para instalação e configuração do sistema.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
              <Database className="w-5 h-5 mr-2 text-purple-500" />
              Dados Locais
            </h3>
            <p className="text-gray-600 text-sm">
              Seus dados ficam salvos localmente. Sem dependência de internet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DownloadPage;
