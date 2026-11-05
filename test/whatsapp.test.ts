// O lado do processo do WhatsApp que dá para testar sem o WhatsApp: o que
// vira mensagem na Central e a trava de "só leitura" no código.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paraCentral, textoDe } from '../whatsapp/mensagem.ts';

const agora = Date.parse('2026-11-03T12:00:00Z');
const ts = Math.floor(agora / 1000) - 60;
const m = (o: Record<string, unknown> = {}, key: Record<string, unknown> = {}) =>
  ({ key: { remoteJid: '556299990000@s.whatsapp.net', id: 'ABC', fromMe: false, ...key }, message: { conversation: 'oi' }, messageTimestamp: ts, pushName: 'Bruno', ...o });

test('mensagem comum vira entrada da Central', () => {
  assert.deepEqual(paraCentral(m(), { agora }), {
    chave: '556299990000@s.whatsapp.net', externo: 'ABC', de_mim: false, autor: 'Bruno', titulo: 'Bruno',
    endereco: '556299990000', texto: 'oi', em: new Date(ts * 1000).toISOString(),
  });
});

test('status, grupo, canal, reação, sistema e histórico velho ficam de fora', () => {
  assert.equal(paraCentral(m({}, { remoteJid: 'status@broadcast' }), { agora }), null);
  assert.equal(paraCentral(m({}, { remoteJid: '123-456@g.us' }), { agora }), null);
  assert.ok(paraCentral(m({}, { remoteJid: '123-456@g.us' }), { agora, grupos: true }));
  assert.equal(paraCentral(m({}, { remoteJid: '1@newsletter' }), { agora }), null);
  assert.equal(paraCentral(m({ message: { reactionMessage: { text: '👍' } } }), { agora }), null);
  assert.equal(paraCentral(m({ message: { protocolMessage: { type: 0 } } }), { agora }), null);
  assert.equal(paraCentral(m({ messageTimestamp: ts - 3 * 86400 }), { agora }), null);
});

test('histórico do celular: até 7 dias entra marcado, mais velho fica de fora', () => {
  const x = paraCentral(m({ messageTimestamp: ts - 5 * 86400 }), { agora, historico: true })!;
  assert.equal(x.historico, true);
  assert.equal(paraCentral(m({ messageTimestamp: ts - 8 * 86400 }), { agora, historico: true }), null);
  assert.equal('historico' in paraCentral(m(), { agora })!, false);
});

test('LID vira o número quando ele é conhecido; minha mensagem é "Você"', () => {
  const x = paraCentral(m({}, { remoteJid: '1234567@lid', fromMe: true }), { agora, pn: '556299990000@s.whatsapp.net' })!;
  assert.equal(x.chave, '556299990000@s.whatsapp.net');
  assert.equal(x.autor, 'Você');
  assert.equal(x.titulo, '');
  assert.equal(paraCentral(m({}, { remoteJid: '1234567@lid' }), { agora })!.endereco, '');
});

test('mídia vira rótulo, envelope é aberto', () => {
  assert.equal(textoDe({ imageMessage: { caption: 'nota fiscal' } }), '[imagem] nota fiscal');
  assert.equal(textoDe({ audioMessage: {} }), '[áudio]');
  assert.equal(textoDe({ ephemeralMessage: { message: { extendedTextMessage: { text: 'sumirá' } } } }), 'sumirá');
  assert.equal(textoDe({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'a.pdf' } } } }), '[documento] a.pdf');
});

test('o processo do WhatsApp não tem nenhuma chamada de envio', () => {
  const codigo = readFileSync(new URL('../whatsapp/processo.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const proibido of ['sendMessage', 'readMessages', 'sendPresenceUpdate', 'chatModify', 'sendReceipt', 'relayMessage', 'updateProfile', 'groupCreate']) {
    assert.equal(codigo.includes(proibido), false, proibido);
  }
  assert.match(codigo, /markOnlineOnConnect: false/);
});
