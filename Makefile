.PHONY: up down status logs test incidents verify

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

verify:
	node bootstrap/verify-zabbix.js
