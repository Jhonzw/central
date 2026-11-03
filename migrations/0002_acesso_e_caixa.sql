-- Acesso (o dono, sessões, convites, tokens) e a caixa (contas de e-mail e
-- WhatsApp, conversas e mensagens). Segredo nenhum fica legível aqui: o que
-- é sensível chega cifrado pelo cofre, e token/sessão/convite só têm o hash.

-- Uma pessoa só usa a Central: o dono.
CREATE TABLE dono (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  senha       TEXT NOT NULL,              -- scrypt
  totp        TEXT NOT NULL,              -- segredo do autenticador, cifrado
  ultimo_passo INTEGER NOT NULL DEFAULT 0, -- último código aceito (não vale de novo)
  criado      TEXT NOT NULL,
  atualizado  TEXT NOT NULL
);

-- Convite de uso único para o primeiro acesso (ou para trocar senha e
-- autenticador). Quem cria a senha é o dono, no navegador dele.
CREATE TABLE convites (
  hash        TEXT PRIMARY KEY,
  expira      TEXT NOT NULL,
  senha       TEXT,                       -- preenchidos no passo 1, valem no passo 2
  totp        TEXT,
  criado      TEXT NOT NULL
);

CREATE TABLE sessoes (
  hash        TEXT PRIMARY KEY,
  criado      TEXT NOT NULL,
  visto       TEXT NOT NULL,
  expira      TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  agente      TEXT NOT NULL DEFAULT ''
);

-- Tentativas erradas de entrar, para travar por IP e no geral.
CREATE TABLE tentativas (
  id          INTEGER PRIMARY KEY,
  ip          TEXT NOT NULL,
  em          TEXT NOT NULL
);
CREATE INDEX tentativas_em ON tentativas (em);

-- Token de máquina: o painel que empurra o resumo, o WhatsApp e o MCP.
-- escopo: 'leitura' | 'fonte:<conector>' | 'whatsapp:<conta>'
CREATE TABLE tokens (
  id          INTEGER PRIMARY KEY,
  nome        TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  escopo      TEXT NOT NULL CHECK (escopo = 'leitura' OR escopo GLOB 'fonte:?*' OR escopo GLOB 'whatsapp:?*'),
  hash        TEXT NOT NULL UNIQUE,
  criado      TEXT NOT NULL,
  usado       TEXT,
  revogado    TEXT
);

-- Última leitura de cada fonte que empurra (em vez de ser lida).
CREATE TABLE fontes_empurradas (
  conector    TEXT PRIMARY KEY,
  itens       TEXT NOT NULL,
  em          TEXT NOT NULL
);

-- Conta = uma caixa de e-mail ou um número de WhatsApp, num espaço.
CREATE TABLE contas (
  id          TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND length(id) BETWEEN 2 AND 30),
  espaco_id   TEXT NOT NULL REFERENCES espacos(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('email', 'whatsapp')),
  nome        TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  endereco    TEXT NOT NULL DEFAULT '',   -- o e-mail da caixa ou o número
  config      TEXT NOT NULL DEFAULT '{}', -- host, porta, usuário, pasta (sem senha)
  segredo     TEXT,                       -- senha cifrada
  ativa       INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
  estado      TEXT NOT NULL DEFAULT '{}', -- até onde já leu
  lida_em     TEXT,
  erro        TEXT,
  criado      TEXT NOT NULL
);

-- Conversa = um assunto de e-mail ou um chat de WhatsApp. É ela que tem
-- estado (responder / esperando / resolvida / arquivada) e nota interna.
CREATE TABLE conversas (
  id          INTEGER PRIMARY KEY,
  conta_id    TEXT NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  espaco_id   TEXT NOT NULL REFERENCES espacos(id),
  chave       TEXT NOT NULL,              -- 1ª Message-ID da troca, ou o JID
  titulo      TEXT NOT NULL DEFAULT '',
  endereco    TEXT NOT NULL DEFAULT '',   -- e-mail ou número de quem fala comigo
  pessoa_id   INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  estado      TEXT NOT NULL DEFAULT 'responder' CHECK (estado IN ('responder', 'esperando', 'resolvida', 'arquivada')),
  movida      INTEGER NOT NULL DEFAULT 0, -- 1 = o dono escolheu o espaço; não mexer sozinho
  nota        TEXT NOT NULL DEFAULT '',   -- nota interna: nunca sai daqui
  tarefa_id   INTEGER REFERENCES tarefas(id) ON DELETE SET NULL,
  ultima_em   TEXT NOT NULL,
  UNIQUE (conta_id, chave)
);
CREATE INDEX conversas_espaco_estado ON conversas (espaco_id, estado, ultima_em);
CREATE INDEX conversas_endereco ON conversas (endereco);

CREATE TABLE mensagens (
  id          INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  externo     TEXT NOT NULL,              -- Message-ID ou id do WhatsApp
  de_mim      INTEGER NOT NULL DEFAULT 0 CHECK (de_mim IN (0, 1)),
  autor       TEXT NOT NULL DEFAULT '',
  assunto     TEXT NOT NULL DEFAULT '',
  texto       TEXT NOT NULL DEFAULT '',   -- só um trecho; some depois da retenção
  em          TEXT NOT NULL,
  UNIQUE (conversa_id, externo)
);
CREATE INDEX mensagens_em ON mensagens (em);

-- Busca nas mensagens (sem acento, sem caixa).
CREATE VIRTUAL TABLE mensagens_busca USING fts5 (
  autor, assunto, texto, content = 'mensagens', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER mensagens_bi AFTER INSERT ON mensagens BEGIN
  INSERT INTO mensagens_busca (rowid, autor, assunto, texto) VALUES (new.id, new.autor, new.assunto, new.texto);
END;
CREATE TRIGGER mensagens_bd AFTER DELETE ON mensagens BEGIN
  INSERT INTO mensagens_busca (mensagens_busca, rowid, autor, assunto, texto) VALUES ('delete', old.id, old.autor, old.assunto, old.texto);
END;
CREATE TRIGGER mensagens_bu AFTER UPDATE ON mensagens BEGIN
  INSERT INTO mensagens_busca (mensagens_busca, rowid, autor, assunto, texto) VALUES ('delete', old.id, old.autor, old.assunto, old.texto);
  INSERT INTO mensagens_busca (rowid, autor, assunto, texto) VALUES (new.id, new.autor, new.assunto, new.texto);
END;
