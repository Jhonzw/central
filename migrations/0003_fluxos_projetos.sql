CREATE TABLE projetos (
 id INTEGER PRIMARY KEY,
 espaco_id TEXT NOT NULL REFERENCES espacos(id),
 nome TEXT NOT NULL CHECK(length(nome) BETWEEN 1 AND 200),
 objetivo TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','pausado','concluido','arquivado')),
 proxima_acao TEXT NOT NULL DEFAULT '', prazo TEXT, notas TEXT NOT NULL DEFAULT '',
 versao INTEGER NOT NULL DEFAULT 1, criado TEXT NOT NULL, atualizado TEXT NOT NULL
);
CREATE INDEX projetos_espaco ON projetos(espaco_id,status);
ALTER TABLE tarefas ADD COLUMN projeto_id INTEGER REFERENCES projetos(id);
ALTER TABLE tarefas ADD COLUMN descricao TEXT NOT NULL DEFAULT '';
ALTER TABLE tarefas ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'normal' CHECK(prioridade IN ('baixa','normal','alta','urgente'));
ALTER TABLE tarefas ADD COLUMN prazo TEXT;
ALTER TABLE tarefas ADD COLUMN lembrete TEXT;
ALTER TABLE tarefas ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tarefas ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE conversas ADD COLUMN triada INTEGER NOT NULL DEFAULT 0 CHECK(triada IN(0,1));
ALTER TABLE conversas ADD COLUMN adiada_ate TEXT;
ALTER TABLE conversas ADD COLUMN cobrar_em TEXT;
ALTER TABLE conversas ADD COLUMN pendente_desde TEXT;
ALTER TABLE conversas ADD COLUMN visto_em TEXT;
ALTER TABLE conversas ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
UPDATE conversas SET pendente_desde=ultima_em WHERE estado IN('responder','esperando');
CREATE TABLE vinculos (
 id INTEGER PRIMARY KEY, conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
 tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
 mensagem_id INTEGER REFERENCES mensagens(id) ON DELETE CASCADE,
 criado TEXT NOT NULL
);
CREATE UNIQUE INDEX vinculos_unicos ON vinculos(conversa_id,tarefa_id,coalesce(mensagem_id,0));
CREATE TABLE operacoes_tarefa (
 operacao TEXT PRIMARY KEY, conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
 payload TEXT NOT NULL, tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE
);
INSERT INTO vinculos(conversa_id,tarefa_id,criado)
 SELECT c.id,t.id,c.ultima_em FROM conversas c JOIN tarefas t ON t.id=c.tarefa_id AND t.espaco_id=c.espaco_id;
CREATE TRIGGER vinculo_validar BEFORE INSERT ON vinculos BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tarefas t JOIN conversas c ON c.id=new.conversa_id WHERE t.id=new.tarefa_id AND t.espaco_id=c.espaco_id)
 THEN RAISE(ABORT,'vínculo exige o mesmo espaço') END;
 SELECT CASE WHEN new.mensagem_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mensagens WHERE id=new.mensagem_id AND conversa_id=new.conversa_id)
 THEN RAISE(ABORT,'mensagem de outra conversa') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tarefas t JOIN projetos p ON p.id=t.projeto_id WHERE t.id=new.tarefa_id AND p.status<>'ativo')
 THEN RAISE(ABORT,'projeto deve estar ativo') END;
END;
CREATE TRIGGER tarefa_projeto_inserir BEFORE INSERT ON tarefas WHEN new.projeto_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projetos WHERE id=new.projeto_id AND espaco_id=new.espaco_id AND status='ativo') THEN RAISE(ABORT,'projeto deve estar ativo no mesmo espaço') END;
END;
CREATE TRIGGER tarefa_projeto_alterar BEFORE UPDATE OF projeto_id,espaco_id ON tarefas BEGIN
 SELECT CASE WHEN new.projeto_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projetos WHERE id=new.projeto_id AND espaco_id=new.espaco_id AND status='ativo') THEN RAISE(ABORT,'projeto deve estar ativo no mesmo espaço') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM vinculos v JOIN conversas c ON c.id=v.conversa_id WHERE v.tarefa_id=new.id AND c.espaco_id<>new.espaco_id) THEN RAISE(ABORT,'vínculo exige o mesmo espaço') END;
END;
CREATE TRIGGER conversa_espaco_alterar BEFORE UPDATE OF espaco_id ON conversas BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM vinculos v JOIN tarefas t ON t.id=v.tarefa_id WHERE v.conversa_id=new.id AND t.espaco_id<>new.espaco_id) THEN RAISE(ABORT,'desvincule as tarefas antes de mover a conversa') END;
END;
CREATE TRIGGER projeto_espaco_alterar BEFORE UPDATE OF espaco_id ON projetos BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tarefas WHERE projeto_id=new.id AND espaco_id<>new.espaco_id) THEN RAISE(ABORT,'projeto possui tarefas em outro espaço') END;
END;
