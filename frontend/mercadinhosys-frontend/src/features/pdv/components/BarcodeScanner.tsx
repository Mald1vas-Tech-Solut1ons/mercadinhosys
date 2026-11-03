import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, Scan, Keyboard, AlertCircle, CheckCircle2, Search, Flashlight, FlashlightOff, SwitchCamera, ZoomIn } from 'lucide-react';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

interface BarcodeScannerProps {
    onScan: (codigo: string) => void;
    onClose: () => void;
    /** Cadastro de produto: texto com letras no modo manual busca pelo nome (base de produtos). */
    onBuscarNome?: (termo: string) => void;
}

/*
 * Leitura pela câmera do celular.
 *
 * Dois decodificadores, escolhidos pelo aparelho:
 *   - BarcodeDetector (Chrome/Android): o mesmo leitor do app de câmera, rápido e preciso;
 *   - ZXing (iPhone e navegador sem BarcodeDetector), carregado só quando precisa.
 *
 * O <video> é do React e as camadas (mira, carregando, sucesso) são irmãs dele. Antes a
 * biblioteca injetava o vídeo dentro de uma div que também tinha filhos do React, e o
 * React quebrava ("removeChild") assim que a câmera abria — a tela do scanner morria
 * justamente no celular.
 */

type Decodificador = (fonte: HTMLVideoElement) => Promise<{ codigo: string; formato?: string }[]>;

// Validação matemática do EAN-13 / EAN-8 / UPC-A (12 dígitos, mantido como lido).
const isValidEAN = (ean: string): boolean => {
    if (!ean || !/^\d+$/.test(ean)) return false;
    if (ean.length === 13) {
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += parseInt(ean[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        const check = (10 - (sum % 10)) % 10;
        return check === parseInt(ean[12], 10);
    }
    if (ean.length === 8 || ean.length === 12) {
        // EAN-8 e UPC-A usam o mesmo peso: posições ímpares x3, pares x1
        const n = ean.length - 1;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            sum += parseInt(ean[i], 10) * (i % 2 === 0 ? 3 : 1);
        }
        const check = (10 - (sum % 10)) % 10;
        return check === parseInt(ean[n], 10);
    }
    return false;
};

// Code-128 (etiquetas de roupa/eletrônicos): alfanumérico de 6 a 30 caracteres. Só números
// precisa ser um EAN com dígito verificador certo: EAN-13 mal lido costuma sair como Code-128 quebrado.
const isValidCode128 = (code: string): boolean => {
    if (/^\d+$/.test(code)) return isValidEAN(code);
    return /^[A-Za-z0-9-]{6,30}$/.test(code);
};

const isCodigoValido = (code: string, format?: string): boolean => {
    if (format === 'code_128') return isValidCode128(code);
    return isValidEAN(code);
};

/** Mensagem que o operador entende, conforme o motivo de a câmera não abrir. */
const mensagemErroCamera = (error: any): string => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
        return 'A câmera só abre em endereço seguro (https). Acesse o sistema pelo link oficial ou use o modo Manual.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        return 'Este navegador não libera a câmera. Use o Chrome (Android) ou o Safari (iPhone), ou o modo Manual.';
    }
    switch (error?.name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Permissão da câmera negada. Toque no cadeado ao lado do endereço, libere a Câmera e tente de novo.';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'Nenhuma câmera encontrada neste aparelho.';
        case 'NotReadableError':
        case 'AbortError':
            return 'A câmera está em uso por outro app. Feche-o e tente de novo.';
        default:
            return `Não foi possível abrir a câmera${error?.message ? `: ${error.message}` : ''}.`;
    }
};

/** Câmera traseira principal: no Android a "camera2 0" é a principal; as outras costumam ser ultra-wide sem foco de perto. */
const ehTraseira = (d: MediaDeviceInfo) => /back|rear|traseira|environment/i.test(d.label);

const criarDecodificadorNativo = async (): Promise<Decodificador | null> => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) return null;
    try {
        const suportados: string[] = (await Detector.getSupportedFormats?.()) || [];
        if (!suportados.includes('ean_13')) return null;
        const formatos = ['ean_13', 'ean_8', 'upc_a', 'code_128'].filter(f => suportados.includes(f));
        const detector = new Detector({ formats: formatos });
        return async (video) => {
            const codigos = await detector.detect(video);
            return (codigos || []).map((c: any) => ({ codigo: String(c.rawValue || ''), formato: c.format }));
        };
    } catch {
        return null;
    }
};

const criarDecodificadorZXing = async (): Promise<Decodificador> => {
    const [{ Html5QrcodeShim }, { Html5QrcodeSupportedFormats }] = await Promise.all([
        import('html5-qrcode/esm/code-decoder'),
        import('html5-qrcode'),
    ]);
    const silencioso = { log() { }, warn() { }, logError() { }, logErrors() { } };
    const decodificador = new Html5QrcodeShim(
        [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.CODE_128,
        ],
        false,
        false,
        silencioso,
    );
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let quadro = 0;
    return async (video) => {
        const L = video.videoWidth;
        const A = video.videoHeight;
        if (!L || !A) return [];
        // Alterna a faixa central (onde fica a mira, ampliada) e o quadro inteiro: o ZXing
        // lê linha a linha, e uma faixa recortada em boa resolução resolve código pequeno.
        const faixa = quadro++ % 3 !== 2;
        const sx = faixa ? L * 0.1 : 0;
        const sy = faixa ? A * 0.3 : 0;
        const sw = faixa ? L * 0.8 : L;
        const sh = faixa ? A * 0.4 : A;
        const escala = Math.min(2, 1280 / sw);
        canvas.width = Math.round(sw * escala);
        canvas.height = Math.round(sh * escala);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        try {
            const r = await decodificador.decodeAsync(canvas);
            const nome = r.format?.formatName?.toLowerCase().replace(/-/g, '_');
            return r.text ? [{ codigo: r.text, formato: nome }] : [];
        } catch {
            return [];
        }
    };
};

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScan, onClose, onBuscarNome }) => {
    const [modoEntrada, setModoEntrada] = useState<'camera' | 'manual'>('camera');
    const [codigoManual, setCodigoManual] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [cameraAtiva, setCameraAtiva] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanSuccess, setScanSuccess] = useState(false);
    const [ultimoLido, setUltimoLido] = useState<string | null>(null);
    const [lanterna, setLanterna] = useState<{ suportada: boolean; ligada: boolean }>({ suportada: false, ligada: false });
    const [zoom, setZoom] = useState<{ min: number; max: number; valor: number } | null>(null);
    const [traseiras, setTraseiras] = useState<MediaDeviceInfo[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const execucaoRef = useRef(0); // invalida loops de leitura antigos ao reabrir/fechar
    const deviceIdRef = useRef<string | undefined>(undefined);

    // O loop de leitura vive mais que um render: sempre chama o onScan atual (PDV muda o carrinho a cada item).
    const onScanRef = useRef(onScan);
    useEffect(() => { onScanRef.current = onScan; }, [onScan]);

    const lastScanTimeRef = useRef<number>(0);
    const lastScanRef = useRef<string | null>(null);
    // Filtro de confiança: a mesma leitura válida N vezes seguidas.
    const scanCountRef = useRef<number>(0);
    const candidateRef = useRef<string>('');
    const candidateTimeRef = useRef<number>(0);

    const registrarLeitura = (code: string, format: string | undefined, leiturasExigidas: number) => {
        const now = Date.now();
        code = code.trim();
        if (!code || !isCodigoValido(code, format === 'code_128' ? 'code_128' : undefined)) return;

        // Debounce de 2s para o mesmo código (para não floodar quando já aceitou)
        if (code === lastScanRef.current && now - lastScanTimeRef.current < 2000) return;

        // Reseta a contagem se passar muito tempo (1 segundo)
        if (now - candidateTimeRef.current > 1000) {
            candidateRef.current = '';
            scanCountRef.current = 0;
        }

        if (code !== candidateRef.current) {
            candidateRef.current = code;
            scanCountRef.current = 1;
        } else {
            scanCountRef.current += 1;
        }
        candidateTimeRef.current = now;

        if (scanCountRef.current >= leiturasExigidas) {
            lastScanRef.current = code;
            lastScanTimeRef.current = now;
            candidateRef.current = '';
            scanCountRef.current = 0;
            setScanSuccess(true);
            setUltimoLido(code);
            setTimeout(() => setScanSuccess(false), 600);
            try { navigator.vibrate?.(80); } catch { /* sem vibração */ }
            onScanRef.current(code);
        }
    };

    // Este componente só é montado enquanto o scanner estiver aberto (sem prop isOpen),
    // então trava o scroll do fundo durante toda a vida do componente.
    useBodyScrollLock(true);

    const pararCamera = useCallback(() => {
        execucaoRef.current++;
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setCameraAtiva(false);
        setIsScanning(false);
        setLanterna({ suportada: false, ligada: false });
        setZoom(null);
    }, []);

    useEffect(() => pararCamera, [pararCamera]);

    // Foco contínuo, lanterna e zoom quando o aparelho oferece.
    const ajustarTrilha = async (track: MediaStreamTrack) => {
        const caps: any = (track as any).getCapabilities?.() || {};
        try {
            if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
            }
        } catch { /* foco fixo */ }
        setLanterna({ suportada: !!caps.torch, ligada: false });
        if (caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min ?? 1)) {
            const atual = (track.getSettings() as any).zoom ?? caps.zoom.min ?? 1;
            setZoom({ min: caps.zoom.min ?? 1, max: Math.min(caps.zoom.max, 5), valor: atual });
        } else {
            setZoom(null);
        }
    };

    const abrirStream = (deviceId?: string) => navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });

    const iniciarCamera = async (deviceId?: string) => {
        pararCamera();
        const execucao = execucaoRef.current;
        setErro(null);
        setIsScanning(true);

        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('sem-camera');

            let stream = await abrirStream(deviceId);
            if (execucao !== execucaoRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

            // Com a permissão dada, os nomes das câmeras aparecem: troca para a traseira principal no Android
            // quando o navegador abriu uma ultra-wide (não foca de perto e não lê código).
            try {
                const lista = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
                const back = lista.filter(ehTraseira);
                setTraseiras(back.length > 1 ? back : lista.length > 1 ? lista : []);
                if (!deviceId) {
                    const principal = back.find(d => /camera2 0\b/.test(d.label));
                    const atual = stream.getVideoTracks()[0]?.getSettings().deviceId;
                    if (principal && atual && principal.deviceId !== atual) {
                        stream.getTracks().forEach(t => t.stop());
                        stream = await abrirStream(principal.deviceId);
                        if (execucao !== execucaoRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
                    }
                }
            } catch { /* fica com a câmera que abriu */ }

            streamRef.current = stream;
            const track = stream.getVideoTracks()[0];
            deviceIdRef.current = track?.getSettings().deviceId;
            const video = videoRef.current;
            if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
            video.srcObject = stream;
            video.setAttribute('playsinline', 'true');
            video.muted = true;
            // play() pode ficar pendente até o 1º quadro chegar (ou ser recusado no iOS e seguir pelo
            // autoplay): não deixa a tela presa em "Abrindo a câmera"; o loop espera o vídeo ter imagem.
            await Promise.race([
                video.play().catch(() => undefined),
                new Promise(r => setTimeout(r, 2500)),
            ]);
            if (track) await ajustarTrilha(track);

            const nativo = await criarDecodificadorNativo();
            const decodificar = nativo ?? await criarDecodificadorZXing();
            const leiturasExigidas = 2;
            if (execucao !== execucaoRef.current) return;

            setCameraAtiva(true);
            setIsScanning(false);

            const loop = async () => {
                while (execucao === execucaoRef.current) {
                    if (video.readyState >= 2 && video.videoWidth > 0) {
                        try {
                            const lidos = await decodificar(video);
                            for (const l of lidos) registrarLeitura(l.codigo, l.formato, leiturasExigidas);
                        } catch { /* quadro sem imagem ainda: tenta no próximo */ }
                    }
                    await new Promise(r => setTimeout(r, nativo ? 100 : 60));
                }
            };
            void loop();
        } catch (error: any) {
            if (execucao !== execucaoRef.current) return;
            console.error('Erro ao abrir câmera:', error);
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setErro(mensagemErroCamera(error));
            setIsScanning(false);
            setCameraAtiva(false);
        }
    };

    // Abre direto na câmera; "Manual" continua disponível no seletor.
    useEffect(() => {
        void iniciarCamera();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const alternarLanterna = async () => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return;
        const ligar = !lanterna.ligada;
        try {
            await track.applyConstraints({ advanced: [{ torch: ligar } as any] });
            setLanterna({ suportada: true, ligada: ligar });
        } catch {
            setLanterna({ suportada: false, ligada: false });
        }
    };

    const aplicarZoom = async (valor: number) => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track || !zoom) return;
        setZoom({ ...zoom, valor });
        try { await track.applyConstraints({ advanced: [{ zoom: valor } as any] }); } catch { /* sem zoom */ }
    };

    const trocarCamera = () => {
        if (traseiras.length < 2) return;
        const idx = traseiras.findIndex(d => d.deviceId === deviceIdRef.current);
        const proxima = traseiras[(idx + 1) % traseiras.length];
        void iniciarCamera(proxima.deviceId);
    };

    // Mudar modo
    const handleModoChange = (modo: 'camera' | 'manual') => {
        if (modo === modoEntrada) return;
        setModoEntrada(modo);
        setErro(null);
        if (modo === 'camera') {
            // O <video> só existe depois do render do modo câmera.
            setTimeout(() => void iniciarCamera(deviceIdRef.current), 50);
        } else {
            pararCamera();
        }
    };

    // Com letras (e a tela aceita nome), o botão busca pelo nome em vez de tratar como código.
    const ehNome = !!onBuscarNome && /[a-zA-ZÀ-ÿ]/.test(codigoManual) && codigoManual.trim().length >= 3;

    // Enviar código manual
    const handleEnviarManual = (e: React.FormEvent) => {
        e.preventDefault();
        if (ehNome) {
            onBuscarNome?.(codigoManual.trim());
            setCodigoManual('');
            return;
        }
        if (codigoManual.trim()) {
            onScan(codigoManual.trim());
            setCodigoManual('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-stretch sm:items-center justify-center z-9999 sm:p-4">
            <div className="bg-white dark:bg-gray-800 sm:rounded-2xl shadow-2xl max-w-2xl w-full h-dvh sm:h-auto sm:max-h-[90dvh] overflow-hidden flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 sm:p-2.5 bg-blue-100 dark:bg-blue-900/50 rounded-xl shrink-0">
                            <Scan className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-white truncate">
                                Scanner de Produtos
                            </h2>
                            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
                                {modoEntrada === 'camera' ? 'Aponte a câmera para o código' : 'Digite o código de barras'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar scanner"
                        className="p-2.5 -mr-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                    >
                        <X className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                    </button>
                </div>

                {/* Seletor de Modo */}
                <div className="px-4 py-3 sm:px-6 sm:py-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex bg-gray-200 dark:bg-gray-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => handleModoChange('manual')}
                            className={`flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${modoEntrada === 'manual'
                                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                                }`}
                        >
                            <Keyboard className="w-4 h-4" />
                            <span>Manual</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleModoChange('camera')}
                            className={`flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${modoEntrada === 'camera'
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
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                    {modoEntrada === 'manual' ? (
                        <form onSubmit={handleEnviarManual} className="space-y-6">
                            <div className="space-y-2">
                                <label htmlFor="scanner-codigo-manual" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                    {onBuscarNome ? 'Código de barras ou nome do produto' : 'Código de Barras (EAN/UPC/Code-128)'}
                                </label>
                                <input
                                    id="scanner-codigo-manual"
                                    type="text"
                                    inputMode={onBuscarNome ? 'text' : 'numeric'}
                                    autoComplete="off"
                                    enterKeyHint="search"
                                    value={codigoManual}
                                    onChange={(e) => setCodigoManual(e.target.value)}
                                    placeholder={onBuscarNome ? 'Ex: 7891234567890 ou leite moça' : 'Ex: 7891234567890'}
                                    className={`w-full px-4 py-4 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 ${onBuscarNome ? 'text-lg' : 'text-xl sm:text-2xl font-mono'} bg-white dark:bg-gray-900 text-gray-800 dark:text-white transition-all outline-none`}
                                    autoFocus
                                />
                                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    <span className="text-xs">{onBuscarNome ? 'Digite o código ou o nome. Leitores USB funcionam aqui.' : 'Leitores USB funcionam automaticamente aqui'}</span>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={!codigoManual.trim()}
                                className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 shadow-lg transition-all ${codigoManual.trim()
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98]'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                    }`}
                            >
                                {ehNome ? <Search className="w-5 h-5" /> : <Scan className="w-5 h-5" />}
                                <span>{ehNome ? 'Buscar por nome' : (onBuscarNome ? 'Buscar pelo código' : 'Adicionar Produto')}</span>
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-4">
                            {erro ? (
                                <div className="p-6 bg-red-50 dark:bg-red-900/20 border-2 border-red-100 dark:border-red-900/30 rounded-2xl text-center">
                                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                                    <h3 className="text-lg font-bold text-red-800 dark:text-red-300 mb-2">Câmera indisponível</h3>
                                    <p className="text-sm text-red-700 dark:text-red-400 mb-4">{erro}</p>
                                    <div className="flex flex-col sm:flex-row gap-2 justify-center">
                                        <button
                                            type="button"
                                            onClick={() => void iniciarCamera()}
                                            className="px-6 py-3 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl font-semibold"
                                        >
                                            Tentar de novo
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleModoChange('manual')}
                                            className="px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors"
                                        >
                                            Usar Modo Manual
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                            <div className={`relative bg-gray-900 rounded-2xl overflow-hidden aspect-3/4 sm:aspect-4/3 max-h-[60dvh] w-full mx-auto shadow-inner border-2 border-gray-100 dark:border-gray-700 ${erro ? 'hidden' : ''}`}>
                                <video
                                    ref={videoRef}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    playsInline
                                    muted
                                    autoPlay
                                />
                                {isScanning && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 z-10">
                                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                                        <p className="text-sm text-gray-300">Abrindo a câmera…</p>
                                    </div>
                                )}
                                {cameraAtiva && !scanSuccess && (
                                    <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                                        <div className="relative w-[80%] h-[40%] max-w-sm">
                                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
                                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
                                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
                                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg"></div>
                                            <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse"></div>
                                        </div>
                                    </div>
                                )}
                                {scanSuccess && (
                                    <div className="absolute inset-0 bg-green-500/30 backdrop-blur-[2px] z-20 flex items-center justify-center">
                                        <CheckCircle2 className="w-16 h-16 text-green-500 bg-white dark:bg-green-900 rounded-full p-2" />
                                    </div>
                                )}
                                {cameraAtiva && (lanterna.suportada || traseiras.length > 1) && (
                                    <div className="absolute top-3 right-3 z-30 flex flex-col gap-2">
                                        {lanterna.suportada && (
                                            <button
                                                type="button"
                                                onClick={alternarLanterna}
                                                aria-label={lanterna.ligada ? 'Desligar lanterna' : 'Ligar lanterna'}
                                                className={`p-3 rounded-full backdrop-blur ${lanterna.ligada ? 'bg-yellow-400 text-gray-900' : 'bg-black/50 text-white'}`}
                                            >
                                                {lanterna.ligada ? <FlashlightOff className="w-5 h-5" /> : <Flashlight className="w-5 h-5" />}
                                            </button>
                                        )}
                                        {traseiras.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={trocarCamera}
                                                aria-label="Trocar câmera"
                                                className="p-3 rounded-full bg-black/50 text-white backdrop-blur"
                                            >
                                                <SwitchCamera className="w-5 h-5" />
                                            </button>
                                        )}
                                    </div>
                                )}
                                {cameraAtiva && zoom && (
                                    <div className="absolute bottom-3 left-3 right-3 z-30 flex items-center gap-2 bg-black/50 backdrop-blur rounded-full px-3 py-2">
                                        <ZoomIn className="w-4 h-4 text-white shrink-0" />
                                        <input
                                            type="range"
                                            aria-label="Zoom da câmera"
                                            min={zoom.min}
                                            max={zoom.max}
                                            step={0.1}
                                            value={zoom.valor}
                                            onChange={(e) => void aplicarZoom(Number(e.target.value))}
                                            className="flex-1 accent-white"
                                        />
                                    </div>
                                )}
                            </div>
                            {!erro && (
                                <p className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                    {ultimoLido
                                        ? <>Último lido: <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{ultimoLido}</span></>
                                        : 'Deixe o código inteiro dentro da mira, a um palmo da câmera. Se não focar, afaste um pouco ou use o zoom.'}
                                </p>
                            )}
                            <p className="hidden sm:block text-center text-[11px] text-gray-400">EAN-13, EAN-8, UPC-A e Code-128.</p>
                        </div>
                    )}
                </div>

                <div className="px-4 py-3 sm:p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">MercadinhoSys PDV</p>
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors">
                        Concluído
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BarcodeScanner;
