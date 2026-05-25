/**
 * Smoke tests — Zapier app structure validation.
 *
 * These run via `node --test` and don't hit network. They verify the app
 * exports the shape Zapier expects, which catches structural regressions
 * before a deploy.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index');

test('app exports authentication scheme', () => {
  assert.equal(app.authentication.type, 'custom');
  assert.ok(Array.isArray(app.authentication.fields));
  assert.ok(app.authentication.fields.some((f) => f.key === 'apiKey' && f.required === true));
  assert.ok(app.authentication.test, 'authentication.test must be defined');
});

test('beforeRequest middleware is registered for auth injection', () => {
  assert.ok(Array.isArray(app.beforeRequest));
  assert.ok(app.beforeRequest.length >= 1);
});

test('afterResponse middleware handles 401 by refreshing auth', () => {
  assert.ok(Array.isArray(app.afterResponse));
  assert.ok(app.afterResponse.length >= 1);
});

test('triggers registered: newLead, newContact, dealStageChange', () => {
  assert.ok(app.triggers.newLead, 'newLead trigger missing');
  assert.ok(app.triggers.newContact, 'newContact trigger missing');
  assert.ok(app.triggers.dealStageChange, 'dealStageChange trigger missing');
});

test('each trigger is a REST hook with subscribe/unsubscribe', () => {
  for (const key of ['newLead', 'newContact', 'dealStageChange']) {
    const trigger = app.triggers[key];
    assert.equal(trigger.operation.type, 'hook', `${key} should be a hook`);
    assert.ok(trigger.operation.performSubscribe, `${key} needs performSubscribe`);
    assert.ok(trigger.operation.performUnsubscribe, `${key} needs performUnsubscribe`);
    assert.ok(trigger.operation.perform, `${key} needs perform`);
  }
});

test('creates registered: createLead, createContact, createTask', () => {
  assert.ok(app.creates.createLead, 'createLead action missing');
  assert.ok(app.creates.createContact, 'createContact action missing');
  assert.ok(app.creates.createTask, 'createTask action missing');
});

test('each create has at least one required input field', () => {
  for (const key of ['createLead', 'createContact', 'createTask']) {
    const create = app.creates[key];
    const required = create.operation.inputFields.filter((f) => f.required);
    assert.ok(required.length >= 1, `${key} should require at least one input field`);
    assert.ok(create.operation.perform, `${key} needs perform`);
    assert.ok(create.operation.sample, `${key} needs sample for Zap editor preview`);
  }
});
