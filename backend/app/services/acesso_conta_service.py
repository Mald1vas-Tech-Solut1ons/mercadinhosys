"""Links de uso único para ativar a conta e redefinir a senha.

O token cru só existe no link enviado; o banco guarda o SHA-256. Gerar um link
novo invalida os anteriores da mesma finalidade, e definir a senha consome todos.
"""
import hashlib
import os
import re
import secrets
from datetime import timedelta

from app.models import db, TokenSenha, utcnow
from app.services.email_service import enviar_email_transacional
from app.services.email_templates import email_ativacao_conta, email_redefinir_senha

ATIVACAO = "ativacao"
REDEFINICAO = "redefinicao"
VALIDADE = {ATIVACAO: timedelta(hours=72), REDEFINICAO: timedelta(minutes=60)}


def url_app() -> str:
    return (os.getenv("APP_URL") or "https://mercadinhosys.vercel.app").rstrip("/")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def validar_forca_senha(senha: str) -> str | None:
    """Mensagem de erro, ou None se a senha serve. Mesma regra da tela /definir-senha."""
    if len(senha or "") < 8:
        return "A senha precisa ter pelo menos 8 caracteres."
    if not re.search(r"[A-Za-z]", senha) or not re.search(r"\d", senha):
        return "A senha precisa ter letras e números."
    return None


def gerar_link(funcionario, finalidade: str) -> str:
    """Cria o token (invalidando os pendentes da mesma finalidade) e devolve o link. Não faz commit."""
    agora = utcnow()
    TokenSenha.query.filter(
        TokenSenha.funcionario_id == funcionario.id,
        TokenSenha.finalidade == finalidade,
        TokenSenha.usado_em.is_(None),
    ).update({"usado_em": agora}, synchronize_session=False)
    token = secrets.token_urlsafe(32)
    db.session.add(TokenSenha(
        funcionario_id=funcionario.id, finalidade=finalidade, token_hash=_hash(token),
        expira_em=agora + VALIDADE[finalidade], criado_em=agora,
    ))
    return f"{url_app()}/definir-senha?token={token}"


def token_valido(token: str):
    """TokenSenha ainda utilizável para esse token cru, ou None."""
    if not token or len(token) > 200:
        return None
    registro = TokenSenha.query.filter_by(token_hash=_hash(token)).first()
    if not registro or registro.usado_em is not None or registro.expira_em <= utcnow():
        return None
    funcionario = registro.funcionario
    if not funcionario or not funcionario.ativo or getattr(funcionario, "deleted_at", None):
        return None
    return registro


def definir_senha(token: str, nova_senha: str):
    """Troca a senha e consome todos os links pendentes do usuário. Levanta ValueError com a mensagem."""
    registro = token_valido(token)
    if not registro:
        raise ValueError("Link inválido ou expirado. Peça um novo link.")
    erro = validar_forca_senha(nova_senha)
    if erro:
        raise ValueError(erro)
    funcionario = registro.funcionario
    funcionario.set_senha(nova_senha)
    TokenSenha.query.filter(
        TokenSenha.funcionario_id == funcionario.id, TokenSenha.usado_em.is_(None)
    ).update({"usado_em": utcnow()}, synchronize_session=False)
    db.session.commit()
    return funcionario


def enviar_ativacao(funcionario, nome_loja: str) -> dict:
    """Gera o link de ativação, faz commit e tenta enviar. Retorna {'enviado', 'link'}."""
    link = gerar_link(funcionario, ATIVACAO)
    db.session.commit()
    horas = int(VALIDADE[ATIVACAO].total_seconds() // 3600)
    assunto, corpo_html, corpo_texto = email_ativacao_conta(funcionario.nome, nome_loja, link, horas)
    enviado = enviar_email_transacional(funcionario.email, assunto, corpo_html, corpo_texto)
    return {"enviado": enviado, "link": link}


def enviar_redefinicao(funcionario) -> bool:
    link = gerar_link(funcionario, REDEFINICAO)
    db.session.commit()
    minutos = int(VALIDADE[REDEFINICAO].total_seconds() // 60)
    assunto, corpo_html, corpo_texto = email_redefinir_senha(funcionario.nome, link, minutos)
    return enviar_email_transacional(funcionario.email, assunto, corpo_html, corpo_texto)
