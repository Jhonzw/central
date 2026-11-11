-- Notas do Obsidian, lidas do banco de sincronização (Self-hosted LiveSync).
-- A Central só guarda uma cópia para buscar e mostrar: o editor é o Obsidian.

CREATE TABLE notas (
  id INTEGER PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,           -- id do documento no CouchDB
  caminho TEXT NOT NULL,                -- caminho no vault, como o Obsidian mostra
  titulo TEXT NOT NULL,                 -- nome do arquivo, sem extensão
  pasta TEXT NOT NULL DEFAULT '',       -- pasta dentro do vault ('' = raiz)
  espaco_id TEXT REFERENCES espacos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'arquivo')),
  texto TEXT NOT NULL DEFAULT '',       -- vazio para 'arquivo' (imagem, PDF)
  tamanho INTEGER NOT NULL DEFAULT 0,
  criada TEXT,
  modificada TEXT,
  rev TEXT NOT NULL,                    -- revisão do documento já lida
  lida_em TEXT NOT NULL
);
CREATE INDEX notas_pasta ON notas (pasta, titulo);
CREATE INDEX notas_modificada ON notas (modificada DESC);
CREATE INDEX notas_espaco ON notas (espaco_id);

-- Busca nas notas (sem acento, sem caixa), igual à das mensagens.
CREATE VIRTUAL TABLE notas_busca USING fts5 (
  titulo, caminho, texto, content = 'notas', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER notas_bi AFTER INSERT ON notas BEGIN
  INSERT INTO notas_busca (rowid, titulo, caminho, texto) VALUES (new.id, new.titulo, new.caminho, new.texto);
END;
CREATE TRIGGER notas_bd AFTER DELETE ON notas BEGIN
  INSERT INTO notas_busca (notas_busca, rowid, titulo, caminho, texto) VALUES ('delete', old.id, old.titulo, old.caminho, old.texto);
END;
CREATE TRIGGER notas_bu AFTER UPDATE ON notas BEGIN
  INSERT INTO notas_busca (notas_busca, rowid, titulo, caminho, texto) VALUES ('delete', old.id, old.titulo, old.caminho, old.texto);
  INSERT INTO notas_busca (rowid, titulo, caminho, texto) VALUES (new.id, new.titulo, new.caminho, new.texto);
END;

-- Uma nota pode ser ligada a pessoas e projetos.
CREATE TABLE nota_vinculos (
  id INTEGER PRIMARY KEY,
  nota_id INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  pessoa_id INTEGER REFERENCES pessoas(id) ON DELETE CASCADE,
  projeto_id INTEGER REFERENCES projetos(id) ON DELETE CASCADE,
  criado TEXT NOT NULL,
  CHECK ((pessoa_id IS NULL) <> (projeto_id IS NULL))
);
CREATE UNIQUE INDEX nota_vinculos_pessoa ON nota_vinculos (nota_id, pessoa_id) WHERE pessoa_id IS NOT NULL;
CREATE UNIQUE INDEX nota_vinculos_projeto ON nota_vinculos (nota_id, projeto_id) WHERE projeto_id IS NOT NULL;

-- Até onde a leitura do banco de sincronização já foi (seq do _changes) e o último resultado.
CREATE TABLE notas_estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
