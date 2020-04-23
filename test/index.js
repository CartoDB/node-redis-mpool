'use strict';

const assert = require('assert');
const RedisPool = require('..');
const { promisify } = require('util');

var redisPool;

describe('RedisPool', function () {
  beforeEach(function () {
    this.test_opts = {
      max: 10,
      idleTimeoutMillis: 1,
      reapIntervalMillis: 1,
      port: 6379
    };

    redisPool = new RedisPool(this.test_opts);
  });

  afterEach(function() {
    redisPool = null
  })

  it('RedisPool object exists', function () {
    assert.ok(RedisPool);
  });

  it('RedisPool can create new RedisPool objects with default settings', function () {
    const redisPool = new RedisPool()
    assert.ok(redisPool)
  });

  it('RedisPool can create new RedisPool objects with specific settings', function () {
    const options = Object.assign({ host: '127.0.0.1', port: '6379' }, this.test_opts)
    const redisPool = new RedisPool(options)
    assert.ok(redisPool)
  });

  it('Adding new command should works (but throws because the command not exists in Redis)', async function () {
    const options = Object.assign(
      this.test_opts,
      { commands: ['fakeCommand'] }
    );
    const redisPool = new RedisPool(options);

    const client = await redisPool.acquire(0)
    const fakeCommand = promisify(client.fakeCommand).bind(client);

    await fakeCommand('key').catch(async (error) => {
      assert.equal(error.name, 'ReplyError');
      assert.equal(error.message, "ERR unknown command 'fakeCommand'");
    })

    await redisPool.release(0, client); // needed to exit tests
  });

  it('Not added command should not works', async function () {
    const client = await redisPool.acquire(0)
    assert.strictEqual(client.fakeCommand, undefined);
    await redisPool.release(0, client); // needed to exit tests
  });

  it('pool object has an acquire function', function () {
    assert.ok(typeof redisPool.acquire === 'function');
  });

  it('calling aquire returns a redis client object that can get/set', async function () {
    const client = await redisPool.acquire(0)
    const set = promisify(client.set).bind(client);
    const get = promisify(client.get).bind(client);

    await set('key', 'value');
    const data = await get('key');
    assert.equal(data, 'value');

    await redisPool.release(0, client); // needed to exit tests
  });

  it('calling aquire on another DB returns a redis client object that can get/set', async function () {
    const client = await redisPool.acquire(2)
    const set = promisify(client.set).bind(client);
    const get = promisify(client.get).bind(client);

    await set('key', 'value');
    const data = await get('key');
    assert.equal(data, 'value');

    await redisPool.release(2, client); // needed to exit tests
  });

  // See https://github.com/CartoDB/node-redis-mpool/issues/1
  it('calling release resets connection state', async function () {
    var tx1;

    let client1 = await redisPool.acquire(0)
    let client2 = await redisPool.acquire(0)

    client1.WATCH('k');
    await redisPool.release(0, client1);
    client1 = null;

    client1 = await redisPool.acquire(0, this);

    // We expect this to be not watching now..
    tx1 = client1.MULTI();
    tx1.SET('x', 1); // 'x' will be set to 1 only if we're not watching
    const set2 = promisify(client2.set).bind(client2);
    await set2('k', 1);

    // This would fail if we're watching
    const execTx1 = promisify(tx1.exec).bind(tx1);
    const res = await execTx1()
    assert.ok(res, 'Transaction unexpectedly aborted'); // we expect to succeeded
    assert.equal(res.length, 1);

    await redisPool.release(0, client1);
    await redisPool.release(0, client2);
  });

  it('log is called if elapsed time is above configured one', async function () {
    let logWasCalled = false;
    const elapsedThreshold = 25;
    const enabledSlowPoolConfig = {
      slowPool: {
        log: true,
        elapsedThreshold
      }
    };

    let times = 0;
    const dateNowFunc = Date.now;
    Date.now = function () {
      return times++ * elapsedThreshold * 2;
    };

    const consoleLogFunc = console.log;
    console.log = function (what) {
      const whatObj = JSON.parse(what);
      logWasCalled = whatObj && whatObj.action && whatObj.action === 'acquire';
      consoleLogFunc.apply(console, arguments);
    };

    // test
    const redisPool = new RedisPool(Object.assign(this.test_opts, enabledSlowPoolConfig));
    const client = await redisPool.acquire(0);

    // restore functions
    console.log = consoleLogFunc;
    Date.now = dateNowFunc;

    redisPool.release(0, client);
    assert.ok(logWasCalled);
  });

  it('emits `status` event after pool has been used', function (done) {
    var database = 0;
    var redisPool = new RedisPool(Object.assign(this.test_opts, { emitter: { statusInterval: 5 } }));
    redisPool.acquire(database, function (err, client) {
      redisPool.release(database, client);
    });
    var doneCalled = false;
    redisPool.on('status', function (status) {
      assert.equal(status.db, database);
      if (!doneCalled) {
        doneCalled = true;
        done();
      }
    });
  });
});
