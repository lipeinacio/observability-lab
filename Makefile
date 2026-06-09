.PHONY: up down status logs test incidents logs-test alerts-test infrastructure-test verify

up:
	docker compose up -d --build

down:
	docker compose down

status:
	docker compose ps -a

logs:
	docker compose logs -f --tail=100

test:
	npm test

incidents:
	node bootstrap/test-incidents.js

logs-test:
	node bootstrap/test-logs.js

alerts-test:
	node bootstrap/test-alerts.js

infrastructure-test:
	node bootstrap/test-infrastructure.js

verify:
	node bootstrap/verify-zabbix.js
