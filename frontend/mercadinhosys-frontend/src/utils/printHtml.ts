/**
 * Abre o diálogo de impressão do navegador para um documento HTML completo,
 * direto do clique — sem pop-up e sem o usuário precisar de "botão direito →
 * Imprimir".
 *
 * Por que iframe oculto e não window.open:
 * - Pop-up é bloqueado quando o open() acontece depois de um await.
 * - Documento about:blank / blob: / srcdoc HERDA a CSP do app (script-src
 *   'self' em produção): <script> inline e onclick="window.print()" dentro
 *   dele não rodam — a janela abria e o botão "Imprimir" não fazia nada.
 *   Aqui quem chama print() é o próprio app (código do bundle), então o HTML
 *   impresso não precisa de script nenhum.
 */
export function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // Fora da tela mas renderizado: display:none faz alguns navegadores imprimirem página em branco
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';

  let removido = false;
  const remover = () => {
    if (removido) return;
    removido = true;
    iframe.remove();
  };

  iframe.addEventListener('load', async () => {
    const win = iframe.contentWindow;
    if (!win) return remover();
    // Fonte web (ex.: cupom em Courier Prime) pronta antes de rasterizar
    try { await win.document.fonts?.ready; } catch { /* sem FontFaceSet: segue */ }
    // Safari dispara afterprint antes de terminar de gerar a impressão: folga antes de remover
    win.addEventListener('afterprint', () => setTimeout(remover, 1000), { once: true });
    win.focus();
    win.print();
    setTimeout(remover, 60_000); // fallback se afterprint não disparar
  }, { once: true });

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
