# Runbook: alerta não chegou ao Telegram

## Impacto

O monitoramento pode detectar o incidente, mas o operador não recebe a
notificação no canal externo.

## Diagnóstico

1. Confirme se o alerta existe no Alertmanager:

```bash
curl -fsS http://127.0.0.1:9093/api/v2/alerts
```

2. Confirme se o webhook recebeu a notificação:

```bash
curl -fsS http://127.0.0.1:18082/api/history
```

3. Verifique se as credenciais foram carregadas:

```bash
curl -fsS http://127.0.0.1:18082/health
```

4. Consulte os logs:

```bash
docker compose logs --tail=100 alertmanager alert-webhook
```

## Interpretação

- alerta ausente no Alertmanager: revisar regra e métricas no Prometheus;
- alerta presente, mas ausente no webhook: revisar receiver e rede Docker;
- webhook recebeu, mas `telegram.sent=false`: revisar token, `chat_id` e acesso
  à API do Telegram;
- Telegram configurado e sem erro: confirmar que o bot não foi bloqueado e que
  o usuário iniciou a conversa com ele.

## Segurança

Nunca coloque `TELEGRAM_BOT_TOKEN` no Git, README, print ou mensagem de
incidente. Se houver exposição, revogue o token no `@BotFather`.
