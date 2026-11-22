# CLAUDE.md

## Sistema de memória persistente

Este repositório contém uma memória persistente em `memory/`. Ela é a única
coisa que sobrevive entre sessões — o container é efêmero, então **toda
memória precisa ser commitada e enviada (push)** para não se perder.

| Arquivo | O que guarda |
|---|---|
| `memory/user.md` | Quem é o usuário: papel, objetivos, contexto, projetos em andamento |
| `memory/preferences.md` | Como o usuário gosta que eu trabalhe: idioma, estilo, ferramentas, o que evitar |
| `memory/decisions.md` | Decisões tomadas (técnicas ou não), com data, motivo e alternativas descartadas |
| `memory/people.md` | Pessoas mencionadas: quem são, relação com o usuário, contexto relevante |

### No início de cada sessão

1. Leia os quatro arquivos em `memory/` **antes** de responder à primeira mensagem.
2. Aplique o que estiver lá: siga as preferências, respeite as decisões
   registradas e use o contexto do usuário e das pessoas.
3. Não repita o conteúdo da memória para o usuário, a menos que ele pergunte.
4. Se algo na memória contradizer o que o usuário diz agora, o usuário vence —
   e a memória deve ser corrigida no final.

### Durante a sessão

- Anote mentalmente fatos novos e duradouros: uma preferência expressa
  ("prefiro X"), uma decisão tomada, uma pessoa nova, uma mudança de contexto.
- Se o usuário disser "lembre disso" ou "esqueça isso", atualize a memória
  imediatamente, sem esperar o fim.

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
