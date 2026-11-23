# Como o agente publica um site

1. Escolha um nome curto, só com letras minúsculas, números e hífen (ex.: `farmacia-santos`).
   Se a pasta `sites/public/<nome>/` já existir e não for o mesmo cliente, use outro nome.
2. Crie `sites/public/<nome>/index.html` (e, se precisar, `style.css`, imagens etc. na mesma pasta).
   - Página única, rápida, pensada primeiro para celular, sem emojis.
   - Botão de WhatsApp (`https://wa.me/55DDDNUMERO?text=...`) só com o número que a tarefa informar;
     sem número, use um marcador visível "[WhatsApp]" e avise no resultado.
   - Imagens: exporte do Canva (PNG/JPG) e salve na pasta; cada arquivo com menos de 5 MB.
   - Coloque `<meta name="robots" content="noindex">` em sites de demonstração.
   - Nada de dados pessoais do usuário (e-mail, endereço) que a tarefa não pediu.
3. Commit e push para `claude/magical-brown-x5trn6` **e** `claude/charming-turing-pdpjug`
   (a Cloudflare publica a partir da segunda em 1 a 2 minutos).
4. Confirme que está no ar: `curl -s -o /dev/null -w "%{http_code}" -A agente https://nexcode.pedrohenriquesa607.workers.dev/<nome>/`
   até dar 200 (tente por até 5 minutos).
5. No resultado da tarefa: o link do site, o que tem na página e o que o usuário precisa mandar
   (fotos reais, número de WhatsApp, horário). Anexe também um print (PNG) da página no celular,
   tirado com o Playwright abrindo o arquivo local (`file://.../sites/public/<nome>/index.html`).
6. Se o `curl` do passo 4 for bloqueado pela rede, não é erro do site: confira só pelo print local
   e diga no resultado que o link fica no ar em até 2 minutos.
