import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface ImageZoomModalProps {
    src: string | null;
    alt?: string;
    onClose: () => void;
}

/**
 * Visualizador universal de foto de produto — clique na miniatura em
 * qualquer lugar do sistema (PDV, carrinho, lista, hub, cadastro) abre a
 * imagem em tamanho grande. z-300: acima de qualquer modal comum
 * (z-[200]/z-[210]), porque pode ser aberto de dentro de outro modal
 * (ex.: zoom da foto durante o cadastro do produto).
 */
const ImageZoomModal: React.FC<ImageZoomModalProps> = ({ src, alt, onClose }) => {
    useBodyScrollLock(!!src);

    useEffect(() => {
        if (!src) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [src, onClose]);

    if (!src) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-300 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-150"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={alt || 'Imagem do produto'}
        >
            <button
                onClick={onClose}
                className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Fechar"
            >
                <X className="w-6 h-6" />
            </button>
            <div
                className="max-w-[92vw] max-h-[85dvh] flex flex-col items-center animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={src}
                    alt={alt || 'Imagem do produto'}
                    className="max-w-full max-h-[75dvh] rounded-2xl shadow-2xl object-contain bg-white"
                />
                {alt && (
                    <p className="mt-4 text-white font-semibold text-center text-sm sm:text-base px-4">
                        {alt}
                    </p>
                )}
            </div>
        </div>,
        document.body
    );
};

export default ImageZoomModal;
