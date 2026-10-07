import { useState, type ReactNode } from 'react';
import { apiClient } from '../../api/apiClient';

export function ProtectedDocumentLink({ url, children, className, title }: {
  url: string; children: ReactNode; className?: string; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function openDocument() {
    setError('');
    if (!url.startsWith('/uploads/')) {
      try {
        const external = new URL(url);
        if (external.protocol !== 'https:') throw new Error('invalid URL');
        window.open(external.href, '_blank', 'noopener,noreferrer');
      } catch { setError('Não foi possível abrir o documento.'); }
      return;
    }
    const preview = window.open('about:blank', '_blank');
    if (preview) preview.opener = null;
    setBusy(true);
    try {
      const response = await apiClient.get<Blob>(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(response.data);
      if (preview) preview.location.href = blobUrl;
      else {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = url.split('/').pop() || 'documento';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch {
      preview?.close();
      setError('Não foi possível abrir o documento.');
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className={className} title={title} disabled={busy} aria-busy={busy} onClick={openDocument}>
      {children}
    </button>
    {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
  </>;
}
