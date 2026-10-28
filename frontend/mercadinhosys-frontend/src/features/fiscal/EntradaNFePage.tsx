import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileInput } from 'lucide-react';
import EntradaNotaPanel from './EntradaNotaPanel';

/**
 * Tela de entrada de nota do fornecedor (/entrada-nfe) — liberada em QUALQUER plano.
 *
 * Também é o destino do Web Share Target do PWA (vite.config.ts → manifest.share_target):
 * o Android abre /entrada-nfe?title=...&text=...&url=... com o link do QR Code lido
 * pela câmera nativa. `?ler=1` abre o leitor direto (botão da tela de Produtos).
 */
export default function EntradaNFePage() {
    const [params] = useSearchParams();
    const compartilhado = useMemo(() => {
        // Apps diferentes põem o link em campos diferentes; o primeiro com URL ou 44 dígitos vence.
        const candidatos = [params.get('url'), params.get('text'), params.get('title'), params.get('qr')];
        return candidatos.find(c => c && (/https?:\/\//i.test(c) || /\d{44}/.test(c.replace(/\s/g, '')))) || undefined;
    }, [params]);

    return (
        <div className="p-4 md:p-6 space-y-5">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary-600 text-white"><FileInput className="w-6 h-6" /></div>
                <div>
                    <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">Entrada de nota</h1>
                    <p className="text-sm text-slate-500 dark:text-gray-400">Dê entrada no estoque pela nota do fornecedor: XML, QR Code do cupom ou chave do DANFE.</p>
                </div>
            </div>
            <EntradaNotaPanel abrirLeitor={params.get('ler') === '1' && !compartilhado} textoCompartilhado={compartilhado} />
        </div>
    );
}
