# Solicitações Videira: como colocar no ar

Site para os pastores pedirem pagamentos e ajuste de limite do cartão corporativo.
O site fica hospedado no **GitHub Pages**. O login e os dados ficam no **Firebase**, do Google, no plano gratuito.

- Só o administrador (Financeiro) cria logins, na aba **Pastores**. Ninguém consegue se cadastrar sozinho.
- Cada pastor vê só as próprias solicitações. O Financeiro vê todas.
- Notas fiscais e boletos (até 8 MB) ficam guardados no próprio Firebase.

Tempo estimado na primeira vez: 30 a 40 minutos.

---

## Parte 1: criar o Firebase

1. Acesse **console.firebase.google.com** com o e-mail do financeiro e clique em **Criar projeto**.
   Nome sugerido: `solicitacoes-videira`. O Google Analytics pode ficar desativado.
2. Na tela do projeto, clique no ícone **Web** (`</>`) para adicionar um app.
   Apelido: `site`. **Não** marque "Firebase Hosting". Clique em **Registrar app**.
3. Vai aparecer um bloco `const firebaseConfig = { ... }`. Copie os valores e cole no arquivo
   **firebase-config.js** deste pacote, no lugar de cada `COLE_AQUI`.

## Parte 2: ligar o login

1. Menu da esquerda: **Criação > Authentication > Vamos começar**.
2. Em **Método de login**, escolha **E-mail/senha**, ative a primeira chave e clique em **Salvar**.

## Parte 3: criar a base de dados e as regras de acesso

1. Menu da esquerda: **Criação > Firestore Database > Criar banco de dados**.
2. Local: **southamerica-east1 (São Paulo)**. Modo: **produção**.
3. Abra a aba **Regras**, apague tudo, cole o conteúdo do arquivo **firestore.rules** e clique em **Publicar**.
   São essas regras que garantem que cada pastor veja só o que é dele.

## Parte 4: criar o seu login de administrador (só uma vez)

1. **Authentication > Usuários > Adicionar usuário**: coloque seu e-mail e uma senha.
2. Copie o **UID do usuário** que aparece na lista (um código longo).
3. **Firestore Database > Dados > Iniciar coleção**:
   - ID da coleção: `usuarios`
   - ID do documento: cole o **UID** copiado
   - Campos:

     | Campo  | Tipo    | Valor                 |
     |--------|---------|-----------------------|
     | nome   | string  | Yuri Borges           |
     | email  | string  | seu e-mail            |
     | papel  | string  | admin                 |
     | ativo  | boolean | true                  |
     | predio | string  | (pode deixar vazio)   |

   Clique em **Salvar**.

Os próximos logins (pastores e outras pessoas do financeiro) você cria pelo próprio site.

## Parte 5: publicar no GitHub Pages

1. Em **github.com**, clique em **New repository**. Nome sugerido: `solicitacoes-videira`. Deixe **Public** e crie.
2. Clique em **uploading an existing file** e arraste **todos os arquivos** deste pacote:
   `index.html`, `style.css`, `app.js`, `firebase-config.js`, `logo.png`, `favicon.png`.
   Os arquivos `firestore.rules` e `LEIA-ME.md` podem ir junto, não atrapalham. Clique em **Commit changes**.
3. No repositório: **Settings > Pages**. Em *Source*, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**, e salve.
4. Em 1 a 2 minutos o site fica em: `https://SEU-USUARIO.github.io/solicitacoes-videira/`

## Parte 6: autorizar o endereço do GitHub no Firebase

**Authentication > Configurações > Domínios autorizados > Adicionar domínio**: `SEU-USUARIO.github.io`

Sem esse passo, o login não funciona no site publicado.

---

## Uso no dia a dia

**Cadastrar um pastor:** entre no site, vá em **Pastores**, preencha nome, e-mail, prédio e tipo de acesso.
Clique em **Gerar** para criar uma senha provisória e depois em **Criar login**. Mande o endereço do site, o e-mail e a senha para o pastor.

**Pastor esqueceu a senha:** ele clica em "Esqueci minha senha" na tela de entrada. Você também pode clicar em **Enviar troca de senha** na lista de pastores.

**Pastor saiu da função:** clique em **Bloquear acesso**. Ele não entra mais, e o histórico de solicitações dele continua guardado.

**Outra pessoa do financeiro:** cadastre com o tipo de acesso **Financeiro (vê todas)**.

## Selfie obrigatória

Toda solicitação exige uma selfie tirada na hora, pela câmera do site.
No primeiro uso, o navegador pergunta se o site pode usar a câmera. O pastor precisa tocar em **Permitir**.
Se a câmera não abrir, aparece o botão **Usar a câmera do celular**. Ele só aceita foto tirada nos últimos minutos.
No Painel do financeiro, cada pedido mostra a selfie com data e hora. Clique na foto para ampliar.

A selfie é um dado pessoal. Avise os pastores que a foto é usada só para confirmar quem fez o pedido.

## Perguntas comuns

**A chave do Firebase fica pública no GitHub. Tem problema?**
Não. Essa chave só identifica o projeto. Quem protege os dados são as regras do Firestore,
que exigem login liberado por você.

**E se alguém tentar criar uma conta por fora?**
A conta até pode ser criada, mas sem o cadastro feito por você na aba Pastores ela não acessa nada.
A pessoa vê só a mensagem "Acesso não liberado".

**Tem custo?**
O plano gratuito (Spark) do Firebase inclui 1 GB de dados e 50 mil leituras por dia. Isso é muito mais do que o site usa.
Se um dia chegar perto do limite, o Firebase avisa por e-mail antes de qualquer cobrança. O plano gratuito não cobra nada.

**Alterei algo no site. Como atualizo?**
No GitHub, abra o arquivo, clique no lápis para editar ou suba a nova versão e faça o commit. O site atualiza em 1 a 2 minutos.
