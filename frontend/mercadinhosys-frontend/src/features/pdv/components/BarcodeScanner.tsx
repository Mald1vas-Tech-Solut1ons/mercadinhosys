import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, Scan, Keyboard, AlertCircle, CheckCircle2, Smartphone } from 'lucide-react';
import Quagga from '@ericblade/quagga2';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

interface BarcodeScannerProps {
    onScan: (codigo: string) => void;
    onClose: () => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScan, onClose }) => {
    const [modoEntrada, setModoEntrada] = useState<'camera' | 'manual'>('manual');
    const [codigoManual, setCodigoManual] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [cameraAtiva, setCameraAtiva] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanSuccess, setScanSuccess] = useState(false);

    const scannerRef = useRef<HTMLDivElement>(null);
    const lastScanTimeRef = useRef<number>(0);
    const lastScanRef = useRef<string | null>(null);
    
    // Filtro de Confiança (Debounce Triplo)
    const scanCountRef = useRef<number>(0);
    const candidateRef = useRef<string>('');
    const candidateTimeRef = useRef<number>(0);

    // Validação matemática do EAN-13 e EAN-8
    const isValidEAN = (ean: string): boolean => {
        if (!ean || (ean.length !== 8 && ean.length !== 13)) return false;
        if (ean.length === 13) {
            let sum = 0;
            for (let i = 0; i < 12; i++) {
                sum += parseInt(ean[i], 10) * (i % 2 === 0 ? 1 : 3);
            }
            const check = (10 - (sum % 10)) % 10;
            return check === parseInt(ean[12], 10);
        }
        if (ean.length === 8) {
            let sum = 0;
            for (let i = 0; i < 7; i++) {
                sum += parseInt(ean[i], 10) * (i % 2 === 0 ? 3 : 1);
            }
            const check = (10 - (sum % 10)) % 10;
            return check === parseInt(ean[7], 10);
        }
        return false;
    };

    // Este componente só é montado enquanto o scanner estiver aberto (sem prop isOpen),
    // então trava o scroll do fundo durante toda a vida do componente.
    useBodyScrollLock(true);

    // Cleanup Quagga
    const pararCamera = useCallback(async () => {
        try {
            Quagga.offDetected();
            await Quagga.stop();
            setCameraAtiva(false);
            setIsScanning(false);
        } catch (e) {
            console.error('Erro ao parar Quagga:', e);
        }
    }, []);

    useEffect(() => {
        return () => {
            pararCamera();
        };
    }, [pararCamera]);

    // Iniciar câmera com Quagga2
    const iniciarCamera = async () => {
        if (!scannerRef.current) return;

        setErro(null);
        setIsScanning(true);

        try {
            await Quagga.init({
                inputStream: {
                    type: "LiveStream",
                    target: scannerRef.current,
                    constraints: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: { ideal: "environment" }
                    },
                },
                locator: {
                    patchSize: "medium",
                    halfSample: true
                },
                numOfWorkers: navigator.hardwareConcurrency || 4,
                decoder: {
                    readers: [
                        "ean_reader",
                        "ean_8_reader",
                        "upc_reader"
                    ],
                    multiple: false
                },
                locate: true
            });

            Quagga.start();
            setCameraAtiva(true);
            setIsScanning(false);

            // Registrar callback de detecção
            Quagga.onDetected((data) => {
                const now = Date.now();
                const code = data.codeResult?.code;

                if (!code || !isValidEAN(code)) return;

                // Debounce de 2s para o mesmo código (para não floodar quando já aceitou)
                if (code === lastScanRef.current && now - lastScanTimeRef.current < 2000) {
                    return;
                }

                // Reseta a contagem se passar muito tempo (1 segundo)
                if (now - candidateTimeRef.current > 1000) {
                    candidateRef.current = '';
                    scanCountRef.current = 0;
                }

                if (code !== candidateRef.current) {
                    candidateRef.current = code;
                    scanCountRef.current = 1;
                    candidateTimeRef.current = now;
                } else {
                    scanCountRef.current += 1;
                    candidateTimeRef.current = now;
                }

                // Somente notifica após 3 leituras consecutivas idênticas e válidas
                if (scanCountRef.current >= 3) {
                    lastScanRef.current = code;
                    lastScanTimeRef.current = now;
                    setScanSuccess(true);
                    
                    setTimeout(() => setScanSuccess(false), 500);
                    onScan(code);
                    
                    candidateRef.current = '';
                    scanCountRef.current = 0;
                }
            });

        } catch (error: any) {
            console.error('Erro fatal ao iniciar Quagga:', error);
            setErro(`Erro ao acessar câmera: ${error.message || 'Verifique as permissões'}`);
            setModoEntrada('manual');
            setIsScanning(false);
        }
    };

    // Mudar modo
    const handleModoChange = (modo: 'camera' | 'manual') => {
        if (modo === modoEntrada) return;

        setModoEntrada(modo);
        setErro(null);

        if (modo === 'camera') {
            setTimeout(iniciarCamera, 100);
        } else {
            pararCamera();
        }
    };

    // Enviar código manual
    const handleEnviarManual = (e: React.FormEvent) => {
        e.preventDefault();
        if (codigoManual.trim()) {
            onScan(codigoManual.trim());
            setCodigoManual('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-9999 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex items-center space-x-3">
                        <div className="p-2.5 bg-blue-100 dark:bg-blue-900/50 rounded-xl">
                            <Scan className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                                Scanner de Produtos
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {modoEntrada === 'camera' ? 'Aponte a câmera para o código' : 'Digite o código de barras'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                    >
                        <X className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>

                {/* Seletor de Modo */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex bg-gray-200 dark:bg-gray-800 p-1 rounded-xl">
                        <button
                            onClick={() => handleModoChange('manual')}
                            className={`flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all ${modoEntrada === 'manual'
                                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                                }`}
                        >
                            <Keyboard className="w-4 h-4" />
                            <span>Manual</span>
                        </button>

                        <button
                            onClick={() => handleModoChange('camera')}
                            className={`flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all ${modoEntrada === 'camera'
                                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                                }`}
                        >
                            <Camera className="w-4 h-4" />
                            <span>Câmera</span>
                        </button>
                    </div>
                </div>

                {/* Conteúdo */}
                <div className="flex-1 overflow-y-auto p-6">
                    {modoEntrada === 'manual' ? (
                        <form onSubmit={handleEnviarManual} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                    Código de Barras (EAN/UPC)
                                </label>
                                <input
                                    type="text"
                                    value={codigoManual}
                                    onChange={(e) => setCodigoManual(e.target.value)}
                                    placeholder="Ex: 7891234567890"
                                    className="w-full pl-4 pr-4 py-4 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 text-2xl font-mono bg-white dark:bg-gray-900 text-gray-800 dark:text-white transition-all outline-none"
                                    autoFocus
                                />
                                <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                                    <AlertCircle className="w-4 h-4" />
                                    <span className="text-xs">Leitores USB funcionam automaticamente aqui</span>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={!codigoManual.trim()}
                                className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center space-x-2 shadow-lg transition-all ${codigoManual.trim()
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98]'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                    }`}
                            >
                                <Scan className="w-5 h-5" />
                                <span>Adicionar Produto</span>
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            {erro ? (
                                <div className="p-6 bg-red-50 dark:bg-red-900/20 border-2 border-red-100 dark:border-red-900/30 rounded-2xl text-center">
                                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                                    <h3 className="text-lg font-bold text-red-800 dark:text-red-300 mb-2">Ops! Algo deu errado</h3>
                                    <p className="text-sm text-red-700 dark:text-red-400 mb-4">{erro}</p>
                                    <button
                                        onClick={() => handleModoChange('manual')}
                                        className="px-6 py-2 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors"
                                    >
                                        Usar Modo Manual
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <div
                                        ref={scannerRef}
                                        className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-4/3 shadow-inner border-2 border-gray-100 dark:border-gray-700"
                                    >
                                        {isScanning && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                                                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                                            </div>
                                        )}
                                        {cameraAtiva && !scanSuccess && (
                                            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                                                <div className="relative w-72 h-44">
                                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg shadow-sm"></div>
                                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg shadow-sm"></div>
                                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg shadow-sm"></div>
                                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg shadow-sm"></div>
                                                    <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse"></div>
                                                </div>
                                            </div>
                                        )}
                                        {scanSuccess && (
                                            <div className="absolute inset-0 bg-green-500/30 backdrop-blur-[2px] z-20 flex items-center justify-center">
                                                <CheckCircle2 className="w-16 h-16 text-green-500 bg-white dark:bg-green-900 rounded-full p-2" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-100 dark:border-blue-900/30 rounded-2xl p-4">
                                    <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-1 text-sm flex items-center">
                                        <Smartphone className="w-4 h-4 mr-2" /> Móvel
                                    </h4>
                                    <p className="text-[11px] text-blue-700 dark:text-blue-400">Excelente para tablets e celulares no balcão.</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-100 dark:border-purple-900/30 rounded-2xl p-4">
                                    <h4 className="font-bold text-purple-800 dark:text-purple-300 mb-1 text-sm flex items-center">
                                        <Scan className="w-4 h-4 mr-2" /> Formatos
                                    </h4>
                                    <p className="text-[11px] text-purple-700 dark:text-purple-400">EAN-13, EAN-8, UPC-A e Code-128.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-gray-400">MercadinhoSys Professional PDV</p>
                    <button onClick={onClose} className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors">
                        Concluído
                    </button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                /* scanner-container video { width: 100%; height: 100%; object-fit: cover; } */
                /* scanner-container canvas { display: none; } */
                .drawingBuffer { position: absolute; top: 0; left: 0; pointer-events: none; }
            `}} />
        </div>
    );
};

export default BarcodeScanner;
