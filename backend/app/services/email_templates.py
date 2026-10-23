"""Templates dos e-mails transacionais de conta (HTML inline compatível com Gmail/Outlook).

Nenhum template recebe senha: o acesso é sempre por link de uso único.
"""
import html

_ASSINATURA = "Equipe MercadinhoSys · Maldivas Tech Solutions"


def _saudacao(nome: str) -> tuple[str, str]:
    partes = (nome or "").strip().split()
    if not partes:
        return "Olá,", "Olá,"
    return f"Olá, {html.escape(partes[0])},", f"Olá, {partes[0]},"


def _layout(titulo: str, corpo_html: str, botao: str, link: str, rodape_html: str) -> str:
    link_html = html.escape(link, quote=True)
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(titulo)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background-color:#f3f4f6; margin:0; padding:0;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px; background-color:#ffffff; border-radius:12px; overflow:hidden; font-family:Arial, Helvetica, sans-serif;">
<tr>
<td style="background-color:#2563eb; padding:20px 24px; color:#ffffff; font-size:20px; font-weight:bold; line-height:28px;">MercadinhoSys</td>
</tr>
<tr>
<td style="padding:32px 24px 8px 24px; color:#111827; font-size:16px; line-height:24px;">
{corpo_html}
</td>
</tr>
<tr>
<td align="center" style="padding:0 24px 20px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
<tr>
<td align="center" style="background-color:#2563eb; border-radius:8px;">
<a href="{link_html}" target="_blank" rel="noopener" style="display:inline-block; padding:16px 28px; color:#ffffff; background-color:#2563eb; border-radius:8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; font-weight:bold; line-height:20px; text-decoration:none;">{html.escape(botao)}</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:0 24px 20px 24px; color:#6b7280; font-size:13px; line-height:20px;">
<p style="margin:0;">Se o botão não funcionar, copie e cole este link no navegador:</p>
<p style="margin:4px 0 0 0; word-break:break-all;"><a href="{link_html}" target="_blank" rel="noopener" style="color:#2563eb; text-decoration:underline;">{link_html}</a></p>
</td>
</tr>
<tr>
<td style="padding:0 24px 24px 24px; color:#111827; font-size:15px; line-height:22px;">
{rodape_html}
<p style="margin:16px 0 0 0; color:#6b7280; font-size:13px;">{_ASSINATURA}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>"""


def email_ativacao_conta(nome: str, loja: str, link: str, horas_validade: int) -> tuple[str, str, str]:
    assunto = f"Ative sua conta no MercadinhoSys — {loja}"
    saud_html, saud_texto = _saudacao(nome)
    corpo = (
        f'<p style="margin:0 0 16px 0;">{saud_html}</p>'
        f'<p style="margin:0 0 16px 0;">A loja <strong>{html.escape(loja)}</strong> já está pronta no MercadinhoSys com teste gratuito.</p>'
        '<p style="margin:0 0 24px 0;">Para começar, ative sua conta e crie sua própria senha:</p>'
    )
    rodape = (
        f'<p style="margin:0 0 12px 0; color:#6b7280;">O link vale {int(horas_validade)} horas e só pode ser usado uma vez.</p>'
        '<p style="margin:0 0 8px 0; font-weight:bold;">Primeiros passos:</p>'
        '<p style="margin:0 0 4px 0;">1. Cadastre seus produtos.</p>'
        '<p style="margin:0 0 4px 0;">2. Imprima as etiquetas.</p>'
        '<p style="margin:0 0 16px 0;">3. Venda no PDV.</p>'
        '<p style="margin:0; color:#6b7280; font-size:13px;">Se você não esperava este e-mail, ignore-o.</p>'
    )
    texto = (
        f"{saud_texto}\n\n"
        f'A loja "{loja}" já está pronta no MercadinhoSys com teste gratuito.\n\n'
        f"Para começar, ative sua conta e crie sua própria senha neste link:\n{link}\n\n"
        f"O link vale {int(horas_validade)} horas e só pode ser usado uma vez.\n\n"
        "Primeiros passos:\n1. Cadastre seus produtos.\n2. Imprima as etiquetas.\n3. Venda no PDV.\n\n"
        "Se você não esperava este e-mail, ignore-o.\n\n"
        f"{_ASSINATURA}\n"
    )
    return assunto, _layout(assunto, corpo, "Ativar minha conta", link, rodape), texto


def email_redefinir_senha(nome: str, link: str, minutos_validade: int) -> tuple[str, str, str]:
    assunto = "Redefinição de senha — MercadinhoSys"
    saud_html, saud_texto = _saudacao(nome)
    corpo = (
        f'<p style="margin:0 0 16px 0;">{saud_html}</p>'
        '<p style="margin:0 0 16px 0;">Recebemos um pedido para redefinir a senha da sua conta.</p>'
        '<p style="margin:0 0 24px 0;">Para criar uma nova senha, clique no botão abaixo:</p>'
    )
    rodape = (
        f'<p style="margin:0 0 12px 0; color:#6b7280;">O link vale {int(minutos_validade)} minutos e é de uso único.</p>'
        '<p style="margin:0; color:#6b7280;">Se não foi você, ignore este e-mail — sua senha atual continua valendo.</p>'
    )
    texto = (
        f"{saud_texto}\n\n"
        "Recebemos um pedido para redefinir a senha da sua conta.\n\n"
        f"Para criar uma nova senha, acesse:\n{link}\n\n"
        f"O link vale {int(minutos_validade)} minutos e é de uso único.\n\n"
        "Se não foi você, ignore este e-mail — sua senha atual continua valendo.\n\n"
        f"{_ASSINATURA}\n"
    )
    return assunto, _layout(assunto, corpo, "Criar nova senha", link, rodape), texto
