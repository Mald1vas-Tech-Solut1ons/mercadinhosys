/**
 * Leitor da nota: QR Code da NFC-e ou chave do DANFE.
 *
 * Porte do ScannerQRCodeModal do MiseOn:
 * - Câmera: BarcodeDetector NATIVO do aparelho (Android/Chrome) sobre o vídeo em
 *   resolução cheia; sem ele (iPhone), cai no html5-qrcode.
 * - Foto: lê o QR de uma imagem da galeria, com ampliação/realce/varredura (lib/lerQrCode).
 * - Colar: URL do QR (lida pela câmera nativa e copiada) ou os 44 dígitos do DANFE.
 *
 * O BarcodeScanner do PDV (Quagga) não serve aqui: não lê QR e recusa Code-128
 * com mais de 30 caracteres (a chave do DANFE tem 44). Leitor de mão USB/Bluetooth
 * funciona na aba "Colar", porque ele "digita" a chave e o Enter.
 */
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Image as ImageIcon, Keyboard, Loader2, QrCode, X, Zap, ZapOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { temDetectorNativo, lerQrDeImagem, lerQrDeVideo, type EtapaLeitura } from '../../lib/lerQrCode';
import { interpretarLeitura } from './chaveAcesso';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

async function abrirCamera(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('SEM_SUPORTE');
    // Do pedido mais rico ao mais simples: há aparelho que recusa 1080p inteiro em vez de negociar.
    const pedidos: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: { ideal: 'environment' } } },
        { video: true },
    ];
    let ultimo: unknown;
    for (const pedido of pedidos) {
        try {
            return await navigator.mediaDevices.getUserMedia(pedido);
        } catch (e) {
            ultimo = e;
            if ((e as DOMException)?.name === 'NotAllowedError') break;
        }
    }
    throw ultimo;
}

function explicarErroCamera(erro: unknown): string {
    const nome = (erro as DOMException)?.name ?? (erro as Error)?.message;
    switch (nome) {
        case 'NotAllowedError':
            return 'A permissão da câmera está bloqueada para este site. Libere a Câmera no cadeado ao lado do endereço e toque em "Câmera" de novo. A aba "Foto" funciona enquanto isso.';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'Não encontrei câmera neste aparelho. Use a aba "Foto" ou "Colar".';
        case 'NotReadableError':
            return 'A câmera está ocupada por outro aplicativo. Feche o outro app ou use a aba "Foto".';
        case 'SEM_SUPORTE':
            return 'Este navegador não libera a câmera para páginas (é preciso HTTPS). Use a aba "Foto" ou "Colar".';
        default:
            return 'Não consegui abrir a câmera. Use a aba "Foto": funciona com uma imagem da galeria.';
    }
}

const TEXTO_ETAPA: Record<EtapaLeitura, string> = {
    lendo: 'Procurando o QR Code na imagem...',
    ampliando: 'Ampliando a imagem...',
    realcando: 'Realçando o contraste...',
    varrendo: 'Varrendo a foto por partes...',
};

type Modo = 'CAMERA' | 'FOTO' | 'COLAR';

interface Props {
    onFechar: () => void;
    onLido: (texto: string) => void;
    carregando?: boolean;
    modoInicial?: Modo;
    valorInicial?: string;
}

export default function LerNotaModal({ onFechar, onLido, carregando, modoInicial = 'CAMERA', valorInicial = '' }: Props) {
    useBodyScrollLock(true);
    const [modo, setModo] = useState<Modo>(modoInicial);
    const [texto, setTexto] = useState(valorInicial);
    const [erroCamera, setErroCamera] = useState<string | null>(null);
    const [erroFoto, setErroFoto] = useState<string | null>(null);
    const [etapa, setEtapa] = useState<EtapaLeitura | null>(null);
    const [temLanterna, setTemLanterna] = useState(false);
    const [lanterna, setLanterna] = useState(false);
    const [nativo, setNativo] = useState(false);
    const [tentativa, setTentativa] = useState(0);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const pararRef = useRef<(() => void) | null>(null);
    const fallbackRef = useRef<Html5Qrcode | null>(null);
    const inputFotoRef = useRef<HTMLInputElement | null>(null);
    const containerFallbackId = 'leitor-nota-fallback';

    useEffect(() => {
        if (modo !== 'CAMERA' || carregando) return;
        let cancelado = false;
        const entregar = (valor: string) => {
            if (cancelado) return;
            cancelado = true;
            if (navigator.vibrate) navigator.vibrate(100);
            onLido(valor);
        };

        const iniciar = async () => {
            setErroCamera(null);
            if (temDetectorNativo()) {
                try {
                    const stream = await abrirCamera();
                    if (cancelado) { stream.getTracks().forEach(t => t.stop()); return; }
                    streamRef.current = stream;
                    setNativo(true);
                    const video = videoRef.current;
                    if (video) {
                        video.srcObject = stream;
                        video.setAttribute('playsinline', 'true');
                        await video.play().catch(() => {});
                        pararRef.current = lerQrDeVideo(video, entregar);
                    }
                    const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined;
                    if (caps?.torch) setTemLanterna(true);
                    return;
                } catch (err) {
                    const nome = (err as DOMException)?.name;
                    if (nome === 'NotAllowedError' || nome === 'NotReadableError' || nome === 'NotFoundError') {
                        setErroCamera(explicarErroCamera(err));
                        return;
                    }
                }
            }
            // Sem BarcodeDetector (iPhone, desktop): html5-qrcode.
            try {
                setNativo(false);
                const scanner = new Html5Qrcode(containerFallbackId, { verbose: false });
                fallbackRef.current = scanner;
                await scanner.start(
                    { facingMode: 'environment' },
                    {
                        fps: 10,
                        qrbox: (l: number, a: number) => {
                            const lado = Math.floor(Math.min(l, a) * 0.9);
                            return { width: lado, height: lado };
                        },
                        videoConstraints: {
                            facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 },
                            focusMode: 'continuous',
                        } as unknown as MediaTrackConstraints,
                    },
                    entregar,
                    () => {},
                );
            } catch (err) {
                setErroCamera(explicarErroCamera(err));
            }
        };
        void iniciar();

        return () => {
            cancelado = true;
            pararRef.current?.();
            pararRef.current = null;
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            if (fallbackRef.current?.isScanning) fallbackRef.current.stop().catch(() => {});
            fallbackRef.current = null;
        };
    }, [modo, carregando, onLido, tentativa]);

    const alternarLanterna = async () => {
        const trilha = streamRef.current?.getVideoTracks()[0];
        if (!trilha) return;
        try {
            await trilha.applyConstraints({ advanced: [{ torch: !lanterna }] } as unknown as MediaTrackConstraints);
            setLanterna(v => !v);
        } catch { setTemLanterna(false); }
    };

    const lerFoto = async (arquivo: File) => {
        setErroFoto(null);
        setEtapa('lendo');
        try {
            const valor = await lerQrDeImagem(arquivo, setEtapa);
            if (valor) { onLido(valor); return; }
            setErroFoto('Não achei o QR Code nessa imagem. Tire outra foto com o cupom esticado, o QR ocupando boa parte do quadro e sem sombra.');
        } catch {
            setErroFoto('Não consegui abrir essa imagem. Tente uma foto em JPG ou PNG.');
        } finally { setEtapa(null); }
    };

    const leitura = texto.trim() ? interpretarLeitura(texto) : null;
    const enviar = (e: React.FormEvent) => {
        e.preventDefault();
        if (texto.trim()) onLido(texto.trim());
    };

    const aba = (alvo: Modo) => `flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition ${modo === alvo
        ? 'bg-white dark:bg-slate-900 text-primary-600 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`;

    return (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4" onClick={onFechar}>
            <div className="relative w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 max-h-[95dvh] overflow-y-auto"
                style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
                <button type="button" onClick={onFechar} className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600" aria-label="Fechar"><X size={22} /></button>
                <div className="flex items-center gap-2 mb-4 pr-8">
                    <div className="rounded-xl bg-primary-100 dark:bg-primary-900/30 p-2.5 text-primary-600"><QrCode size={22} /></div>
                    <div>
                        <h3 className="font-black text-base text-slate-900 dark:text-white">Ler nota fiscal</h3>
                        <p className="text-xs text-slate-500">QR Code do cupom (NFC-e SP) ou chave do DANFE</p>
                    </div>
                </div>

                <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 mb-4">
                    <button type="button" onClick={() => setModo('CAMERA')} className={aba('CAMERA')}><Camera size={14} /> Câmera</button>
                    <button type="button" onClick={() => setModo('FOTO')} className={aba('FOTO')}><ImageIcon size={14} /> Foto</button>
                    <button type="button" onClick={() => setModo('COLAR')} className={aba('COLAR')}><Keyboard size={14} /> Colar URL</button>
                </div>

                {carregando ? (
                    <div className="flex flex-col items-center py-12 text-center">
                        <Loader2 size={36} className="animate-spin text-primary-600 mb-3" />
                        <p className="font-bold text-sm text-slate-900 dark:text-white">Consultando a nota...</p>
                        <p className="text-xs text-slate-500 mt-1">Buscando itens, quantidades e valores.</p>
                    </div>
                ) : modo === 'CAMERA' ? (
                    <div className="space-y-3">
                        {erroCamera ? (
                            <div className="rounded-xl bg-warning-50 dark:bg-warning-900/20 p-4 text-sm text-warning-800 dark:text-warning-200">
                                <p className="flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{erroCamera}</p>
                                <button type="button" onClick={() => setTentativa(t => t + 1)} className="mt-3 text-xs font-bold underline">Tentar de novo</button>
                            </div>
                        ) : (
                            <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
                                <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${nativo ? '' : 'hidden'}`} />
                                <div id={containerFallbackId} className={nativo ? 'hidden' : 'h-full w-full'} />
                                {temLanterna && (
                                    <button type="button" onClick={alternarLanterna} className="absolute bottom-3 right-3 rounded-full bg-black/60 p-3 text-white" aria-label="Lanterna">
                                        {lanterna ? <ZapOff size={20} /> : <Zap size={20} />}
                                    </button>
                                )}
                            </div>
                        )}
                        <p className="text-xs text-slate-500">Aponte para o QR Code do cupom. Se não ler, use a aba <b>Foto</b>: a imagem parada lê melhor papel térmico apagado.</p>
                    </div>
                ) : modo === 'FOTO' ? (
                    <div className="space-y-3">
                        <button type="button" onClick={() => inputFotoRef.current?.click()} disabled={!!etapa}
                            className="w-full rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                            {etapa ? <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary-600" /> : <ImageIcon className="w-8 h-8 mx-auto text-slate-400" />}
                            <p className="mt-2 font-bold text-sm text-slate-700 dark:text-slate-200">{etapa ? TEXTO_ETAPA[etapa] : 'Tirar foto ou escolher da galeria'}</p>
                        </button>
                        <input ref={inputFotoRef} type="file" accept="image/*" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) void lerFoto(f); e.currentTarget.value = ''; }} />
                        {erroFoto && <p className="rounded-lg bg-error-50 dark:bg-error-900/20 p-3 text-sm text-error-700 dark:text-error-300">{erroFoto}</p>}
                    </div>
                ) : (
                    <form onSubmit={enviar} className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                            URL do QR Code ou chave de 44 dígitos
                            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} autoFocus
                                placeholder="https://www.nfce.fazenda.sp.gov.br/qrcode?p=3526...  ou  3526 0801 1575 ..."
                                className="mt-2 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm font-mono break-all"
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (texto.trim()) onLido(texto.trim()); } }} />
                        </label>
                        {leitura && (leitura.tipo === 'erro'
                            ? <p className="flex gap-2 text-xs text-error-600"><AlertCircle className="w-4 h-4 shrink-0" />{leitura.erro}</p>
                            : <p className="flex gap-2 text-xs text-success-700 dark:text-success-400"><CheckCircle2 className="w-4 h-4 shrink-0" />
                                {leitura.tipo === 'qrcode_sp' ? `NFC-e de SP nº ${leitura.info.numero}: os itens serão lidos na SEFAZ.`
                                    : `${leitura.info.modelo === '55' ? 'NF-e' : 'NFC-e'} ${leitura.info.uf} nº ${leitura.info.numero}/${leitura.info.serie}: chave válida.`}
                            </p>)}
                        <button type="submit" disabled={!leitura || leitura.tipo === 'erro'}
                            className="w-full rounded-xl bg-primary-600 py-3 font-bold text-white disabled:opacity-50">Consultar</button>
                        <p className="text-xs text-slate-500">Dica (Android): leia o QR com a câmera do próprio celular e toque em <b>Compartilhar → MercadinhoSyS</b>; a nota abre aqui já preenchida.</p>
                    </form>
                )}
            </div>
        </div>
    );
}
