# Runbook: correlacionar erro por request_id

## Objetivo

Partir de uma resposta HTTP com erro e localizar no Loki os eventos internos da
mesma requisição.

## Coletar o identificador

```bash
curl -i http://127.0.0.1:18080/api/orders
```

Copie o valor do cabeçalho `x-request-id`.

## Consultar no Grafana

Abra **Explore**, selecione o datasource `Loki` e execute:

```logql
{compose_service="app"} | json | request_id="ID_DA_REQUISICAO"
```

## Interpretar

Para um erro de banco, devem aparecer pelo menos:

- `database operation failed`: causa interna e código do MySQL;
- `request completed`: endpoint, status HTTP e duração observada.

O mesmo `request_id` prova que os dois eventos pertencem à mesma requisição.

## Restaurar e validar

```bash
curl -X POST http://127.0.0.1:18080/api/control \
  -H 'content-type: application/json' \
  -d '{"mode":"healthy"}'

curl -i http://127.0.0.1:18080/health/ready
```

O serviço deve retornar ao modo `healthy` e a readiness deve responder HTTP
200.
