.PHONY: help build up down restart logs clean test migrate seed backup restore deps-install deps-check test-frontend

# Cores para output
GREEN  := $(shell tput -Txterm setaf 2)
YELLOW := $(shell tput -Txterm setaf 3)
RESET  := $(shell tput -Txterm sgr0)

help: ## Mostra esta mensagem de ajuda
	@echo '${GREEN}MercadinhoSys - Comandos Disponíveis${RESET}'
	@echo ''
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  ${YELLOW}%-20s${RESET} %s\n", $$1, $$2}'
	@echo ''

build: ## Build das imagens Docker
	@echo "${GREEN}Building Docker images...${RESET}"
	docker-compose build

up: ## Sobe todos os containers
	@echo "${GREEN}Starting containers...${RESET}"
	docker-compose up -d
	@echo "${GREEN}Containers started! Access:${RESET}"
	@echo "  Frontend: http://localhost"
	@echo "  Backend:  http://localhost:5000"
	@echo "  API Docs: http://localhost:5000/api"

down: ## Para todos os containers
	@echo "${YELLOW}Stopping containers...${RESET}"
	docker-compose down

restart: down up ## Reinicia todos os containers

logs: ## Mostra logs de todos os containers
	docker-compose logs -f

logs-backend: ## Mostra logs apenas do backend
	docker-compose logs -f backend

logs-frontend: ## Mostra logs apenas do frontend
	docker-compose logs -f frontend

logs-db: ## Mostra logs apenas do banco
	docker-compose logs -f postgres

ps: ## Lista containers em execução
	docker-compose ps

shell-backend: ## Abre shell no container do backend
	docker-compose exec backend /bin/bash

shell-db: ## Abre psql no banco de dados
	docker-compose exec postgres psql -U mercadinho_user -d mercadinhosys

clean: ## Remove containers, volumes e imagens
	@echo "${YELLOW}Cleaning up...${RESET}"
	docker-compose down -v --remove-orphans
	docker system prune -f

clean-all: ## Remove TUDO (cuidado!)
	@echo "${YELLOW}WARNING: This will remove ALL containers, volumes and images!${RESET}"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v --remove-orphans; \
		docker system prune -af --volumes; \
	fi

# ---- Ambiente local (fora do Docker) ----
BACKEND_PY ?= backend/venv/Scripts/python.exe

deps-install: ## Restaura o venv do backend exatamente conforme requirements.txt e valida
	$(BACKEND_PY) -m pip install -r backend/requirements.txt
	$(BACKEND_PY) backend/scripts/check_deps.py

deps-check: ## Falha se o venv do backend divergir do requirements.txt (drift)
	$(BACKEND_PY) backend/scripts/check_deps.py

test-frontend: ## Vitest do frontend com cobertura dos modulos criticos (PDV/fila offline)
	cd frontend/mercadinhosys-frontend && npm run test:coverage

test: ## Roda todos os testes
	@echo "${GREEN}Running tests...${RESET}"
	docker-compose exec backend pytest -v

test-coverage: ## Roda testes com coverage
	@echo "${GREEN}Running tests with coverage...${RESET}"
	docker-compose exec backend pytest --cov=app --cov-report=html --cov-report=term

migrate: ## Roda migrations do banco
	@echo "${GREEN}Running database migrations...${RESET}"
	docker-compose exec backend flask db upgrade

migrate-create: ## Cria nova migration
	@read -p "Migration name: " name; \
	docker-compose exec backend flask db migrate -m "$$name"

seed: ## Popula banco com dados de teste
	@echo "${GREEN}Seeding database...${RESET}"
	docker-compose exec backend python seed.py

backup: ## Faz backup do banco de dados
	@echo "${GREEN}Creating database backup...${RESET}"
	@mkdir -p backups
	docker-compose exec -T postgres pg_dump -U mercadinho_user mercadinhosys > backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "${GREEN}Backup created in backups/${RESET}"

restore: ## Restaura backup do banco (use: make restore FILE=backup.sql)
	@if [ -z "$(FILE)" ]; then \
		echo "${YELLOW}Usage: make restore FILE=backup_20240101_120000.sql${RESET}"; \
		exit 1; \
	fi
	@echo "${YELLOW}Restoring database from $(FILE)...${RESET}"
	docker-compose exec -T postgres psql -U mercadinho_user -d mercadinhosys < backups/$(FILE)
	@echo "${GREEN}Database restored!${RESET}"

dev: ## Modo desenvolvimento (hot reload)
	@echo "${GREEN}Starting in development mode...${RESET}"
	FLASK_ENV=development docker-compose up

prod: build up ## Deploy em produção

health: ## Verifica saúde dos serviços
	@echo "${GREEN}Checking services health...${RESET}"
	@curl -s http://localhost:5000/api/health | jq .
	@curl -s http://localhost/health

stats: ## Mostra estatísticas dos containers
	docker stats --no-stream

update: ## Atualiza imagens e reinicia
	@echo "${GREEN}Updating images...${RESET}"
	docker-compose pull
	docker-compose up -d --remove-orphans
	@echo "${GREEN}Update complete!${RESET}"

install: ## Primeira instalação (setup completo)
	@echo "${GREEN}Installing MercadinhoSys...${RESET}"
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "${YELLOW}Created .env file. Please edit it with your settings.${RESET}"; \
	fi
	@make build
	@make up
	@sleep 10
	@make migrate
	@make seed
	@echo "${GREEN}Installation complete!${RESET}"
	@echo "Access: http://localhost"
