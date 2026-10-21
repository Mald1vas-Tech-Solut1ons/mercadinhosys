/**
 * Leitura de QR Code de cupom fiscal.
 *
 * Um QR de cupom fiscal tem 49+ módulos (contra ~25 de um QR de link), sai
 * impresso pequeno em papel térmico e, na foto, costuma ocupar uma fração da
 * imagem. Isso derruba leitor genérico: o `scanFile` do html5-qrcode
 * redimensiona a foto inteira antes de decodificar, e o QR desaparece no
 * encolhimento. Foi exatamente o que aconteceu com o cupom do Tenda — o leitor
 * nativo do celular leu de primeira e o do sistema não lia de jeito nenhum.
 *
 * A estratégia aqui é insistir com tratamentos progressivos, do mais barato ao
 * mais caro, em vez de tentar uma vez e desistir:
 *
 *   1. imagem inteira, em resolução cheia;
 *   2. imagem ampliada 2x (QR pequeno ganha módulos);
 *   3. imagem binarizada (papel térmico apagado ganha contraste);
 *   4. varredura em grade 3x3 com sobreposição, cada pedaço ampliado — este é
 *      o passo que resolve a foto do cupom INTEIRO, onde o QR é um detalhe.
 *
 * Cada passo roda no decodificador nativo do aparelho (BarcodeDetector, a mesma
 * API do app de câmera do Android) quando existe, e no jsQR quando não existe —
 * hoje, iPhone e navegador de desktop.
 */
import jsQR from 'jsqr';

interface CodigoDetectado {
  rawValue: string;
}

interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource | ImageBitmap): Promise<CodigoDetectado[]>;
}

interface ConstrutorDetector {
  new (opcoes?: { formats?: string[] }): DetectorDeCodigo;
}

/** Etapas relatadas para a interface poder dizer o que está acontecendo. */
export type EtapaLeitura = 'lendo' | 'ampliando' | 'realcando' | 'varrendo';

function construtorNativo(): ConstrutorDetector | null {
  const jan = window as unknown as { BarcodeDetector?: ConstrutorDetector };
  return jan.BarcodeDetector ?? null;
}

export function temDetectorNativo(): boolean {
  return construtorNativo() !== null;
}

export function criarDetector(): DetectorDeCodigo | null {
  const Construtor = construtorNativo();
  if (!Construtor) return null;
  try {
    return new Construtor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

function novoCanvas(largura: number, altura: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(largura));
  canvas.height = Math.max(1, Math.round(altura));
  return canvas;
}

/** Recorta e amplia um pedaço da fonte. Módulo de QR é quadrado: não suavizar. */
function recortar(
  fonte: CanvasImageSource,
  x: number, y: number, largura: number, altura: number,
  escala = 1,
): HTMLCanvasElement {
  const canvas = novoCanvas(largura * escala, altura * escala);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fonte, x, y, largura, altura, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Binariza pela média — resgata impressão fraca e sombra suave. */
function realcar(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let soma = 0;
  for (let i = 0; i < d.length; i += 4) soma += (d[i] + d[i + 1] + d[i + 2]) / 3;
  const media = soma / (d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3 > media ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Roda os dois decodificadores sobre um canvas já preparado. */
async function decodificar(canvas: HTMLCanvasElement, detector: DetectorDeCodigo | null): Promise<string | null> {
  if (detector) {
    try {
      const codigos = await detector.detect(canvas);
      const valor = codigos?.[0]?.rawValue?.trim();
      if (valor) return valor;
    } catch {
      // Detector nativo pode recusar canvas muito grande; segue para o jsQR.
    }
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const achado = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    const valor = achado?.data?.trim();
    if (valor) return valor;
  } catch {
    // Canvas grande demais para getImageData: as etapas seguintes usam pedaços.
  }

  return null;
}

/** Limita o lado maior, para caber na memória do celular sem perder o QR. */
const LADO_MAXIMO = 2400;

/**
 * Carrega a imagem sem depender de createImageBitmap, que falta em navegador
 * antigo. Sem isso, escolher uma foto lançava exceção em vez de simplesmente
 * não achar o código.
 */
async function carregarImagem(arquivo: File | Blob): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; encerrar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(arquivo);
    return { fonte: bitmap, largura: bitmap.width, altura: bitmap.height, encerrar: () => bitmap.close?.() };
  }

  const url = URL.createObjectURL(arquivo);
  const img = new Image();
  await new Promise<void>((ok, falhou) => {
    // Prazo obrigatório: sem ele, uma imagem que nunca dispara load nem error
    // deixa a tela presa em "Lendo..." para sempre.
    const prazo = setTimeout(() => falhou(new Error('imagem demorou demais')), 10_000);
    img.onload = () => { clearTimeout(prazo); ok(); };
    img.onerror = () => { clearTimeout(prazo); falhou(new Error('imagem ilegível')); };
    img.src = url;
  });
  return {
    fonte: img,
    largura: img.naturalWidth,
    altura: img.naturalHeight,
    encerrar: () => URL.revokeObjectURL(url),
  };
}

export async function lerQrDeImagem(
  arquivo: File | Blob,
  aoProgredir?: (etapa: EtapaLeitura) => void,
): Promise<string | null> {
  const detector = criarDetector();

  let imagem: Awaited<ReturnType<typeof carregarImagem>>;
  try {
    imagem = await carregarImagem(arquivo);
  } catch {
    return null;
  }

  const { fonte, largura, altura, encerrar } = imagem;
  const escalaEntrada = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));

  let base: HTMLCanvasElement;
  let L: number;
  let A: number;
  try {
    base = recortar(fonte, 0, 0, largura, altura, escalaEntrada);
    L = base.width;
    A = base.height;
  } catch {
    // Ambiente sem canvas 2D: não há como decodificar, mas também não há motivo
    // para explodir na cara de quem só escolheu uma foto.
    encerrar();
    return null;
  }

  try {
    aoProgredir?.('lendo');
    const direto = await decodificar(base, detector);
    if (direto) return direto;

    aoProgredir?.('ampliando');
    const ampliada = await decodificar(recortar(base, 0, 0, L, A, 2), detector);
    if (ampliada) return ampliada;

    aoProgredir?.('realcando');
    const realcada = await decodificar(realcar(recortar(base, 0, 0, L, A, 1)), detector);
    if (realcada) return realcada;

    // Varredura em grade: a foto do cupom inteiro tem o QR ocupando pouco da
    // imagem. Cada célula sobrepõe a vizinha em 50% para o QR nunca cair
    // exatamente em cima de uma divisa.
    aoProgredir?.('varrendo');
    const colunas = 3;
    const linhas = 3;
    const larguraCelula = L / colunas;
    const alturaCelula = A / linhas;

    for (let linha = 0; linha < linhas * 2 - 1; linha++) {
      for (let coluna = 0; coluna < colunas * 2 - 1; coluna++) {
        const x = (coluna * larguraCelula) / 2;
        const y = (linha * alturaCelula) / 2;
        const pedaco = recortar(base, x, y, larguraCelula, alturaCelula, 2);

        const achado = await decodificar(pedaco, detector);
        if (achado) return achado;

        const comRealce = await decodificar(realcar(pedaco), detector);
        if (comRealce) return comRealce;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    encerrar();
  }
}

/**
 * Lê continuamente do vídeo até achar um QR. Devolve uma função para parar.
 * Usa o quadro inteiro em resolução cheia — sem a janela de recorte que faz o
 * leitor genérico jogar fora justamente a região do código.
 */
export function lerQrDeVideo(
  video: HTMLVideoElement,
  aoAchar: (valor: string) => void,
): () => void {
  const detector = criarDetector();
  let parado = false;
  let quadro = 0;

  const rodar = async () => {
    while (!parado) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const L = video.videoWidth;
        const A = video.videoHeight;
        try {
          // Alterna quadro cheio, centro ampliado e quadro realçado: cobre QR
          // longe, QR pequeno no centro da mira e impressão apagada.
          let canvas: HTMLCanvasElement;
          if (quadro % 3 === 1) {
            canvas = recortar(video, L * 0.15, A * 0.15, L * 0.7, A * 0.7, 2);
          } else if (quadro % 3 === 2) {
            canvas = realcar(recortar(video, 0, 0, L, A, 1));
          } else {
            canvas = recortar(video, 0, 0, L, A, 1);
          }

          const valor = await decodificar(canvas, detector);
          if (valor) {
            parado = true;
            aoAchar(valor);
            return;
          }
        } catch {
          // Quadro ruim: tenta o próximo.
        }
        quadro++;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  void rodar();
  return () => {
    parado = true;
  };
}
