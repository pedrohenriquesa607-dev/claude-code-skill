// Tarefas que se repetem. Horários no fuso de Brasília (UTC-3, sem horário de verão).
export const TZ_OFFSET_H = -3;

// Próxima execução estritamente depois de `after` (Date). rule: {freq, dow, dom, hour}
// freq: "diaria" | "semanal" (dow 0=dom..6=sáb) | "mensal" (dom 1..28)
export function nextRun(rule, after = new Date()) {
  const hour = Math.min(23, Math.max(0, Number(rule.hour ?? 8)));
  // "local" = horário de Brasília representado nos campos UTC
  const local = new Date(after.getTime() + TZ_OFFSET_H * 3600e3);
  for (let d = 0; d <= 62; d++) {
    const c = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d, hour, 0, 0));
    const ok = rule.freq === "diaria" ||
      (rule.freq === "semanal" && c.getUTCDay() === Number(rule.dow)) ||
      (rule.freq === "mensal" && c.getUTCDate() === Number(rule.dom));
    const utc = new Date(c.getTime() - TZ_OFFSET_H * 3600e3);
    if (ok && utc > after) return utc.toISOString().replace(/\.\d+Z$/, "+00:00");
  }
  throw new Error("regra de repetição inválida");
}

export function describe(rule) {
  const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const h = `${String(rule.hour).padStart(2, "0")}h`;
  if (rule.freq === "diaria") return `todo dia às ${h}`;
  if (rule.freq === "semanal") return `toda ${DOW[rule.dow]} às ${h}`.replace("toda sábado", "todo sábado").replace("toda domingo", "todo domingo");
  return `todo dia ${rule.dom} do mês às ${h}`;
}
