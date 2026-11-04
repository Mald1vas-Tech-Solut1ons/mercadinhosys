import React, { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';
import { CHAVE_CONSENTIMENTO, VERSAO_CONSENTIMENTO, lerEscolhaCookies } from './consentimento';

/*
 * Consentimento de cookies (LGPD) das páginas públicas.
 * Essenciais (login, preferências) sempre ligados; medição de uso do site só com o "Aceitar".
 * Quem lê a escolha é a telemetria: `podeMedirUso()` (consentimento.ts) precisa dar true antes de qualquer envio.
 */
const BannerCookies: React.FC = () => {
    const [aberto, setAberto] = useState(false);

    useEffect(() => {
        // Depois da vinheta da landing, para não cobrir a abertura.
        const t = setTimeout(() => setAberto(lerEscolhaCookies() === null), 3200);
        return () => clearTimeout(t);
    }, []);

    const salvar = (medicao: boolean) => {
        try {
            localStorage.setItem(CHAVE_CONSENTIMENTO, JSON.stringify({ medicao, em: new Date().toISOString(), versao: VERSAO_CONSENTIMENTO }));
        } catch { /* navegador sem armazenamento: só fecha */ }
        window.dispatchEvent(new CustomEvent('consentimento-cookies', { detail: { medicao } }));
        setAberto(false);
    };

    if (!aberto) return null;

    return (
        <div role="dialog" aria-label="Aviso de cookies"
            className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:left-6 sm:bottom-6 sm:max-w-md z-[150] rounded-2xl bg-[#101C31] border border-[#24344F] shadow-2xl p-5 text-[#DCE8F7] font-['Space_Grotesk',sans-serif]"
            style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
            <p className="flex items-center gap-2 font-bold text-white mb-2"><Cookie className="w-5 h-5 text-[#FFD43B]" /> Sua privacidade</p>
            <p className="text-sm text-[#8FA3C0] mb-4">
                Usamos cookies essenciais para o site funcionar e, se você permitir, cookies de medição para entender como o site é usado e melhorá-lo.
                Saiba mais na <a href="/privacidade" className="text-[#6FCBFF] underline">Política de Privacidade</a>.
            </p>
            <div className="flex gap-2">
                <button type="button" onClick={() => salvar(false)} className="flex-1 py-2.5 rounded-xl border border-[#24344F] text-sm font-bold text-[#DCE8F7] hover:bg-[#0A1220]">
                    Só os essenciais
                </button>
                <button type="button" onClick={() => salvar(true)} className="flex-1 py-2.5 rounded-xl bg-[#2E9BFF] text-[#0A1220] text-sm font-black hover:bg-[#6FCBFF]">
                    Aceitar todos
                </button>
            </div>
        </div>
    );
};

export default BannerCookies;
