import { useRef, useState, type ChangeEvent, type FC } from 'react';
import { Camera, ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { mensagemErro } from '../../utils/mensagemErro';
import { showToast } from '../../utils/toast';

interface FotoUploadProps {
  valor: string;
  onChange: (url: string) => void;
  pasta?: 'produtos' | 'perfil';
  redondo?: boolean;
  rotulo?: string;
}

const MAX_SIZE = 8 * 1024 * 1024;
const botaoClass =
  'inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';

/** Foto por upload (câmera ou galeria); o servidor reduz e guarda no Cloudinary. */
const FotoUpload: FC<FotoUploadProps> = ({ valor, onChange, pasta = 'produtos', redondo = false, rotulo }) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    try {
      if (!file) return;
      if (file.size > MAX_SIZE) {
        showToast.error('Foto muito grande (máximo 8 MB).');
        return;
      }
      setEnviando(true);
      const fd = new FormData();
      fd.append('imagem', file);
      fd.append('pasta', pasta);
      const r = await apiClient.post<{ success: boolean; imagem_url: string }>('/produtos/imagem', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(r.data.imagem_url);
      showToast.success('Foto enviada.');
    } catch (err) {
      showToast.error(mensagemErro(err));
    } finally {
      input.value = '';
      setEnviando(false);
    }
  };

  const forma = redondo ? 'rounded-full' : 'rounded-xl';

  return (
    <div className="w-full">
      {rotulo && <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{rotulo}</label>}
      <div className="flex items-center gap-4 flex-wrap">
        <div className={`relative w-24 h-24 shrink-0 overflow-hidden border border-gray-200 dark:border-gray-700 ${forma}`}>
          {valor ? (
            <img src={valor} alt="Foto" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
              <ImagePlus className="w-8 h-8" />
            </div>
          )}
          {enviando && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" disabled={enviando} onClick={() => cameraRef.current?.click()} className={botaoClass}>
            <Camera className="w-4 h-4" /> Tirar foto
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          <button type="button" disabled={enviando} onClick={() => galeriaRef.current?.click()} className={botaoClass}>
            <ImagePlus className="w-4 h-4" /> Escolher da galeria
          </button>
          <input ref={galeriaRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {valor && (
            <button type="button" disabled={enviando} onClick={() => onChange('')} className={botaoClass}>
              <Trash2 className="w-4 h-4" /> Remover
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FotoUpload;
