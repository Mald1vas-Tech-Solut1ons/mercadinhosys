# MercadinhoSys - Local Development & Setup

## 🚀 Repositório de Ambientes Críticos

Este documento consolida as diretrizes operacionais de infraestrutura (DevOps & Edge Computing) para inicialização do ecossistema MercadinhoSys diretamente em ambientes *On-Premise* ou *Workstations* de engenheiros de software, mitigando as complexidades de virtualização excessiva (Docker) durante ciclos de desenvolvimento ágil.

### Stack Operacional Desejada
*   **Operating System:** Windows PowerShell (Recomendado) ou Ambientes Unix (Linux/macOS).
*   **Node.js Runtime:** v18+ garantindo compatibilidade com o ecossistema Vite/React 18.
*   **Python Engine:** `>= 3.11` otimizado para concorrência no Flask/SQLAlchemy.
*   **Database:** SGBD Relacional (PostgreSQL 14+) ou instâncias Edge locais (SQLite nativo).

---

## 🏗️ Inicialização da Arquitetura (One-Click Setup)

Implementamos scripts de orquestração utilitária focados na experiência do desenvolvedor (DX). A inicialização paralela das camadas de Frontend (UI/UX) e Backend (API/Core Engine) foi simplificada a um único script de orquestração.

```powershell
# Execução da pipeline de serviços (Backend + Frontend Client)
.\start-local.ps1
```

O orquestrador executará sequencialmente:
1. Resolução do ambiente virtual (venv) e injeção do `requirements.txt`.
2. O levantamento do motor Flask na sub-rede `localhost:5000` (API Core + Autenticação JWT).
3. Acionamento do React Hydration e processamento via Vite (HMR ativo) disponível na porta `5173`.
4. Estabelecimento da State Machine relacional conectando ao banco de dados `instance/mercadinho.db` (Fallback SQLite Architecture).

---

## 🛠️ Diagnostics & DBA Tools (Scripts Administrativos)

O repositório disponibiliza nativamente um framework de análise e consistência arquitetural localizado no diretório `/backend/scripts`. Estas ferramentas destinam-se a manter a integridade transacional de ponta a ponta:

*   **`inspect_db.py`:** Profile e auditoria das integridades transacionais e blocos ACID.
*   **`compare_schemas.py`:** Validação de *Delta/Schema* comparando o ORM (SQLAlchemy Declarative Base) contra a infraestrutura viva na nuvem (PostgreSQL).

## 🔗 Portais Ocupados (Network Map)

*   **Painel Administrativo B2B (Módulo Operacional/PDV/BI):** `http://localhost:5173`
*   **API Root & Health Check Engine:** `http://localhost:5000/api/health`

---

> *Este artefato de documentação técnica foi desenhado para escalabilidade horizontal da equipe de engenharia e transparência algorítmica.*
