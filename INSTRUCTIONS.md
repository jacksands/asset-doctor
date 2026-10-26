# Assets Doctor: Instruções

## Como usar
1. Abra a barra lateral, aba **Configurações** (engrenagem), e clique no botão **Assets Doctor** no fim da lista de botões (somente GM). Também dá para abrir por **Configurações do jogo > Módulos > Assets Doctor > Abrir verificador**.
2. Clique em **Verificar**. A barra mostra a etapa (documentos, compêndios, pastas, wildcards). Depois da verificação, a parte "O que verificar" recolhe sozinha para sobrar espaço para a lista.
3. Use as **abas** (Problemas, Quebrados, Atenção, OK, Ignorados): cada aba mostra só aquela situação.
4. A caixa de busca filtra por nome do arquivo, do documento ou da cena. O botão **Filtros** abre os filtros avançados: tipo de mídia, origem (cena, token, pin de journal, playlist...), pasta ou módulo (ex.: `modules/alien-stuff`) e extensão (ex.: `png, webp`). Clique em um chip para mostrar só aquele; clique de novo para tirar. Sem nenhum chip marcado, nada é filtrado.
5. Clique em uma linha para ver onde o arquivo é usado. O botão de seta abre o documento.

Atalho para macro: `game.modules.get("asset-link-doctor").api.open()`

## Trocar caminhos
- **Trocar (um arquivo):** o botão **Trocar** de cada linha troca aquele caminho em **todos os usos de uma vez**. Digite ou cole o caminho novo (com espaços ou com `%20`) ou clique em **Procurar** para escolher o arquivo; o navegador abre na pasta mais próxima que ainda existe.
- **Trocar em lote:** o botão do topo age sobre **todos os itens que estão na lista** (as abas e filtros valem). Três jeitos: o caminho **começa com**, o caminho **contém**, ou **só a extensão** (ex.: `mp3` para `ogg`). Nos dois primeiros dá para mudar também a extensão.
- A janela mostra uma **prévia** (antigo e novo) e se o arquivo novo existe. Por padrão só troca onde o novo existe.
- Antes de aplicar, pede confirmação e **baixa um arquivo de segurança** (.json) com os valores antigos.
- **Desfazer última troca** (botão no topo) restaura os valores antigos. Fica disponível enquanto você não recarregar o Foundry; depois disso, o arquivo de segurança guarda os valores.
- Depois de trocar, a lista é verificada de novo sozinha.
- A troca grava nos documentos do mundo (e em compêndios destravados). Compêndio travado dá erro e aparece na lista de falhas.
- Não são trocados: links externos (http), arquivos do núcleo, nomes de arquivo soltos sem pasta e a lista de pastas do Token Variant Art (é uma configuração do módulo).

## O que verificar (opções da janela)
Cada opção soma uma fonte à verificação. Marque ao menos uma.
- **Apenas assets e arquivos do mundo** (padrão): cenas (inclusive os níveis do V14), atores, itens, playlists, journals (inclusive imagens dentro do texto), tabelas, macros, cartas e usuários deste mundo, mais a lista de pastas de busca do Token Variant Art.
- **Verificar compêndios:** também abre os compêndios deste mundo. A opção **Incluir compêndios de módulos e do sistema** é bem mais lenta.
- **Verificar assets de um módulo:** abre um navegador para escolher um módulo ativo que tenha compêndios e verifica só os compêndios dele. Serve para quem está criando um módulo.
- Wildcards (`pasta/*`): o módulo lista a pasta e confere se existem arquivos do tipo certo (imagem para token, áudio para playlist).

A janela mostra a versão do módulo ao lado do título e, na linha abaixo das abas, o que foi verificado, o total de caminhos e o tempo.

## Por que aparece um link "quebrado" de um módulo desligado?
O Foundry guarda dentro de cada token, ator ou cena os dados que os módulos gravam (campo `flags`). Se você desligar o módulo, os dados ficam lá. O verificador lê tudo isso. Cada uso mostra o módulo dono do dado e se ele está ativo, desligado ou não instalado (mesmo critério do módulo Snoot: ativo, desligado ou órfão). Dado cujo único dono é módulo desligado ou não instalado vai para **Ignorados**.

Alguns módulos guardam cópias de dados de outros. Exemplo: as predefinições do Mass Edit guardam, dentro de `flags.multi-token-edit`, uma cópia dos dados do token, incluindo `flags.barbrawl`. Nesses casos o dono é o módulo mais interno que o Foundry conhece (aqui, o Bar Brawl), e não o que guarda a cópia.

## Situações
- **Quebrados:** arquivo, pasta ou wildcard sem resultado.
- **Atenção:** maiúsculas/minúsculas diferentes, tipo que não combina com o campo, wildcard com arquivos misturados.
- **Ignorados:** links externos (http) e arquivos do núcleo do Foundry (`icons/`, `ui/`...).

## O que ele ignora de propósito (para não dar falso alarme)
- Dados gravados por módulos que estão **desligados** (ex.: um token com dados do Bar Brawl desativado). Aparecem em **Ignorados**, com o nome do módulo.
- Valores de exemplo que alguns módulos gravam por padrão, como `path/image.png`.
- Nomes de arquivo soltos, sem pasta, em campos de módulos (costumam ser rótulos, não links).
- Nomes de arquivo com `#` ou acentos são comparados corretamente.
- Se aparecer um aviso dizendo que o navegador usa arquivos antigos, recarregue com Ctrl+F5.

## Limites desta versão
- Ainda não há arrastar e soltar um arquivo para copiá-lo para a pasta original, nem copiar ou mover arquivos em massa.
- O Foundry não permite apagar nem mover arquivos; os arquivos antigos continuam onde estão.
- A janela tem botão **Maximizar** para ler a lista com mais espaço.
- Miniaturas de cena (`thumb`) são ignoradas, pois o Foundry as recria ao editar a cena.
- Qualquer texto que termine em extensão de mídia conhecida é tratado como caminho. Pode haver um falso positivo raro em campos de módulos.
- Fontes de arquivo diferentes de "data" (S3, Forge) não são verificadas.

## Créditos
Desenvolvido por Jack_Sands para Foundry VTT V14. Ideias estudadas: Asset Auditor, Scene Packer, Pack My World e Snoot.
