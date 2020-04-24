'use strict';

const assert = require('assert');
const RedisPool = require('..');
const { promisify } = require('util');

const MAX_POOLS = 2
const TEST_OPTIONS = {
  max: MAX_POOLS,
  idleTimeoutMillis: 1,
  reapIntervalMillis: 1,
  port: 6379
};

describe('RedisPool', function () {
  it('RedisPool object exists', function () {
    assert.ok(RedisPool);
  });

  it('RedisPool can create new RedisPool objects with default settings', function () {
    const redisPool = new RedisPool()
    assert.ok(redisPool)
  });

  it('RedisPool can create new RedisPool objects with specific settings', function () {
    const options = Object.assign({ host: '127.0.0.1', port: '6379' }, TEST_OPTIONS)
    const redisPool = new RedisPool(options)
    assert.ok(redisPool)
  });

  it('pool has proper size, available and pending', async function () {
    const DATABASE = 0

    const options = Object.assign(TEST_OPTIONS)
    const redisPool = new RedisPool(options)

    const client1 = await redisPool.acquire(DATABASE)
    const client2 = await redisPool.acquire(DATABASE)

    let pool = redisPool.pools[DATABASE]

    assert.equal(pool.size, 2)
    assert.equal(pool.available, 0)
    assert.equal(pool.pending, 0)

    await redisPool.release(0, client1); // needed to exit tests
    await redisPool.release(0, client2); // needed to exit tests
  });

  it('new command only works after adding it to Redis', async function () {
    const NEW_COMMAND = 'fakeCommand'

    let redisPool = new RedisPool(TEST_OPTIONS)
    let client = await redisPool.acquire(0)
    assert.strictEqual(client[NEW_COMMAND], undefined);
    await redisPool.release(0, client);

    const options = Object.assign(
      TEST_OPTIONS,
      { commands: ['fakeCommand'] }
    );
    redisPool = new RedisPool(options);

    client = await redisPool.acquire(0)
    const fakeCommand = promisify(client[NEW_COMMAND]).bind(client);

    const response = await fakeCommand('key').catch(async (error) => {
      assert.equal(error.name, 'ReplyError');
      assert.ok(error.message.startsWith("ERR unknown command"));
      assert.ok(error.message.includes('fakeCommand'));
    })

    assert.ok(response === undefined)

    await redisPool.release(0, client); // needed to exit tests
  });

  it('pool object has an acquire function', function () {
    const redisPool = new RedisPool(TEST_OPTIONS)
    assert.ok(typeof redisPool.acquire === 'function');
  });

  it('calling aquire returns a redis client object that can get/set', async function () {
    const redisPool = new RedisPool(TEST_OPTIONS)
    const client = await redisPool.acquire(0)

    const set = promisify(client.set).bind(client);
    const get = promisify(client.get).bind(client);

    await set('key', 'value');
    const data = await get('key');
    assert.equal(data, 'value');

    await redisPool.release(0, client); // needed to exit tests
  });

  it('calling aquire on another DB returns a redis client object that can get/set', async function () {
    const redisPool = new RedisPool(TEST_OPTIONS)
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
    const redisPool = new RedisPool(TEST_OPTIONS)

    let client1 = await redisPool.acquire(0)
    let client2 = await redisPool.acquire(0)

    client1.WATCH('k');
    await redisPool.release(0, client1);
    client1 = null;

    client1 = await redisPool.acquire(0);

    // We expect this to be not watching now..
    const tx1 = client1.MULTI();
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
    const redisPool = new RedisPool(Object.assign(TEST_OPTIONS, enabledSlowPoolConfig));
    const client = await redisPool.acquire(0);

    // restore functions
    console.log = consoleLogFunc;
    Date.now = dateNowFunc;

    redisPool.release(0, client);
    assert.ok(logWasCalled);
  });

  it('emits `status` event after pool has been used', async function () {
    const DATABASE = 0;
    const redisPool = new RedisPool(Object.assign(TEST_OPTIONS, { emitter: { statusInterval: 5 } }));

    const client = await redisPool.acquire(DATABASE)

    return new Promise(resolve => {
      redisPool.once('status', async status => {
        assert.equal(status.db, DATABASE);
        await redisPool.release(DATABASE, client);
        resolve()
      });
    })
  });
});
