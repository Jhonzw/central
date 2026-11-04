-- A versão anterior permitia mover conversa após convertê-la em tarefa.
-- Preserva a tarefa no espaço original e remove somente o ponteiro incompatível.
UPDATE conversas SET tarefa_id=NULL,versao=versao+1
WHERE tarefa_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM tarefas t JOIN vinculos v ON v.tarefa_id=t.id
 WHERE t.id=conversas.tarefa_id AND t.espaco_id=conversas.espaco_id
 AND v.conversa_id=conversas.id
);
