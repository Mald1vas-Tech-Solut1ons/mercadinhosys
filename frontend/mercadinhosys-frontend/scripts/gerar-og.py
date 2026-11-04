"""Gera as imagens de compartilhamento (Open Graph, 1200x630) das páginas públicas.

É a imagem que aparece quando alguém manda o link no WhatsApp, no Facebook ou no
LinkedIn. Uma por página: inicial, cada segmento e cada região, a partir dos mesmos
JSONs do site. Rodar no Windows quando mudar o texto dos nichos/regiões e versionar:

    python scripts/gerar-og.py

Saída: public/og/<pagina>.png (o seo-prerender.mjs aponta cada página para a sua).
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "src" / "features" / "landing"
SAIDA = RAIZ / "public" / "og"
FONTES = Path("C:/Windows/Fonts")
LARGURA, ALTURA = 1200, 630

AZUL_FUNDO = (10, 18, 32)
AZUL = (46, 155, 255)
AMARELO = (255, 212, 59)
BRANCO = (255, 255, 255)
CINZA = (143, 163, 192)


def fonte(nome, tamanho):
    return ImageFont.truetype(str(FONTES / nome), tamanho)


def quebrar(desenho, texto, f, largura_max):
    linhas, atual = [], ""
    for palavra in texto.split():
        teste = f"{atual} {palavra}".strip()
        if desenho.textlength(teste, font=f) <= largura_max:
            atual = teste
        else:
            linhas.append(atual)
            atual = palavra
    linhas.append(atual)
    return linhas


def gerar(nome_arquivo, selo, titulo, destaque):
    img = Image.new("RGB", (LARGURA, ALTURA), AZUL_FUNDO)
    d = ImageDraw.Draw(img)
    # Brilho azul no canto, como na landing.
    brilho = Image.new("L", (LARGURA, ALTURA), 0)
    ImageDraw.Draw(brilho).ellipse((650, -350, 1450, 450), fill=70)
    img.paste(Image.new("RGB", (LARGURA, ALTURA), (29, 78, 216)), (0, 0), brilho)
    d = ImageDraw.Draw(img)

    logo = Image.open(RAIZ / "public" / "assets" / "logo.png").convert("RGBA").resize((86, 87))
    img.paste(logo, (64, 52), logo)
    d.text((168, 66), "Mercadinho", font=fonte("segoeuib.ttf", 46), fill=BRANCO)
    largura_marca = d.textlength("Mercadinho", font=fonte("segoeuib.ttf", 46))
    d.text((168 + largura_marca, 66), "Sys", font=fonte("segoeuib.ttf", 46), fill=(255, 106, 92))

    f_selo = fonte("segoeuib.ttf", 24)
    largura_selo = d.textlength(selo.upper(), font=f_selo) + 40
    d.rounded_rectangle((64, 172, 64 + largura_selo, 214), radius=21, outline=AZUL, width=2)
    d.text((84, 176), selo.upper(), font=f_selo, fill=(111, 203, 255))

    f_titulo = fonte("segoeuib.ttf", 64)
    y = 236
    for linha in quebrar(d, titulo, f_titulo, 1060)[:2]:
        d.text((64, y), linha, font=f_titulo, fill=BRANCO)
        y += 76
    d.text((64, y + 6), destaque, font=fonte("segoeuib.ttf", 44), fill=AMARELO)

    d.rectangle((0, 530, LARGURA, ALTURA), fill=AMARELO)
    d.text((64, 553), "2 meses grátis · só paga se gostar", font=fonte("segoeuib.ttf", 36), fill=AZUL_FUNDO)
    site = "mercadinhosys.com.br"
    f_site = fonte("seguisb.ttf", 30)
    d.text((LARGURA - 64 - d.textlength(site, font=f_site), 558), site, font=f_site, fill=AZUL_FUNDO)

    img.save(SAIDA / f"{nome_arquivo}.png", optimize=True)


def main():
    SAIDA.mkdir(parents=True, exist_ok=True)
    nichos = json.loads((DADOS / "nichos.json").read_text(encoding="utf-8"))
    regioes = json.loads((DADOS / "regioes.json").read_text(encoding="utf-8"))

    gerar("inicio", "Gestão com IA para todo tipo de comércio", "O sistema que trabalha por você.", "Caixa, estoque, fiado e lucro real")
    for n in nichos:
        gerar(n["slug"], f"Sistema para {n['nome'].lower()}", n["h1"].split(":")[0], (n["h1"].split(":")[1].strip().capitalize() if ":" in n["h1"] else "Caixa, estoque e fiado no controle"))
    for r in regioes:
        prep = "em" if r["slug"] == "guarulhos" else "na"
        gerar(f"comercio-{r['slug']}", f"Implantação presencial · {r['nome']}", f"Sistema para comércio {prep} {r['nome']}", "A gente vai até a sua loja")
    print(f"{1 + len(nichos) + len(regioes)} imagens em {SAIDA}")


if __name__ == "__main__":
    main()
