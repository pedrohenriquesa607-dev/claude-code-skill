# Como o agente publica um site

1. Escolha um nome curto, só com letras minúsculas, números e hífen (ex.: `farmacia-santos`).
   Veja com `python3 tasks/tasks_cli.py site-list` se o nome já existe; se for outro cliente, use outro nome.
2. Monte o site numa pasta de trabalho, ex.: `/tmp/site-<nome>/index.html` (e, se precisar, `style.css`, imagens etc. na mesma pasta).
   - Página única, rápida, pensada primeiro para celular, sem emojis.
   - Botão de WhatsApp (`https://wa.me/55DDDNUMERO?text=...`) só com o número que a tarefa informar;
     sem número, use um marcador visível "[WhatsApp]" e avise no resultado.
   - Imagens: exporte do Canva (PNG/JPG) e salve na pasta; cada arquivo com menos de 1,9 MB.
   - **Site demonstração** (loja fictícia para mostrar a clientes): nome começando com `demo-`
     (ex.: `demo-farmacia`), `<meta name="robots" content="noindex">`, dados de exemplo claramente
     fictícios e um aviso discreto no rodapé "Site de demonstração NexCode".
   - **Site de cliente real**: só com os dados que a tarefa trouxer; sem `noindex`.
   - Nada de dados pessoais do usuário (e-mail, endereço) que a tarefa não pediu.
3. Publique (não depende do GitHub): `python3 tasks/tasks_cli.py site-publish <nome> /tmp/site-<nome>`.
   Para atualizar depois, rode de novo com a mesma pasta e o mesmo nome. `site-list` mostra os sites.
4. Confirme que está no ar: `curl -s -o /dev/null -w "%{http_code}" -A agente https://nexcode.pedrohenriquesa607.workers.dev/<nome>/`
   deve dar 200 na hora.
5. No resultado da tarefa: o link do site, o que tem na página e o que o usuário precisa mandar
   (fotos reais, número de WhatsApp, horário). Anexe também um print (PNG) da página no celular,
   tirado com o Playwright abrindo o link publicado.
6. Cada arquivo do site deve ter menos de 1,9 MB. Guarde também uma cópia em `sites/clientes/<nome>/`
   no repositório se o push funcionar (é só backup; o site no ar vem do banco).

# Formulário no site (inscrição, cadastro)

- O site envia `POST /<nome>/_form` (JSON); o worker `nexcode` valida e grava em `site_form_entries`.
- A configuração fica em `site_forms` (D1, migração `cloudflare/migrations/0004_formularios.sql`):
  campos (`fields`, JSON com name/label/type cpf|phone/required/options), campo que não repete
  (`unique_field`), fim das inscrições (`closes_at`, UTC) e o token secreto do organizador.
- Lista para o organizador: `/<nome>/_inscritos?k=<token>` (`&csv=1` baixa planilha). O token só existe no D1;
  nunca grave no repositório.
- Exemplo pronto: `sites/clientes/corrida-do-oliveira/` (inscrição + Pix Copia e Cola com valor + comprovante no WhatsApp).
