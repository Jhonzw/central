-- Núcleo: espaços (um por empresa ou vida), pessoas com seus canais, tarefas
-- com anotações, e o registro de toda alteração.
--
-- Todo dado de trabalho pertence a UM espaço (espaco_id NOT NULL). A pessoa é
-- a exceção: a mesma pessoa pode aparecer em mais de um espaço, e por isso o
-- vínculo fica em pessoa_espaco.

CREATE TABLE espacos (
  id         TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND length(id) BETWEEN 2 AND 30),
  nome       TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  cor        TEXT NOT NULL DEFAULT '#0e5a55' CHECK (cor GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
  ordem      INTEGER NOT NULL DEFAULT 0,
  arquivado  INTEGER NOT NULL DEFAULT 0 CHECK (arquivado IN (0, 1)),
  criado     TEXT NOT NULL
);

CREATE TABLE pessoas (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  notas      TEXT NOT NULL DEFAULT '',
  criado     TEXT NOT NULL,
  atualizado TEXT NOT NULL
);

CREATE TABLE pessoa_espaco (
  pessoa_id  INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  espaco_id  TEXT NOT NULL REFERENCES espacos(id),
  papel      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (pessoa_id, espaco_id)
);

-- Canal = um jeito de falar com a pessoa. O valor é guardado normalizado
-- (e-mail em minúsculas, telefone só dígitos com DDI), o que deixa o mesmo
-- número vindo do WhatsApp e da agenda cair na mesma pessoa.
CREATE TABLE canais (
  id         INTEGER PRIMARY KEY,
  pessoa_id  INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('email', 'whatsapp', 'telefone', 'outro')),
  valor      TEXT NOT NULL CHECK (length(valor) BETWEEN 3 AND 200),
  UNIQUE (tipo, valor)
);

CREATE TABLE tarefas (
  id         INTEGER PRIMARY KEY,
  espaco_id  TEXT NOT NULL REFERENCES espacos(id),
  titulo     TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  status     TEXT NOT NULL DEFAULT 'a-fazer' CHECK (status IN ('a-fazer', 'fazendo', 'aguardando', 'feito', 'cancelado')),
  pessoa_id  INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  proxima    TEXT CHECK (proxima IS NULL OR proxima GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  origem     TEXT NOT NULL DEFAULT '',
  criado     TEXT NOT NULL,
  atualizado TEXT NOT NULL,
  concluido  TEXT
);
CREATE INDEX tarefas_espaco_status ON tarefas (espaco_id, status);

CREATE TABLE anotacoes (
  id         INTEGER PRIMARY KEY,
  tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  texto      TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  em         TEXT NOT NULL
);

-- Toda escrita deixa linha aqui na mesma transação: é o histórico e, mais
-- tarde, a fila para gerar as notas do Obsidian.
CREATE TABLE alteracoes (
  id         INTEGER PRIMARY KEY,
  tabela     TEXT NOT NULL,
  registro   TEXT NOT NULL,
  acao       TEXT NOT NULL CHECK (acao IN ('criou', 'alterou', 'apagou')),
  dados      TEXT NOT NULL,
  em         TEXT NOT NULL
);
