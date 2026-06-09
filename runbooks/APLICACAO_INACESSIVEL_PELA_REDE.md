# Runbook: aplicação inacessível pela rede

## Alerta

`ApplicationNetworkProbeFailed`

## Impacto

O Prometheus não consegue acessar a readiness da aplicação a partir da rede
Docker. A causa pode estar no processo, na resolução do nome, na porta ou na
conectividade entre containers.

## Diagnóstico

```bash
docker compose ps app blackbox-exporter prometheus
docker compose exec prometheus wget -S -O- http://app:18080/health/ready
docker compose exec prometheus getent hosts app
docker compose logs --tail=100 app blackbox-exporter prometheus
```

Interprete antes de restaurar:

- `connection refused`: nome e rota funcionam, mas não há serviço aceitando na
  porta;
- `bad address` ou ausência no `getent`: falha de resolução DNS;
- timeout: há caminho incompleto, filtro ou serviço sem resposta;
- HTTP 503: a rede funciona, mas a aplicação não está pronta.

## Simulação controlada

```bash
docker compose stop app
```

Confirme `probe_success=0` no Prometheus e aguarde o alerta. O objetivo é
observar uma conexão recusada, não apenas o status do container.

## Recuperação

```bash
docker compose start app
curl -fsS http://127.0.0.1:18080/health/ready
make infrastructure-test
```

Confirme `probe_success=1` e o alerta resolvido.
