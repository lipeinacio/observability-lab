# Runbook: API de pedidos indisponível

## Problema no Zabbix

`Orders API: readiness indisponível`

## Impacto

A aplicação não está pronta para atender. O processo pode continuar vivo,
portanto a investigação precisa separar falha da aplicação, dependência de
banco e conectividade.

## Triagem

```bash
curl -i http://127.0.0.1:18080/health/live
curl -i http://127.0.0.1:18080/health/ready
curl -i http://127.0.0.1:18080/health/db
curl -i http://127.0.0.1:18080/api/orders
docker compose ps app business-db
docker compose logs --tail=100 app business-db
```

## Decisão de escalonamento

- `/health/live` falha ou o processo não existe: Sistemas ou Aplicação;
- `/health/live` funciona e `/health/db` falha: DBA;
- conexão à aplicação é recusada: Sistemas;
- DNS ou caminho de rede falha: Redes;
- HTTP 500 com dependências saudáveis: Aplicação.

O escalonamento deve incluir horário, impacto, host, endpoints testados, logs
relevantes e ações já executadas.

## Recuperação do laboratório

```bash
curl -X POST http://127.0.0.1:18080/api/control \
  -H 'content-type: application/json' \
  -d '{"mode":"healthy"}'
```

## Validação

Confirme:

- `/health/live`, `/health/ready`, `/health/db` e `/api/orders` com sucesso;
- problema recuperado em `Monitoring > Problems`;
- ausência de novos erros;
- comunicação de encerramento publicada.
