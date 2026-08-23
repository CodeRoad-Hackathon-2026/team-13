.PHONY: help up down logs seed key test fmt shell psql reset mcp sources ui ui-dev crew crew-full justify diagrams secrets-key prompts eval eval-quick eval-project

API ?= http://localhost:8000/v1
KEY ?= $(shell grep -E '^BOOTSTRAP_API_KEY=' .env 2>/dev/null | cut -d= -f2)

# Python targets run inside the api container. The host has no guarantee of a
# `python` on PATH (macOS ships `python3` only) and none of the dependencies,
# so running them there fails with an error that reads like a broken tool.
# The repo is mounted at /srv, so edits apply without a rebuild.
RUN = docker compose exec api

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start postgres, redis, api and worker
	@test -f .env || cp .env.example .env
	docker compose up -d --build
	@echo "API:  http://localhost:8000/docs"

down: ## Stop everything
	docker compose down

reset: ## Stop everything and drop the database volume
	docker compose down -v

logs: ## Tail api + worker logs
	docker compose logs -f api worker

seed: ## Load the demo runbooks and incidents
	docker compose exec api python -m scripts.seed_demo

key: ## Issue a new API key: make key NAME=agent SCOPES="read write"
	docker compose exec api python -m scripts.create_api_key "$(NAME)" $(SCOPES)

test: ## Run the test suite
	docker compose exec api python -m pytest -q

psql: ## Open a psql shell
	docker compose exec postgres psql -U rag -d rag

shell: ## Open a shell in the api container
	docker compose exec api bash

health: ## Check service health
	curl -s $(API)/health | python3 -m json.tool

ask: ## Ask a question: make ask Q="checkout is timing out"
	curl -s -X POST $(API)/answer \
		-H "X-API-Key: $(KEY)" -H 'Content-Type: application/json' \
		-d '{"query": "$(Q)"}' | python3 -m json.tool

mcp: ## Run the MCP server (stdio) against the local API
	$(RUN) env RAG_API_URL=$(API) RAG_API_KEY=$(KEY) python -m app.mcp_server

sources: ## List registered sources and their last poll status
	curl -s $(API)/sources -H "X-API-Key: $(KEY)" | python3 -m json.tool

ui: ## Build the web UI (served by the API at :8000)
	cd frontend && npm install && npm run build

ui-dev: ## Vite dev server with hot reload on :5173
	docker compose --profile dev up frontend

crew: ## Dry-run the incident crew: make crew Q="checkout timing out"
	$(RUN) env RAG_API_URL=$(API) RAG_API_KEY=$(KEY) \
		python -m agents.incident_crew --incident "$(Q)" --dry-run

crew-full: ## Full CrewAI run — needs `pip install -r agents/requirements.txt` on the host
	RAG_API_URL=$(API) RAG_API_KEY=$(KEY) \
		python3 -m agents.incident_crew --incident "$(Q)" --incident-id "$(INC)"

diagrams: ## Validate every Mermaid diagram in docs/
	./scripts/validate_diagrams.sh

secrets-key: ## Generate a SECRETS_KEY for the connector credential vault
	@python3 -c "import os,base64;print('SECRETS_KEY=' + base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"

prompts: ## Show the active prompt version of each prompt
	curl -s $(API)/prompts -H "X-API-Key: $(KEY)" | python3 -c "import json,sys;[print(f\"{p['key']:24} v{p['version']}  {'default' if p['is_default'] else 'EDITED'}\") for p in json.load(sys.stdin)['prompts']]"

eval: ## Score the golden set: retrieval, abstention, groundedness
	$(RUN) python -m eval.run --api $(API) --key $(KEY) $(EVAL_ARGS)

eval-quick: ## Same, retrieval only — no LLM tokens, safe to run on every change
	$(MAKE) eval EVAL_ARGS=--retrieval-only

eval-project: ## Score only the Learning Agent set
	$(RUN) python -m eval.run --api $(API) --key $(KEY) \
		--dataset eval/golden/learning-agent.json $(EVAL_ARGS)

justify: ## PR justification block for an incident: make justify INC=INC-2481
	$(RUN) env RAG_API_URL=$(API) RAG_API_KEY=$(KEY) \
		python -m agents.incident_crew --justify "$(INC)" --pr-url "$(PR)"
