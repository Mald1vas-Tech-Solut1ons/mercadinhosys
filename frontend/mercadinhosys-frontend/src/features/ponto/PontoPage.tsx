// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Camera, MapPin, CheckCircle, AlertCircle, Calendar,
  TrendingUp, BarChart3, RefreshCw, X, Wifi, WifiOff, History, Navigation,
  LogIn, LogOut, Coffee, RotateCcw
} from 'lucide-react';

const PONTO_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  entrada: LogIn,
  saida_almoco: Coffee,
  retorno_almoco: RotateCcw,
  saida: LogOut,
};
import { pontoService, RegistroPonto, ConfiguracaoHorario, EstatisticasPonto } from './pontoService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

import { showToast } from '../../utils/toast';

// Função auxiliar para construir URL completa da foto
const construirUrlFoto = (fotoUrl: string | null | undefined): string => {
  if (!fotoUrl) return '';

  // Se for URL completa, retorna como está
  if (fotoUrl.startsWith('http://') || fotoUrl.startsWith('https://')) {
    return fotoUrl;
  }

  // Em desenvolvimento, o proxy do Vite cuida de /uploads
  // Em produção, usar a mesma origem
  return fotoUrl;
};

const PontoPage: React.FC = () => {
  const navigate = useNavigate();
  const [registrosHoje, setRegistrosHoje] = useState<RegistroPonto[]>([]);
  const [configuracao, setConfiguracao] = useState<ConfiguracaoHorario | null>(null);
  const [estatisticas, setEstatisticas] = useState<EstatisticasPonto | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const [localizacao, setLocalizacao] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tipoRegistroSelecionado, setTipoRegistroSelecionado] = useState<string | null>(null);
  const [distanciaValidacao, setDistanciaValidacao] = useState<number | null>(null);
  const [localizacaoConfirmada, setLocalizacaoConfirmada] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [registrosOffline, setRegistrosOffline] = useState<any[]>([]);
  const [fotoModal, setFotoModal] = useState<{ url: string; registro: RegistroPonto } | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    carregarDados();
    // Carregar registros offline do localStorage
    const registrosOfflineLocal = localStorage.getItem('registros_ponto_offline');
    if (registrosOfflineLocal) {
      setRegistrosOffline(JSON.parse(registrosOfflineLocal));
    }

    // Monitorar status online/offline
    window.addEventListener('online', () => setOnline(true));
    window.addEventListener('offline', () => setOnline(false));

    return () => {
      window.removeEventListener('online', () => setOnline(true));
      window.removeEventListener('offline', () => setOnline(false));
    };
  }, []);

  const carregarDados = async () => {
    try {
      setLoading(true);
      const promise = Promise.all([
        pontoService.obterPontosHoje(),
        pontoService.obterEstatisticas()
      ]);

      const [pontosResponse, estatisticasResponse] = await promise;

      if (pontosResponse.success) {
        setRegistrosHoje(pontosResponse.data.registros);
        setConfiguracao(pontosResponse.data.configuracao);

        console.log('📋 REGISTROS DE HOJE CARREGADOS:', {
          quantidade: pontosResponse.data.registros.length,
          registros: pontosResponse.data.registros.map((r: RegistroPonto) => ({
            id: r.id,
            tipo: r.tipo_registro,
            foto_url: r.foto_url,
            foto_url_construida: construirUrlFoto(r.foto_url)
          }))
        });
      }

      if (estatisticasResponse.success) {
        setEstatisticas(estatisticasResponse.data);
      }

      if (online && registrosOffline.length > 0) {
        await sincronizarRegistrosOffline();
      }
    } catch (error: any) {
      console.error('Erro ao carregar dados:', error);
      showToast.error('Erro ao carregar dados. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  const sincronizarRegistrosOffline = async () => {
    for (const registro of registrosOffline) {
      try {
        await showToast.promise(pontoService.registrarPonto(registro), {
          loading: `Sincronizando registro off-line...`,
          success: `Registro sincronizado: ${registro.tipo_registro}`,
          error: `Erro ao sincronizar registro`
        });
      } catch (error) {
        console.error('Erro ao sincronizar registro:', error);
        break; // Para se houver erro
      }
    }
    // Limpar registros offline sincronizados
    localStorage.removeItem('registros_ponto_offline');
    setRegistrosOffline([]);
    await carregarDados();
  };

  const calcularDistancia = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distância em metros
  };

  const obterLocalizacao = (): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalização não suportada'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const iniciarCamera = async () => {
    try {
      console.log('🎥 Iniciando câmera...');
      setCameraReady(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });

      console.log('✅ Stream obtido:', stream.getTracks());
      setShowCamera(true);

      // Aguardar um pouco para o DOM renderizar
      setTimeout(() => {
        if (videoRef.current) {
          console.log('📺 Atribuindo stream ao video...');
          videoRef.current.srcObject = stream;
          streamRef.current = stream;

          // Forçar play
          videoRef.current.play().then(() => {
            console.log('▶️ Play iniciado');
            setCameraReady(true);
          }).catch(e => {
            console.error('❌ Erro ao fazer play:', e);
            setCameraReady(true); // Permitir mesmo com erro
          });
        } else {
          console.error('❌ videoRef não disponível');
        }
      }, 100);

    } catch (error: any) {
      console.error('❌ Erro ao acessar câmera:', error.name, error.message);
      alert(`Erro: ${error.message}\n\nVerifique as permissões de câmera`);
      setShowCamera(false);
    }
  };

  const pararCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const tirarFoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        // Esperar um pouco para o vídeo carregar
        if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
          alert('⏳ Aguarde a câmera carregar completamente!');
          return;
        }

        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const fotoBase64 = canvasRef.current.toDataURL('image/jpeg', 0.8);

        console.log('📸 Foto capturada:', fotoBase64.substring(0, 50) + '...');
        setFoto(fotoBase64);
        pararCamera();
      }
    } else {
      console.error('❌ Erro: videoRef ou canvasRef não disponível');
    }
  };

  const registrarPonto = async (tipoRegistro: string) => {
    try {
      // Validar horário primeiro
      const validacao = validarHorarioRegistro(tipoRegistro);

      if (!validacao.valido) {
        showToast.error(validacao.mensagem);
        if (validacao.alerta) {
          alert(validacao.alerta);
        }
        return;
      }

      if (validacao.alerta) {
        const continuar = confirm(`${validacao.mensagem}\n\n${validacao.alerta}\n\nDeseja continuar mesmo assim?`);
        if (!continuar) return;
      }

      setLoading(true);
      setTipoRegistroSelecionado(tipoRegistro);

      // 1. Obter localização
      let loc = null;
      let distancia = 0;
      try {
        console.log('📍 Obtendo localização...');
        loc = await obterLocalizacao();
        setLocalizacao(loc);
        console.log('✅ Localização obtida:', loc);

        // Validar raio se configurado (usar coordenadas do estabelecimento)
        // Por enquanto, apenas armazenar a localização
        distancia = 0;
        setDistanciaValidacao(distancia);
      } catch (error) {
        console.error('❌ Erro ao obter localização:', error);

        if (configuracao?.exigir_localizacao) {
          showToast.warning('📍 Localização obrigatória. Habilite a geolocalização no navegador.');
          setLoading(false);
          setTipoRegistroSelecionado(null);
          return;
        }

        const permitirSemLocalizacao = confirm(
          'Não foi possível obter sua localização.\n\n' +
          'Verifique se você permitiu o acesso à localização no navegador.\n\n' +
          'Deseja continuar sem localização?'
        );

        if (!permitirSemLocalizacao) {
          setLoading(false);
          setTipoRegistroSelecionado(null);
          return;
        }
      }

      // 2. Tirar foto se obrigatório ou não tiver ainda
      if (!foto && configuracao?.exigir_foto) {
        console.log('📸 Foto obrigatória. Iniciando câmera...');
        await iniciarCamera();
        setLoading(false);
        return;
      }

      if (!foto) {
        const tirarFotoAgora = confirm('Deseja tirar uma foto para este registro?');
        if (tirarFotoAgora) {
          await iniciarCamera();
          setLoading(false);
          return;
        }
      }

      // 3. Registrar ponto com foto e localização
      console.log('💾 Registrando ponto...', {
        tipo: tipoRegistro,
        temFoto: !!foto,
        temLocalizacao: !!loc
      });

      // Hora de parede do dispositivo (correta em qualquer fuso). O backend usa estes
      // campos em vez do relógio do servidor (UTC), evitando o desvio de fuso.
      const agora = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dataLocal = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
      const horaLocal = `${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`;

      const dados = {
        tipo_registro: tipoRegistro,
        latitude: loc?.latitude,
        longitude: loc?.longitude,
        foto: foto,
        dispositivo: navigator.userAgent,
        data_local: dataLocal,
        hora_local: horaLocal,
        observacao: `Registrado via web - ${agora.toLocaleString('pt-BR')}`
      };

      console.log('💾 ENVIANDO DADOS PARA API:', {
        tipo: tipoRegistro,
        temFoto: !!foto,
        tamanhFoto: foto ? foto.length : 0,
        primeiros100chars: foto ? foto.substring(0, 100) : null,
        temLocation: !!loc,
        lat: loc?.latitude,
        lng: loc?.longitude
      });

      let response;
      if (online) {
        response = await showToast.promise(pontoService.registrarPonto(dados), {
          loading: 'Salvando registro de ponto...',
          success: (res: any) => res.message || 'Ponto registrado com sucesso!',
          error: (err: any) => err.response?.data?.message || err.message || 'Erro ao registrar ponto'
        });
        console.log('📡 RESPOSTA DO SERVIDOR:', response);
      } else {
        // Modo offline
        console.log('📱 Modo offline - Armazenando registro...');
        const registrosOfflineLocal = JSON.parse(localStorage.getItem('registros_ponto_offline') || '[]');
        registrosOfflineLocal.push(dados);
        localStorage.setItem('registros_ponto_offline', JSON.stringify(registrosOfflineLocal));
        setRegistrosOffline(registrosOfflineLocal);

        showToast.warning('Registro armazenado offline. Será sincronizado quando conectar.');

        setFoto(null);
        setLocalizacao(null);
        setTipoRegistroSelecionado(null);
        setLoading(false);
        return;
      }

      if (response && response.success) {
        console.log('✅ Sucesso! Resposta:', response.data);
        setFoto(null);
        setLocalizacao(null);
        setLocalizacaoConfirmada(false);
        setTipoRegistroSelecionado(null);
        await carregarDados();
      }
    } catch (error: any) {
      console.error('❌ Erro ao registrar ponto:', error);
      showToast.error(error.response?.data?.message || error.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const confirmarRegistroComFoto = async () => {
    if (tipoRegistroSelecionado && foto) {
      await registrarPonto(tipoRegistroSelecionado);
    }
  };

  const jaRegistrou = (tipo: string) => {
    return registrosHoje.some(r => r.tipo_registro === tipo);
  };

  const getTipoLabel = (tipo: string) => {
    const labels = {
      'entrada': 'Entrada',
      'saida_almoco': 'Saída Almoço',
      'retorno_almoco': 'Retorno Almoço',
      'saida': 'Saída'
    };
    return labels[tipo] || tipo;
  };

  const getHorarioEsperado = (tipo: string) => {
    if (!configuracao) return '';
    const horarios = {
      'entrada': configuracao.hora_entrada,
      'saida_almoco': configuracao.hora_saida_almoco,
      'retorno_almoco': configuracao.hora_retorno_almoco,
      'saida': configuracao.hora_saida
    };
    return horarios[tipo] || '';
  };

  const limparRegistrosDeTeste = async () => {
    const confirmar = window.confirm(
      '⚠️ ATENÇÃO - MODO TESTE\n\nVocê realmente quer deletar TODOS os registros de hoje para testes?\n\nEsta ação não pode ser desfeita!'
    );

    if (!confirmar) return;

    try {
      setLoading(true);

      const promise = fetch('/api/ponto/teste/limpar-hoje', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('access_token')}`,
          'Content-Type': 'application/json'
        }
      }).then(res => res.json());

      const data = await showToast.promise(promise, {
        loading: 'Limpando registros de teste...',
        success: (res: any) => `${res.message} (${res.data.registros_removidos} removidos)`,
        error: 'Erro ao limpar registros'
      });

      if (data && data.success) {
        await carregarDados();
      }
    } catch (error: any) {
      console.error('Erro ao limpar registros:', error);
    } finally {
      setLoading(false);
    }
  };

  const validarHorarioRegistro = (tipo: string): { valido: boolean; mensagem: string; alerta?: string } => {
    if (!configuracao) return { valido: true, mensagem: '' };

    const agora = new Date();
    const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const tolerancia = configuracao.tolerancia_atraso_minutos || 5;

    const horarioEsperado = getHorarioEsperado(tipo);
    if (!horarioEsperado) return { valido: true, mensagem: '' };

    const [horaEsp, minEsp] = horarioEsperado.split(':').map(Number);
    const [horaAtual_h, minAtual] = horaAtual.split(':').map(Number);

    const minEsperado = horaEsp * 60 + minEsp;
    const minAgora = horaAtual_h * 60 + minAtual;
    const diferenca = minAgora - minEsperado;

    // Validar se está no horário (com tolerância)
    if (diferenca < -30) {
      // Antes do horário
      return {
        valido: false,
        mensagem: `⏰ Ainda não é o horário de ${getTipoLabel(tipo)}`,
        alerta: `O horário é às ${horarioEsperado}. Faltam ${Math.abs(Math.floor(diferenca))} minutos.`
      };
    }

    if (diferenca > 240) {
      // Muito depois do horário esperado
      return {
        valido: false,
        mensagem: `⚠️ Você está muito atrasado para ${getTipoLabel(tipo)}`,
        alerta: `Esperado às ${horarioEsperado}, mas agora é ${horaAtual}. Atraso de ${Math.floor(diferenca)} minutos.`
      };
    }

    if (diferenca > tolerancia) {
      return {
        valido: true,
        mensagem: `⚠️ Você está ${Math.floor(diferenca)} minutos atrasado`,
        alerta: undefined
      };
    }

    return {
      valido: true,
      mensagem: '',
      alerta: undefined
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-4 md:p-6 animate-in fade-in duration-500">

      {/* STATUS ONLINE/OFFLINE */}
      {!online && (
        <div className="mb-4 p-4 bg-yellow-100 border-2 border-yellow-500 rounded-lg flex items-center gap-3">
          <WifiOff className="w-5 h-5 text-yellow-600" />
          <span className="text-yellow-800 font-semibold">
            Você está offline. Os registros serão sincronizados quando conectar.
          </span>
        </div>
      )}

      {registrosOffline.length > 0 && (
        <div className="mb-4 p-4 bg-orange-100 border-2 border-orange-500 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wifi className="w-5 h-5 text-orange-600 animate-pulse" />
            <span className="text-orange-800 font-semibold">
              {registrosOffline.length} registro(s) aguardando sincronização
            </span>
          </div>
          {online && (
            <button
              onClick={() => sincronizarRegistrosOffline()}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-semibold"
            >
              Sincronizar Agora
            </button>
          )}
        </div>
      )}

      {/* HEADER */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3 tour-ponto-bater">
              <Clock className="w-10 h-10 text-blue-500" />
              Controle de Ponto
            </h1>
            <p className="text-gray-500 dark:text-slate-400 mt-2">
              Registre sua entrada, saídas e retornos com foto e localização
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/ponto-historico')}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 font-semibold transition"
            >
              <History className="w-5 h-5" />
              Histórico
            </button>
            <button
              onClick={carregarDados}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>

          </div>
        </div>
      </div>

      {/* MODAL DE CÂMERA */}
      {showCamera && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-200 flex items-center justify-center p-4 overflow-y-auto"
          style={{
            paddingTop: 'calc(1rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          }}
        >
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-6 max-w-2xl w-full max-h-full overflow-y-auto my-auto shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">📸 Tire sua foto</h3>
            <p className="text-gray-500 dark:text-slate-400 text-sm mb-4">Posicione seu rosto na câmera e clique em "Capturar Foto"</p>

            {!cameraReady && (
              <div className="mb-4 p-4 bg-yellow-100 border border-yellow-400 rounded-lg">
                <p className="text-yellow-800 font-semibold">⏳ Câmera carregando...</p>
                <p className="text-sm text-yellow-700 mt-1">Se não aparecer em 5 segundos, verifique as permissões</p>
              </div>
            )}

            <div className="relative bg-black rounded-lg overflow-hidden mb-4 border-4 border-gray-300">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full aspect-video object-cover bg-black"
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute top-4 left-4 text-gray-900 dark:text-white text-sm bg-black/50 px-3 py-1 rounded">
                {cameraReady ? '✅ Câmera pronta' : '⏳ Carregando...'}
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={tirarFoto}
                disabled={!cameraReady}
                className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold text-lg transition"
              >
                <Camera className="w-5 h-5" />
                📸 Capturar Foto
              </button>
              <button
                onClick={pararCamera}
                className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-semibold transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PREVIEW DA FOTO COM CONFIRMAÇÃO DE LOCALIZAÇÃO */}
      {foto && !showCamera && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-200 flex items-center justify-center p-4 overflow-y-auto"
          style={{
            paddingTop: 'calc(1rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          }}
        >
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-6 max-w-2xl w-full max-h-full overflow-y-auto my-auto shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Confirmar foto e localização</h3>
            <img src={foto} alt="Preview" className="w-full rounded-lg mb-4" />

            {/* Info de localização */}
            {localizacao && (
              <div className="mb-4 p-4 bg-blue-50 rounded-lg border-2 border-blue-300">
                <div className="flex items-start gap-3">
                  <MapPin className="w-6 h-6 text-blue-600 mt-1 shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900">Localização Capturada</p>
                    <p className="text-sm text-gray-600 mt-1">
                      📍 Latitude: {localizacao.latitude.toFixed(6)}
                    </p>
                    <p className="text-sm text-gray-600">
                      📍 Longitude: {localizacao.longitude.toFixed(6)}
                    </p>
                    {distanciaValidacao !== null && (
                      <p className="text-sm text-gray-600 mt-2">
                        📏 Distância do raio: {Math.round(distanciaValidacao)}m
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!localizacao && configuracao?.exigir_localizacao && (
              <div className="mb-4 p-4 bg-red-50 rounded-lg border-2 border-red-300">
                <p className="text-red-700 font-semibold">⚠️ Localização obrigatória não obtida</p>
                <p className="text-sm text-red-600 mt-1">Você não conseguiu obter a localização. Tente novamente.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={confirmarRegistroComFoto}
                disabled={loading || (configuracao?.exigir_localizacao && !localizacao)}
                className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                <CheckCircle className="w-5 h-5" />
                {loading ? 'Registrando...' : 'Confirmar e Registrar'}
              </button>
              <button
                onClick={() => {
                  setFoto(null);
                  setLocalizacao(null);
                  setDistanciaValidacao(null);
                }}
                className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-semibold"
              >
                Tirar Novamente
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* BOTÕES DE REGISTRO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { tipo: 'entrada', label: 'Entrada', color: 'from-green-500 to-emerald-600' },
          { tipo: 'saida_almoco', label: 'Saída Almoço', color: 'from-orange-500 to-red-600' },
          { tipo: 'retorno_almoco', label: 'Retorno Almoço', color: 'from-blue-500 to-cyan-600' },
          { tipo: 'saida', label: 'Saída', color: 'from-purple-500 to-pink-600' }
        ].map((item) => {
          const registrado = jaRegistrou(item.tipo);
          const registro = registrosHoje.find(r => r.tipo_registro === item.tipo);
          const ItemIcon = PONTO_ICONS[item.tipo];

          return (
            <button
              key={item.tipo}
              onClick={() => !registrado && registrarPonto(item.tipo)}
              disabled={registrado || loading}
              className={`relative p-6 rounded-2xl shadow-xl transform transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed border ${registrado ? 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700' : `bg-linear-to-r ${item.color} border-transparent`
                }`}
            >
              {registrado && (
                <div className="absolute top-2 right-2">
                  <CheckCircle className="w-6 h-6 text-green-400" />
                </div>
              )}

              <div className="text-center">
                <ItemIcon className={`w-10 h-10 mb-2 mx-auto ${registrado ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`} />
                <h3 className={`text-xl font-bold mb-2 ${registrado ? 'text-gray-600 dark:text-slate-300' : 'text-gray-900 dark:text-white'}`}>
                  {item.label}
                </h3>

                {configuracao && (
                  <p className={`text-sm mb-2 ${registrado ? 'text-gray-500 dark:text-slate-400' : 'text-gray-900 dark:text-white/90'}`}>
                    Horário: {getHorarioEsperado(item.tipo)}
                  </p>
                )}

                {registrado && registro && (
                  <div className="mt-3 p-2 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      Registrado às {registro.hora}
                    </p>
                    {registro.status === 'atrasado' && (
                      <p className="text-xs text-red-600 mt-1">
                        ⚠️ Atraso de {registro.minutos_atraso} min
                      </p>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ESTATÍSTICAS COM GRÁFICO DE HORAS */}
      {estatisticas && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* GRÁFICO DE FREQUÊNCIA - MELHORADO */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 flex flex-col">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              Frequência (Últimos 30 dias)
            </h3>
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={estatisticas.grafico_frequencia} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorFreq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis
                    dataKey="data"
                    stroke="#334155"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    dy={15}
                  />
                  <YAxis 
                    stroke="#334155"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    allowDecimals={false}
                    dx={-10}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                    }}
                    cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '3 3' }}
                    content={({ payload }) => {
                      if (payload && payload.length > 0) {
                        const data = payload[0].payload;
                        return (
                          <div className="p-3">
                            <p className="font-bold text-gray-900 dark:text-white mb-1">{data.data}</p>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                              <p className="text-sm text-gray-600 dark:text-slate-300">Registros: <span className="font-bold text-gray-900 dark:text-white">{data.total_registros}</span></p>
                            </div>
                            {data.teve_atraso && (
                              <p className="text-sm text-red-400 font-semibold mt-2">
                                ⚠️ Atraso: {data.minutos_atraso} min
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_registros"
                    fill="url(#colorFreq)"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RESUMO ESTATÍSTICAS - MELHORADO */}
          <div className="space-y-4">
            <div className="bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-xl p-6 text-gray-900 dark:text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90 font-semibold">Taxa de Presença</p>
                  <p className="text-4xl font-bold mt-1">{estatisticas.taxa_presenca}%</p>
                  <p className="text-sm mt-3 opacity-90">{estatisticas.dias_trabalhados} dias</p>
                </div>
                <TrendingUp className="w-16 h-16 opacity-30" />
              </div>
            </div>

            <div className="bg-linear-to-r from-red-500 to-orange-600 rounded-2xl shadow-xl p-6 text-gray-900 dark:text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90 font-semibold">Total de Atrasos</p>
                  <p className="text-4xl font-bold mt-1">{estatisticas.total_atrasos}</p>
                  <p className="text-sm mt-3 opacity-90">{estatisticas.minutos_atraso_total}m no total</p>
                </div>
                <AlertCircle className="w-16 h-16 opacity-30" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl p-6">
              <h4 className="font-bold text-gray-900 dark:text-white mb-4 text-lg">Registros por Tipo</h4>
              <div className="space-y-3">
                {Object.entries(estatisticas.frequencia_tipo).map(([tipo, count]) => {
                  const TipoIcon = PONTO_ICONS[tipo] || Clock;
                  return (
                    <div key={tipo} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition border border-gray-200 dark:border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <TipoIcon className="w-6 h-6 text-gray-500 dark:text-slate-400" />
                        <span className="text-gray-600 dark:text-slate-300 font-medium">{getTipoLabel(tipo)}</span>
                      </div>
                      <span className="font-bold text-blue-400 text-lg">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REGISTROS DE HOJE - MELHORADO */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 mb-8">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-blue-400" />
          Registros de Hoje
        </h3>

        {registrosHoje.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Clock className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Nenhum registro hoje.</p>
            <p className="text-sm mt-2">Registre seu primeiro ponto clicando nos botões acima.</p>
          </div>
        ) : (
          <div>
            <div className="space-y-3 mb-6">
              {registrosHoje.map((registro) => {
                const RegistroIcon = PONTO_ICONS[registro.tipo_registro] || Clock;

                return (
                  <div
                    key={registro.id}
                    onClick={() => {
                      if (registro.foto_url) {
                        setFotoModal({ url: registro.foto_url, registro });
                      }
                    }}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${registro.status === 'atrasado'
                      ? 'border-red-300 bg-red-50 hover:bg-red-100 hover:shadow-lg'
                      : 'border-green-300 bg-green-50 hover:bg-green-100 hover:shadow-lg'
                      } ${!registro.foto_url ? 'opacity-75' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${registro.status === 'atrasado' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                          <RegistroIcon className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 text-lg">{getTipoLabel(registro.tipo_registro)}</p>
                          <p className="text-sm text-gray-600">
                            <Clock className="w-4 h-4 inline mr-1" />
                            {registro.hora}
                          </p>
                          {registro.status === 'atrasado' && (
                            <p className="text-sm text-red-600 font-semibold mt-1">
                              ⚠️ Atraso de {registro.minutos_atraso} minutos
                            </p>
                          )}
                          {registro.status === 'normal' && (
                            <p className="text-sm text-green-600 font-semibold mt-1">
                              ✅ No horário
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {registro.foto_url ? (
                          <div
                            className="w-16 h-16 rounded-lg overflow-hidden border-2 border-gray-300 hover:border-blue-500 cursor-pointer hover:scale-110 transition-transform relative"
                            title="Clique para visualizar foto"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFotoModal({ url: registro.foto_url!, registro });
                            }}
                          >
                            <img
                              src={construirUrlFoto(registro.foto_url)}
                              alt="Foto do registro"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                console.error('❌ Erro ao carregar thumbnail:', construirUrlFoto(registro.foto_url));
                              }}
                            />
                            <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition flex items-center justify-center">
                              <Camera className="w-5 h-5 text-gray-900 dark:text-white opacity-0 hover:opacity-100" />
                            </div>
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                            <Camera className="w-5 h-5" />
                          </div>
                        )}
                        {registro.latitude && registro.longitude && (
                          <div
                            className="p-2 bg-blue-100 rounded-lg hover:bg-blue-200 transition cursor-pointer"
                            title={`📍 ${registro.latitude.toFixed(6)}, ${registro.longitude.toFixed(6)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                `https://maps.google.com/?q=${registro.latitude},${registro.longitude}`,
                                '_blank'
                              );
                            }}
                          >
                            <MapPin className="w-6 h-6 text-blue-600" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Resumo do dia */}
            <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl">
              <p className="text-sm text-gray-600 font-semibold">
                Total de registros hoje: <span className="text-2xl text-blue-600 font-bold">{registrosHoje.length}</span>
              </p>
              {registrosHoje.length >= 2 && (
                <p className="text-sm text-gray-600 mt-2">
                  ✅ Você tem pelo menos um ciclo de trabalho registrado
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL DE FOTO */}
      {fotoModal && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-200 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
          style={{
            paddingTop: 'calc(0.5rem + env(safe-area-inset-top))',
            paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-full flex flex-col overflow-hidden animate-fadeIn my-auto">
            {/* HEADER */}
            <div className="bg-linear-to-r from-blue-600 to-indigo-600 p-4 sm:p-6 flex items-center justify-between text-gray-900 dark:text-white shrink-0">
              <div className="flex-1">
                <h3 className="text-lg sm:text-2xl font-bold">📷 Visualizar Foto</h3>
                <p className="text-blue-100 text-xs sm:text-sm mt-1">
                  {getTipoLabel(fotoModal.registro.tipo_registro)} - {fotoModal.registro.hora}
                </p>
              </div>
              <button
                onClick={() => setFotoModal(null)}
                className="shrink-0 p-2 hover:bg-white/20 rounded-lg transition ml-2"
              >
                <X className="w-5 sm:w-6 h-5 sm:h-6" />
              </button>
            </div>

            {/* CONTEÚDO */}
            <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
              <img
                src={construirUrlFoto(fotoModal.url)}
                alt="Foto do registro"
                className="w-full rounded-xl shadow-lg object-cover max-h-[500px] mb-6"
                onError={(e) => {
                  console.error('❌ Erro ao carregar foto modal:', construirUrlFoto(fotoModal.url));
                }}
              />

              {/* INFORMAÇÕES */}
              <div className="mt-4 sm:mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6">
                <div className="p-2 sm:p-4 bg-blue-50 rounded-lg border-l-4 border-blue-600">
                  <p className="text-xs text-blue-600 font-semibold">📝 Tipo</p>
                  <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">
                    {getTipoLabel(fotoModal.registro.tipo_registro)}
                  </p>
                </div>
                <div className="p-2 sm:p-4 bg-green-50 rounded-lg border-l-4 border-green-600">
                  <p className="text-xs text-green-600 font-semibold">⏰ Horário</p>
                  <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">{fotoModal.registro.hora}</p>
                </div>
                <div className={`p-2 sm:p-4 rounded-lg border-l-4 ${fotoModal.registro.status === 'atrasado'
                  ? 'bg-red-50 border-red-600'
                  : 'bg-green-50 border-green-600'
                  }`}>
                  <p className={`text-xs font-semibold ${fotoModal.registro.status === 'atrasado'
                    ? 'text-red-600'
                    : 'text-green-600'
                    }`}>Status</p>
                  <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">
                    {fotoModal.registro.status === 'atrasado' ? '⚠️ Atrasado' : '✅ No Horário'}
                  </p>
                </div>
                {fotoModal.registro.minutos_atraso > 0 && (
                  <div className="p-2 sm:p-4 bg-orange-50 rounded-lg border-l-4 border-orange-600">
                    <p className="text-xs text-orange-600 font-semibold">Atraso</p>
                    <p className="text-sm sm:text-lg font-bold text-gray-900 mt-1">
                      {fotoModal.registro.minutos_atraso}m
                    </p>
                  </div>
                )}
              </div>

              {/* LOCALIZAÇÃO */}
              {fotoModal.registro.latitude && fotoModal.registro.longitude && (
                <div className="p-3 sm:p-4 bg-blue-50 rounded-lg border-2 border-blue-300">
                  <p className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 sm:w-5 h-4 sm:h-5" />
                    📍 Localização Capturada
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4">
                    <div className="bg-white p-2 sm:p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-semibold">Latitude</p>
                      <p className="font-mono text-xs sm:text-sm text-gray-900 font-bold mt-1">{fotoModal.registro.latitude.toFixed(6)}</p>
                    </div>
                    <div className="bg-white p-2 sm:p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-semibold">Longitude</p>
                      <p className="font-mono text-xs sm:text-sm text-gray-900 font-bold mt-1">{fotoModal.registro.longitude.toFixed(6)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const mapsUrl = `https://maps.google.com/?q=${fotoModal.registro.latitude},${fotoModal.registro.longitude}`;
                      window.open(mapsUrl, '_blank');
                    }}
                    className="w-full px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition flex items-center justify-center gap-2 text-sm sm:text-base"
                  >
                    <Navigation className="w-4 h-4" />
                    Abrir no Google Maps
                  </button>
                </div>
              )}

              {!fotoModal.registro.latitude && (
                <div className="p-4 bg-gray-100 rounded-lg border-2 border-dashed border-gray-400">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-gray-400" />
                    Localização não capturada
                  </p>
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="bg-gray-100 p-4 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setFotoModal(null)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PontoPage;
