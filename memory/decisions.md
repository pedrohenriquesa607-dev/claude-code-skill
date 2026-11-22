# Decisões

Registro de decisões tomadas, da mais recente para a mais antiga.
Formato de cada entrada:

```
## AAAA-MM-DD — <título curto>
- **Decisão:** o que foi decidido
- **Motivo:** por quê
- **Alternativas descartadas:** o que foi considerado e não escolhido
- **Status:** ativa | substituída por <título> | revogada
```

---

## 2026-11-22 — Sistema de memória persistente em arquivos
- **Decisão:** guardar a memória entre sessões em `memory/` (decisions, people,
  preferences, user), com instruções no `CLAUDE.md` para ler no início e
  atualizar no fim de cada sessão.
- **Motivo:** o ambiente é efêmero; arquivos versionados no git são a forma
  confiável de manter contexto entre sessões.
- **Alternativas descartadas:** diretório `/memory` na raiz do sistema (seria
  apagado junto com o container).
- **Status:** ativa
