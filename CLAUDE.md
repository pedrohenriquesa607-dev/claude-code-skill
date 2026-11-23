# CLAUDE.md

## Sistema de memória persistente

Este repositório contém uma memória persistente em `memory/`. Ela é a única
coisa que sobrevive entre sessões — o container é efêmero, então **toda
memória precisa ser commitada e enviada (push)** para não se perder.

| Arquivo | O que guarda |
|---|---|
| `memory/user.md` | Quem é o usuário: papel, objetivos, contexto, projetos em andamento |
| `memory/preferences.md` | Como o usuário gosta que eu trabalhe: idioma, estilo, ferramentas, o que evitar |
| `memory/decisions.csv` | Registro de decisões (ver seção abaixo); `decisions.md` só explica o formato |
| `memory/people.md` | Pessoas mencionadas: quem são, relação com o usuário, contexto relevante |

### No início de cada sessão

1. Leia `memory/user.md`, `memory/preferences.md`, `memory/people.md` e `memory/decisions.csv` **antes** de responder à primeira mensagem.
2. Rode `./review.sh`. Se houver decisões com `REVIEW DUE`, avise o usuário
   logo no início e pergunte como cada uma se saiu.
3. Aplique o que estiver lá: siga as preferências, respeite as decisões
   registradas e use o contexto do usuário e das pessoas.
4. Não repita o conteúdo da memória para o usuário, a menos que ele pergunte.
5. Se algo na memória contradizer o que o usuário diz agora, o usuário vence —
   e a memória deve ser corrigida no final.

### Durante a sessão

- Anote mentalmente fatos novos e duradouros: uma preferência expressa
  ("prefiro X"), uma decisão tomada, uma pessoa nova, uma mudança de contexto.
- Se o usuário disser "lembre disso" ou "esqueça isso", atualize a memória
  imediatamente, sem esperar o fim.

### Registro de decisões

Sempre que o usuário descrever uma decisão que está tomando, registre-a na hora:

```bash
scripts/add_decision.sh "decisão" "raciocínio" "resultado esperado"
```

- Extraia decisão, raciocínio e resultado esperado da fala do usuário. Se o
  raciocínio ou o resultado esperado não estiverem claros, pergunte antes de
  registrar.
- A data é hoje e a revisão é automaticamente daqui a 30 dias.
- Confirme ao usuário o número da decisão e a data de revisão.
- Uma verificação diária (`scripts/check_reviews.sh`) marca com `REVIEW DUE`
  as decisões que chegaram à data de revisão. `./review.sh` lista só essas.
- Depois que o usuário revisar uma decisão, mude o `status` para `REVIEWED`.
- Faça commit e push do CSV logo após registrar.

### Inbox Manager (Gmail)

- Roteiro completo: `inbox/INBOX_MANAGER.md`. Estado em
  `inbox/emails_processed.json`, log em `inbox/inbox_manager.log`, ambos
  gravados só por `scripts/inbox_state.py`.
- Classifica e-mails novos em URGENTE / PRECISA DE RESPOSTA / FYI / LIXO e cria
  rascunhos para os dois primeiros. **Nunca envia, nunca apaga.**
- O repositório é público: nunca grave remetentes, assuntos ou conteúdo de
  e-mail em nenhum arquivo do repositório.
- Se o usuário pedir para ativar a execução de hora em hora e o Gmail estiver
  conectado nesta sessão, crie a tarefa agendada (sessão nova a cada execução,
  cron `0 * * * *`, conector Gmail) com o prompt: "Siga inbox/INBOX_MANAGER.md
  no repositório pedrohenriquesa607-dev/claude-code-skill, branch
  claude/magical-brown-x5trn6."

### Painel de tarefas

- Painel publicado: https://painel-tarefas.pedrohenriquesa607.workers.dev
  (Cloudflare Worker `painel-tarefas` + banco D1 `painel-tarefas`, login pelo
  secret `ACCESS_TOKEN`). Código em `cloudflare/`; a Cloudflare publica sozinha a
  cada push na branch padrão `claude/charming-turing-pdpjug` (Workers Builds).
- Funções do painel: modelos de tarefa, prazos (ordem: fazer agora > vence até
  amanhã > prioridade), avisos no celular (Web Push, chaves VAPID na tabela
  `settings`), conversa por tarefa (`comments`), fazer agora (plantão do agente 24h,
  `tasks_cli.py wait-now`), etiquetas, repetições (tabela `recurring` + cron da
  Cloudflare a cada 10 min; o "Resumo da semana" de sexta 20h é criado sozinho),
  busca, compartilhar com cliente (`/s/<token>`, tabela `shares`).
- O agente de hora em hora tem o conector do Canva (slides, artes, imagens, editar fotos);
  a rede do ambiente libera export-download.canva.com e www.canva.com para baixar/enviar arquivos.
- Sem emojis no app, nos avisos e nos resultados do agente (preferência do usuário).
- Mudanças no banco: escrever em `cloudflare/migrations/` e aplicar no D1 real
  (ferramenta d1_database_query) ANTES de publicar o código.
- Arquivos entregues ficam anexados às tarefas (tabela `files` no D1, máx. 1,9 MB;
  `tasks_cli.py attach <id> <arquivo>`) e abrem direto no app.
- `tasks/tasks_cli.py` usa o painel (via `tasks/remote.json`; senha injetada pelo
  proxy). `tasks/tasks.json` e `tasks/tasks.log` são cópias exportadas.
- Versão offline: `TASKS_LOCAL=1` + `python3 tasks/server.py` → http://127.0.0.1:8765.
- Uma tarefa agendada de hora em hora segue `tasks/AGENT.md`: trabalha nas
  pendentes por prioridade, registra o resultado e marca como concluída.

### Ao final de cada sessão (ou ao concluir uma tarefa relevante)

1. Atualize os arquivos de `memory/` com o que mudou. Edite entradas
   existentes em vez de duplicar; remova o que ficou obsoleto.
2. Registre só o que será útil em sessões futuras. Não registre:
   - detalhes passageiros da tarefa atual;
   - coisas que já estão no código ou no histórico do git;
   - senhas, tokens, chaves de API ou outros segredos — **nunca**.
3. Use datas absolutas (`AAAA-MM-DD`), nunca "ontem" ou "semana passada".
4. Commit e push:
   ```bash
   git add memory/ && git commit -m "memory: <resumo do que mudou>" && git push
   ```

### Regras de escrita

- Frases curtas, em português, uma ideia por item.
- Cada arquivo tem um formato de entrada no topo — siga-o.
- Mantenha cada arquivo enxuto (idealmente < 200 linhas). Se crescer demais,
  consolide entradas antigas.
- Informações pessoais ficam neste repositório; não as envie a serviços
  externos.
