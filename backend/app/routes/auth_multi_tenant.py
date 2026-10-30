from datetime import timezone
"""
Rotas de Autenticação Multi-Tenant
Autenticação global com redirecionamento para banco do tenant
"""

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt, get_jwt_identity
from werkzeug.security import check_password_hash
from datetime import timedelta
import psycopg2
import os
import pytz
from datetime import datetime
from app.middleware.multi_tenant import tenant_manager
from app import db
from app.models import Funcionario, Estabelecimento
from app.middleware.rate_limit import limiter
from flask_limiter.util import get_remote_address
from app.utils.timezone import iso_utc

auth_bp = Blueprint('auth_multi_tenant', __name__)

def get_main_connection():
    """Obtém conexão com banco principal de autenticação"""
    main_url = os.getenv('MAIN_DATABASE_URL')
    if not main_url:
        return None
    return psycopg2.connect(main_url)

def normalize_plan_name(p, plano_status=None):
    """Garante retorno apenas de Pro ou Gratuito no motor de auth (trial em vigor = Pro)."""
    from app.decorators.plan_guards import plano_efetivo
    return plano_efetivo(p, plano_status)

@auth_bp.route('/bootstrap', methods=['POST'])
def bootstrap_admin():
    """Provisionamento privilegiado é exclusivo da CLI."""
    return jsonify({'success': False, 'error': 'Endpoint desativado. Use a CLI de provisionamento.'}), 410


def _auditar_login(estabelecimento_id, usuario_id, username, contexto):
    """Falhas de auditoria não interrompem autenticação."""
    try:
        if not estabelecimento_id or str(estabelecimento_id).lower() == 'all':
            return
        from app.models import Auditoria
        Auditoria.registrar(estabelecimento_id=int(estabelecimento_id), tipo_evento='login',
                           descricao=f'Login realizado por {username}', usuario_id=usuario_id,
                           detalhes={'contexto': contexto})
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        current_app.logger.warning('[AUDIT] Falha ao registrar login: %s', error)


LOGIN_BLOQUEIO_SEGUNDOS = 7 * 60


def _limite_tentativas(estabelecimento_id):
    """Configurações → Segurança da loja (mínimo 3: um erro de digitação não tranca o dono)."""
    from app.models import Configuracao
    try:
        config = Configuracao.query.filter_by(estabelecimento_id=estabelecimento_id).first() if estabelecimento_id else None
        return max(3, int(getattr(config, "tentativas_senha_bloqueio", None) or 5))
    except Exception:
        return 5


def _chave_login(username):
    return f"login_erros:{username.lower()}"


def _login_bloqueado(username):
    from app import cache
    registro = cache.get(_chave_login(username)) or {}
    return registro.get("erros", 0) >= registro.get("limite", 5)


def _registrar_falha_login(username, estabelecimento_id=None):
    from app import cache
    chave = _chave_login(username)
    registro = cache.get(chave) or {"erros": 0}
    registro["erros"] += 1
    registro["limite"] = _limite_tentativas(estabelecimento_id)
    cache.set(chave, registro, timeout=LOGIN_BLOQUEIO_SEGUNDOS)
    if registro["erros"] == registro["limite"] and estabelecimento_id:
        from app.models import Auditoria
        Auditoria.registrar(estabelecimento_id=estabelecimento_id, tipo_evento="login_bloqueado",
                            descricao=f"Login de {username} bloqueado por {LOGIN_BLOQUEIO_SEGUNDOS // 60} min após senhas erradas")
        db.session.commit()


def _resposta_login_bloqueado():
    return jsonify({'success': False, 'code': 'LOGIN_BLOQUEADO',
                    'error': f'Muitas senhas erradas. Por segurança, este acesso fica bloqueado por {LOGIN_BLOQUEIO_SEGUNDOS // 60} minutos.'}), 429


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("5 per minute", key_func=get_remote_address, error_message="Muitas tentativas de login. Aguarde um minuto.")
def login():
    """Login multi-tenant - autentica global e redireciona para tenant"""
    try:
        data = request.get_json(silent=True) or {}
        
        # Captura flexível com validação obrigatória
        username = data.get('identifier') or data.get('username') or data.get('email') or ''
        senha = data.get('senha') or data.get('password') or ''
        if not isinstance(username, str) or not isinstance(senha, str):
            return jsonify({'success': False, 'error': 'Credenciais inválidas'}), 400
        username = username.strip()
        
        if not username or not senha:
            return jsonify({
                'success': False,
                'error': 'Identificador e senha são obrigatórios para sua segurança.',
                'code': 'CREDENTIALS_REQUIRED'
            }), 400
        
        if _login_bloqueado(username):
            return _resposta_login_bloqueado()

        # 1. TENTATIVA: BANCO PRINCIPAL (POSTGRES / CLOUD)
        all_matches = []
        try:
            conn = get_main_connection()
            if conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT f.id, f.nome, f.email, f.senha, f.role, f.estabelecimento_id,
                           e.nome_fantasia, 'postgresql' as database_name, e.ativo, e.razao_social, e.cnpj, f.is_super_admin,
                           e.plano, e.plano_status, f.status
                    FROM public.funcionarios f
                    JOIN public.estabelecimentos e ON f.estabelecimento_id = e.id
                    WHERE (LOWER(f.email) = LOWER(%s) OR LOWER(f.username) = LOWER(%s)) 
                      AND f.ativo = true 
                      AND e.ativo = true
                    ORDER BY f.id ASC
                """, (username, username))
                all_matches = cursor.fetchall()
                cursor.close()
                conn.close()
        except Exception as e:
            current_app.logger.warning(f"[AUTH] Falha conexão Postgres (possível modo offline): {str(e)}")
        
        # 2. SEGUNDA TENTATIVA: BANCO LOCAL (SQLITE) - ESSENCIAL PARA SIMULAÇÃO E DESENVOLVIMENTO
        if not all_matches:
            funcionario_local = Funcionario.query.filter(
                db.or_(
                    db.func.lower(Funcionario.username) == username.lower(),
                    db.func.lower(Funcionario.email) == username.lower()
                ),
                Funcionario.ativo == True
            ).first()

            if funcionario_local and funcionario_local.check_password(senha):
                estab = funcionario_local.estabelecimento
                from app.utils.auth_utils import is_user_active
                if not is_user_active(funcionario_local.status) or not estab or not estab.ativo:
                    return jsonify({'success': False, 'error': 'Conta inativa'}), 401
                is_super = bool(funcionario_local.is_super_admin)
                
                additional_claims = {
                    'role': (funcionario_local.role or 'FUNCIONARIO').upper(),
                    'status': 'ativo',
                    'is_super_admin': is_super,
                    'estabelecimento_id': "all" if is_super else (funcionario_local.estabelecimento_id or "all"),
                    'estabelecimento_nome': estab.nome_fantasia if estab else "MercadinhoSys",
                    'database_name': 'local',
                    'user_id': funcionario_local.id,
                    'plano': normalize_plan_name(estab.plano, estab.plano_status) if estab else 'Gratuito',
                    'plano_status': estab.plano_status if estab else 'ativo'
                }
                
                identity = str(funcionario_local.id)
                access_token = create_access_token(identity=identity, additional_claims=additional_claims, expires_delta=timedelta(hours=24))
                refresh_token = create_refresh_token(identity=identity, additional_claims=additional_claims)

                from app import cache
                cache.delete(_chave_login(username))
                _auditar_login(funcionario_local.estabelecimento_id, funcionario_local.id, username, "local")

                return jsonify({
                    'success': True,
                    'access_token': access_token,
                    'refresh_token': refresh_token,
                    'data': {
                        'user': {
                            'id': funcionario_local.id,
                            'nome': funcionario_local.nome,
                            'email': funcionario_local.email,
                            'role': funcionario_local.role,
                            'cargo': getattr(funcionario_local, 'cargo', 'Administrador'),
                            'is_super_admin': is_super,
                            'estabelecimento_id': "all" if is_super else funcionario_local.estabelecimento_id,
                            'plano': normalize_plan_name(estab.plano, estab.plano_status) if estab else 'Gratuito',
                            'plano_status': estab.plano_status if estab else 'ativo',
                            'permissoes': funcionario_local.permissoes
                        }
                    },
                    'message': 'Login realizado com sucesso (Contexto Local)'
                }), 200
            
            _registrar_falha_login(username, funcionario_local.estabelecimento_id if funcionario_local else None)
            return jsonify({'success': False, 'error': 'Usuário ou senha inválidos'}), 401
        
        # 3. PROCESSAR RESULTADO CLOUD
        user_data = all_matches[0]
        (user_id, user_nome, user_email, senha_val, role, estabelecimento_id,
         estabelecimento_nome, database_name, estabelecimento_status, razao_social, cnpj, is_super_db,
         plano_estab, plano_status_estab, status_funcionario) = user_data
        
        if not check_password_hash(senha_val, senha):
            _registrar_falha_login(username, estabelecimento_id)
            return jsonify({'success': False, 'error': 'Usuário ou senha inválidos'}), 401

        # Demitido/suspenso não recebe token (mesma régua do caminho local:
        # is_user_active via normalize_status — None/legado sem status = ativo).
        from app.utils.auth_utils import is_user_active
        if not is_user_active(status_funcionario):
            _registrar_falha_login(username, estabelecimento_id)
            return jsonify({'success': False, 'error': 'Conta inativa'}), 401

        from app import cache
        cache.delete(_chave_login(username))
        
        is_super = bool(is_super_db)
        
        # Criar token JWT com informações do tenant (Isolamento de Elite)
        additional_claims = {
            'role': "ADMIN" if is_super else role,
            'status': 'ativo',
            'is_super_admin': is_super,
            'estabelecimento_id': "all" if bool(is_super_db) else estabelecimento_id,
            'estabelecimento_nome': estabelecimento_nome,
            'database_name': database_name,
            'user_id': user_id,
            'plano': normalize_plan_name(plano_estab, plano_status_estab),
            'plano_status': plano_status_estab or 'ativo'
        }
        
        identity = str(user_id)
        access_token = create_access_token(
            identity=identity,
            additional_claims=additional_claims,
            expires_delta=timedelta(hours=24)
        )
        refresh_token = create_refresh_token(
            identity=identity,
            additional_claims=additional_claims
        )

        _auditar_login(estabelecimento_id, user_id, username, "cloud")

        return jsonify({
            'success': True,
            'access_token': access_token,
            'refresh_token': refresh_token,
            'data': {
                'user': {
                    'id': user_id,
                    'nome': user_nome,
                    'email': user_email,
                    'role': "ADMIN" if is_super else role,
                    'cargo': 'Administrador' if is_super else 'Funcionário',
                    'status': 'ativo',
                    'plano': normalize_plan_name(plano_estab, plano_status_estab) if not is_super else 'Pro',
                    'plano_status': plano_status_estab if not is_super else 'ativo',
                    'is_super_admin': is_super,
                    'estabelecimento_id': "all" if is_super else estabelecimento_id,
                    'permissoes': {
                        "pdv": True, "estoque": True, "vendas": True, "clientes": True, "financeiro": is_super, "configuracoes": is_super
                    }
                },
                'estabelecimento': {
                    'id': estabelecimento_id,
                    'nome': estabelecimento_nome,
                    'razao_social': razao_social,
                    'cnpj': cnpj,
                    'database_name': database_name,
                    'status': estabelecimento_status,
                    'plano': plano_estab,
                    'plano_status': plano_status_estab
                }
            },
            'message': f'Login realizado com sucesso - {estabelecimento_nome}'
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Erro interno no servidor'
        }), 500

@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Renovar access token em modo Multi-Tenant"""
    try:
        current_user = get_jwt_identity()
        claims = get_jwt()
        from app.utils.auth_utils import is_user_active
        user = Funcionario.query.get(int(current_user))
        if not user or not user.ativo or not is_user_active(user.status):
            return jsonify({'success': False, 'error': 'Conta inativa ou inexistente'}), 401
        if user.estabelecimento_id != claims.get('estabelecimento_id') and not (
            user.is_super_admin and claims.get('estabelecimento_id') == 'all'
        ):
            return jsonify({'success': False, 'error': 'Contexto de acesso inválido'}), 401

        # Claims que definem autoridade/plano são RECARGADOS do banco, não herdados
        # do token antigo (o access token vive 24h: role/status/plano podem mudar).
        estab_vigente = user.estabelecimento
        additional_claims = {
            'role': (user.role or 'FUNCIONARIO').upper(),
            'status': 'ativo',  # user.status já validado por is_user_active acima
            'is_super_admin': bool(user.is_super_admin),
            'estabelecimento_id': claims.get('estabelecimento_id'),
            'estabelecimento_nome': estab_vigente.nome_fantasia if estab_vigente else claims.get('estabelecimento_nome'),
            'database_name': claims.get('database_name'),
            'user_id': claims.get('user_id'),
            'plano': normalize_plan_name(estab_vigente.plano, estab_vigente.plano_status) if estab_vigente else normalize_plan_name(claims.get('plano')),
            'plano_status': (estab_vigente.plano_status if estab_vigente else None) or claims.get('plano_status') or 'ativo'
        }

        # Criar novo access token
        access_token = create_access_token(
            identity=current_user,
            additional_claims=additional_claims,
            expires_delta=timedelta(hours=24)
        )
        
        return jsonify({
            'success': True,
            'access_token': access_token,
            'refresh_token': request.headers.get('Authorization', '').replace('Bearer ', '') # Retorna o mesmo refresh_token se necessário
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro no refresh Multi-Tenant: {str(e)}")
        return jsonify({'success': False, 'error': 'Não foi possível renovar o acesso'}), 401

@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Obtém informações do usuário atual com dados do tenant"""
    try:
        claims = get_jwt()
        user_id = get_jwt_identity() # Agora é o ID (string)
        
        # --- TENTATIVA 1: BANCO PRINCIPAL (POSTGRES) ---
        user_data = None
        try:
            conn = get_main_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT f.id, f.nome, f.email, f.role, f.estabelecimento_id,
                       e.nome_fantasia, e.razao_social, e.cnpj, e.plano, e.plano_status
                FROM public.funcionarios f
                JOIN public.estabelecimentos e ON f.estabelecimento_id = e.id
                WHERE f.id = %s AND f.ativo = true
            """, (user_id,))
            user_data = cursor.fetchone()
            cursor.close()
            conn.close()
        except Exception:
            pass
            
        # --- TENTATIVA 2: BANCO LOCAL (SQLITE FALLBACK) ---
        if not user_data:
            from app.models import Funcionario
            f = Funcionario.query.get(int(user_id))
            if f:
                estab = f.estabelecimento
                user_data = (
                    f.id, f.nome, f.email, f.role, f.estabelecimento_id,
                    estab.nome_fantasia if estab else "MercadinhoSys",
                    estab.razao_social if estab else "",
                    estab.cnpj if estab else "",
                    estab.plano if estab else "Gratuito",
                    estab.plano_status if estab else "ativo"
                )
        
        if not user_data:
            return jsonify({
                'success': False,
                'error': 'Usuário não encontrado'
            }), 404
        
        (user_id, user_nome, user_email, role, estab_id, estab_nome, estab_razao, estab_cnpj, plano, plano_status) = user_data
        
        return jsonify({
            'success': True,
            'data': {
                'id': user_id,
                'nome': user_nome,
                'email': user_email,
                'role': role,
                'estabelecimento_id': estab_id,
                'estabelecimento_nome': estab_nome,
                'estabelecimento_razao_social': estab_razao,
                'estabelecimento_cnpj': estab_cnpj,
                'plano': normalize_plan_name(plano, plano_status),
                'plano_status': plano_status
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Erro ao obter dados do usuário'
        }), 500

@auth_bp.route('/verify-tenant', methods=['GET'])
@jwt_required()
def verify_tenant():
    """Verifica se o banco do tenant está acessível"""
    try:
        claims = get_jwt()
        estabelecimento_id = claims.get('estabelecimento_id')
        estabelecimento_nome = claims.get('estabelecimento_nome')
        is_local = claims.get('database_name') == 'local'
        
        if not estabelecimento_id:
            return jsonify({
                'success': False,
                'error': 'Estabelecimento não encontrado no token'
            }), 400

        # Se for banco local, já está verificado por definição do fallback
        if is_local or str(estabelecimento_id).lower() == 'all':
             return jsonify({
                'success': True,
                'data': {
                    'estabelecimento_id': estabelecimento_id,
                    'estabelecimento_nome': estabelecimento_nome,
                    'database_status': 'online',
                    'message': 'Contexto local/global verificado'
                }
            }), 200
        
        # Tentar conexão com banco do tenant
        try:
            tenant_conn = tenant_manager.get_connection(estabelecimento_id)
            tenant_manager.release_connection(estabelecimento_id, tenant_conn)
            
            return jsonify({
                'success': True,
                'data': {
                    'estabelecimento_id': estabelecimento_id,
                    'estabelecimento_nome': estabelecimento_nome,
                    'database_status': 'online',
                    'message': f'Banco do estabelecimento {estabelecimento_nome} está acessível'
                }
            }), 200
            
        except Exception as e:
            # Tentar criar banco
            if tenant_manager.create_tenant_database(estabelecimento_id, estabelecimento_nome):
                return jsonify({
                    'success': True,
                    'data': {
                        'estabelecimento_id': estabelecimento_id,
                        'estabelecimento_nome': estabelecimento_nome,
                        'database_status': 'created',
                        'message': f'Banco do estabelecimento {estabelecimento_nome} criado com sucesso'
                    }
                }), 200
            else:
                return jsonify({
                    'success': False,
                    'error': f'Banco do estabelecimento {estabelecimento_nome} não está acessível'
                }), 500
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Erro ao verificar tenant'
        }), 500

@auth_bp.route('/list-tenants', methods=['GET'])
@jwt_required()
def list_tenants():
    """Lista todos os tenants (apenas SUPER ADMIN do SaaS).

    Endpoints que expõem razão social/CNPJ de TODOS os tenants do SaaS não podem
    passar só por role 'admin': qualquer dono de loja cliente é 'admin' no
    próprio tenant. O gate correto é is_super_admin validado no banco
    (super_admin_required), não o claim do JWT.
    """
    try:
        user_id = get_jwt_identity()
        usuario = Funcionario.query.get(int(user_id)) if user_id is not None else None
        if not usuario or not bool(usuario.is_super_admin):
            return jsonify({
                'success': False,
                'error': 'Acesso restrito ao Super Admin'
            }), 403
        
        conn = get_main_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT e.id, e.nome_fantasia, e.razao_social, e.cnpj, 
                   e.database_name, e.status, e.created_at,
                   COUNT(u.id) as usuario_count
            FROM tenant_management.estabelecimentos e
            LEFT JOIN tenant_management.usuarios u ON e.id = u.estabelecimento_id AND u.ativo = true
            GROUP BY e.id
            ORDER BY e.nome_fantasia
        """)
        
        tenants = []
        for row in cursor.fetchall():
            tenants.append({
                'id': row[0],
                'nome_fantasia': row[1],
                'razao_social': row[2],
                'cnpj': row[3],
                'database_name': row[4],
                'status': row[5],
                'created_at': row[6],
                'usuario_count': row[7]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'data': tenants
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Erro ao listar tenants'
        }), 500

@auth_bp.route("/demo", methods=["POST"])
def guest_demo():
    """Access the system in demo mode with a single click (Multi-tenant compatible)"""
    try:
        from datetime import date
        import secrets
        from werkzeug.security import generate_password_hash
        import traceback
        
        # 1. Encontrar ou criar o estabelecimento demo
        demo_est = Estabelecimento.query.filter_by(cnpj="00000000000191").first()
        if not demo_est:
            demo_est = Estabelecimento(
                nome_fantasia="Supermercado Fictício (Demo)",
                razao_social="Demo Mercadinho Sys LTDA",
                cnpj="00000000000191",
                telefone="(11) 99999-9999",
                email="demo@mercadinhosys.com",
                data_abertura=date(2020, 1, 1),
                cep="01001-000",
                logradouro="Praça da Sé",
                numero="1",
                bairro="Sé",
                cidade="São Paulo",
                estado="SP",
                plano="Advanced",
                plano_status="active"
            )
            db.session.add(demo_est)
            db.session.flush() # Pegar ID

        # 2. Encontrar ou criar o admin demo
        demo_admin = Funcionario.query.filter_by(estabelecimento_id=demo_est.id, username="demo").first()
        # Conta demo antiga nasceu com a senha fixa "demo123": troca por uma aleatória.
        if demo_admin and demo_admin.check_senha("demo123"):
            demo_admin.set_senha(secrets.token_urlsafe(32))
            db.session.commit()
        if not demo_admin:
            demo_admin = Funcionario(
                estabelecimento_id=demo_est.id,
                nome="Administrador Demo",
                cpf="123.456.789-09",
                data_nascimento=date(1990, 1, 1),
                celular="(11) 99999-9999",
                email="demo@mercadinhosys.com",
                cargo="admin",
                data_admissao=date(2020, 1, 1),
                username="demo",
                senha=generate_password_hash(secrets.token_urlsafe(32)),  # conta demo entra só pela rota /demo, nunca por senha
                ativo=True,
                role="ADMIN",
                nivel_acesso=1,
                is_super_admin=False
            )
            db.session.add(demo_admin)
            db.session.commit()

        # 3. Claims adicionais (Multi-Tenant)
        additional_claims = {
            'role': "ADMIN",
            'status': "ativo",
            'is_super_admin': False,
            'estabelecimento_id': demo_est.id,
            'estabelecimento_nome': demo_est.nome_fantasia,
            'database_name': 'local',
            'user_id': demo_admin.id,
            'plano': 'Pro',
            'plano_status': 'ativo',
            'is_demo': True
        }

        access_token = create_access_token(
            identity=str(demo_admin.id),
            additional_claims=additional_claims,
            expires_delta=timedelta(hours=8)
        )
        refresh_token = create_refresh_token(
            identity=str(demo_admin.id),
            additional_claims=additional_claims,
            expires_delta=timedelta(days=7)
        )

        # 5. Resposta Unificada
        return jsonify({
            "success": True,
            "message": "Login demo realizado com sucesso",
            "data": {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": {
                    "id": demo_admin.id,
                    "nome": demo_admin.nome,
                    "username": demo_admin.username,
                    "email": demo_admin.email,
                    "cargo": "admin",
                    "role": "ADMIN",
                    "status": "ativo",
                    "estabelecimento_id": demo_est.id,
                    "estabelecimento_nome": demo_est.nome_fantasia,
                },
                "session": {
                    "login_time": iso_utc(datetime.now(timezone.utc)),
                    "expires_in": 28800,
                    "refresh_expires_in": 604800,
                    "token_type": "bearer",
                },
                "estabelecimento": {
                    "id": demo_est.id,
                    "nome": demo_est.nome_fantasia,
                    "cnpj": demo_est.cnpj,
                    "telefone": demo_est.telefone,
                    "email": demo_est.email,
                    "endereco": "Praça da Sé, 1 - Sé, São Paulo - SP",
                    "cidade": demo_est.cidade,
                    "estado": demo_est.estado,
                    "plano": "Advanced",
                    "plano_status": "active",
                },
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        import traceback
        current_app.logger.error(f"Erro no Login Demo: {traceback.format_exc()}")
        return jsonify({
            "error": "Falha ao acessar modo demo",
            "details": str(e),
            "code": "DEMO_ACCESS_ERROR"
        }), 500

@auth_bp.route("/doctor", methods=["GET"])
@jwt_required()
def auth_doctor():
    """Endpoint de Diagnóstico para verificar o estado da autenticação e a versão do código"""
    from app.utils.auth_utils import get_doctor_info
    current_user_id = get_jwt_identity()
    claims = get_jwt()
    return jsonify(get_doctor_info(current_user_id, claims)), 200


@auth_bp.route("/profile", methods=["PUT"])
@jwt_required()
def update_profile():
    """
    Atualiza os dados do próprio usuário (nome/e-mail/telefone) e, opcionalmente,
    a senha (exige a senha atual). Self-service nas Configurações > Minha Conta.
    """
    try:
        data = request.get_json() or {}
        user_id = get_jwt_identity()
        funcionario = Funcionario.query.get(int(user_id))
        if not funcionario:
            return jsonify({"success": False, "error": "Usuário não encontrado"}), 404

        atualizados = []
        for campo in ("nome", "email", "telefone"):
            if campo in data and data[campo] is not None:
                setattr(funcionario, campo, data[campo])
                atualizados.append(campo)

        if data.get("senha_atual") and data.get("nova_senha"):
            if not funcionario.check_senha(data["senha_atual"]):
                return jsonify({
                    "success": False, "error": "Senha atual incorreta",
                    "code": "WRONG_CURRENT_PASSWORD",
                }), 400
            from app.services.acesso_conta_service import validar_forca_senha
            erro_senha = validar_forca_senha(data["nova_senha"])
            if erro_senha:
                return jsonify({"success": False, "error": erro_senha}), 400
            funcionario.set_senha(data["nova_senha"])
            atualizados.append("senha")

        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Perfil atualizado com sucesso",
            "updated_fields": atualizados,
            "data": {"nome": funcionario.nome, "email": funcionario.email},
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao atualizar perfil: {e}")
        return jsonify({"success": False, "error": "Falha ao atualizar perfil"}), 500


@auth_bp.route("/password/reset-request", methods=["POST"])
@limiter.limit("5 per minute", key_func=get_remote_address)
def password_reset_request():
    """Envia o link de redefinição de senha. Resposta igual exista ou não o e-mail (sem enumeração)."""
    from app.services.acesso_conta_service import enviar_redefinicao, VALIDADE, REDEFINICAO
    resposta_padrao = {
        "success": True,
        "message": "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.",
        "expires_in": int(VALIDADE[REDEFINICAO].total_seconds()),
    }
    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"success": False, "error": "Email é obrigatório", "code": "EMAIL_REQUIRED"}), 400
    try:
        funcionario = Funcionario.query.filter(
            db.func.lower(Funcionario.email) == email, Funcionario.ativo.is_(True)
        ).first()
        if funcionario:
            enviar_redefinicao(funcionario)
        return jsonify(resposta_padrao), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro na solicitação de reset de senha: {type(e).__name__}")
        return jsonify({"success": False, "error": "Erro ao processar solicitação", "code": "RESET_REQUEST_ERROR"}), 500


@auth_bp.route("/senha/token/<token>", methods=["GET"])
@limiter.limit("30 per minute", key_func=get_remote_address)
def senha_validar_token(token):
    """Diz se o link ainda vale e para quem é (só o primeiro nome e a loja), para a tela /definir-senha."""
    from app.services.acesso_conta_service import token_valido
    registro = token_valido(token)
    if not registro:
        return jsonify({"success": False, "error": "Link inválido ou expirado. Peça um novo link.", "code": "TOKEN_INVALIDO"}), 400
    funcionario = registro.funcionario
    estabelecimento = Estabelecimento.query.get(funcionario.estabelecimento_id)
    return jsonify({
        "success": True,
        "finalidade": registro.finalidade,
        "nome": (funcionario.nome or "").split(" ")[0],
        "username": funcionario.username,
        "loja": estabelecimento.nome_fantasia if estabelecimento else None,
    }), 200


@auth_bp.route("/senha/definir", methods=["POST"])
@limiter.limit("10 per minute", key_func=get_remote_address)
def senha_definir():
    """Ativa a conta / redefine a senha a partir do link de uso único."""
    from app.services.acesso_conta_service import definir_senha
    data = request.get_json(silent=True) or {}
    try:
        funcionario = definir_senha(str(data.get("token") or ""), str(data.get("nova_senha") or ""))
    except ValueError as erro:
        db.session.rollback()
        return jsonify({"success": False, "error": str(erro)}), 400
    current_app.logger.info(f"Senha definida por link de uso único (funcionario_id={funcionario.id})")
    return jsonify({"success": True, "username": funcionario.username,
                    "message": "Senha criada. Agora é só entrar com seu usuário e a nova senha."}), 200
