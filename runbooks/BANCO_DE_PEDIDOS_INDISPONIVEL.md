# Runbook: banco de pedidos indisponível

## Alerta

`Observability Lab: banco de negócio indisponível`

## Impacto

A aplicação continua viva, mas a readiness e a API `/api/orders` falham. O
usuário não consegue consultar nem criar pedidos.

## Diagnóstico

```bash
docker compose ps app business-db
curl -i http://127.0.0.1:18080/health/live
curl -i http://127.0.0.1:18080/health/ready
curl -i http://127.0.0.1:18080/health/db
docker compose logs --tail=100 app business-db
```

Confirme nos logs o mesmo `request_id` recebido no cabeçalho
`x-request-id`. Verifique no Grafana `Banco disponível`, `Erros de banco` e
`Última consulta ao banco`.

## Recuperação do laboratório

```bash
curl -X POST http://127.0.0.1:18080/api/control \
  -H 'content-type: application/json' \
  -d '{"mode":"healthy"}'
```

Depois, confirme HTTP 200 em `/health/ready`, `/health/db` e `/api/orders`.
