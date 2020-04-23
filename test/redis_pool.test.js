'use strict';

var assert = require('assert')
  , Step = require('step')
  , _ = require('underscore')
  , RedisPool = require('../')
  , tests = module.exports = {};

var redis_pool

describe('RedisPool', function () {

  before(function() {
    this.test_opts = {
      max: 10,
      idleTimeoutMillis: 1,
      reapIntervalMillis: 1,
      port: 6379
    }

    redis_pool = new RedisPool(this.test_opts);
  })

  it('RedisPool object exists', function (done) {
    assert.ok(RedisPool);
    done();
  });

  it('RedisPool can create new RedisPool objects with default settings', function (done) {
    new RedisPool();
    done();
  });

  it('RedisPool can create new RedisPool objects with specific settings', function (done) {
    new RedisPool(_.extend({ host: '127.0.0.1', port: '6379' }, this.test_opts));
    done();
  });

  it('Not added command should not works', function (done) {
    redis_pool.acquire(0, function (err, client) {
      if (err) { done(err); return; }

      assert.strictEqual(client['fakeCommand'], undefined);
      redis_pool.release(0, client); // needed to exit tests

      done();
    });
  });

  it('Adding new command should works (but throws because the command not exists in Redis)', function (done) {
    var commandsRedisPool = new RedisPool(_.extend(
      this.test_opts,
      {
        commands: ['fakeCommand']
      }
    ));

    commandsRedisPool.acquire(0, function (err, client) {
      if (err) { done(err); return; }

      client['fakeCommand']("key", function (err, data) {
        assert.equal(err.name, "ReplyError");
        assert.equal(err.message, "ERR unknown command 'fakeCommand'")
        commandsRedisPool.release(0, client); // needed to exit tests

        done();
      })
    });
  });

  it('pool object has an acquire function', function (done) {
    var found = false;
    var functions = _.functions(redis_pool);
    for (var i = 0; i < functions.length; ++i) {
      if (functions[i] == 'acquire') { found = true; break; }
    }
    assert.ok(found);
    done();
  });

  it('calling aquire returns a redis client object that can get/set', function (done) {
    redis_pool.acquire(0, function (err, client) {
      if (err) { done(err); return; }
      client.set("key", "value");
      client.get("key", function (err, data) {
        assert.equal(data, "value");
        redis_pool.release(0, client); // needed to exit tests
        done();
      })
    });
  });

  it('calling aquire on another DB returns a redis client object that can get/set', function (done) {
    redis_pool.acquire(2, function (err, client) {
      if (err) { done(err); return; }
      client.set("key", "value");
      client.get("key", function (err, data) {
        assert.equal(data, "value");
        redis_pool.release(2, client); // needed to exit tests
        done();
      })
    });
  });

  // See https://github.com/CartoDB/node-redis-mpool/issues/1
  it('calling release resets connection state', function (done) {
    var client1, client2, tx1;
    Step(
      function getClient1() {
        redis_pool.acquire(0, this);
      },
      function getClient2(err, client) {
        if (err) throw err;
        client1 = client;
        redis_pool.acquire(0, this);
      },
      function regetClient1(err, client) {
        if (err) throw err;
        client2 = client;
        client1.WATCH('k');
        redis_pool.release(0, client1);
        client1 = null;
        redis_pool.acquire(0, this);
      },
      function startTransaction1(err, client) {
        if (err) throw err;
        client1 = client;
        // We expect this to be not watching now..
        tx1 = client1.MULTI();
        tx1.SET('x', 1); // 'x' will be set to 1 only if we're not watching
        client2.SET('k', 1, this);
      },
      function execTransaction1(err) {
        if (err) throw err;
        // This would fail if we're watching
        tx1.EXEC(this);
      },
      function checkTransaction(err, res) {
        if (err) throw err;
        assert.ok(res, "Transaction unexpectedly aborted"); // we expect to succeeded
        assert.equal(res.length, 1);
        return null;
      },
      function finish(err) {
        if (client1) redis_pool.release(0, client1);
        if (client2) redis_pool.release(0, client2);
        done(err);
      }
    );
  });

  it('log is called if elapsed time is above configured one', function (done) {
    var logWasCalled = false,
      elapsedThreshold = 25,
      enabledSlowPoolConfig = {
        slowPool: {
          log: true,
          elapsedThreshold: elapsedThreshold
        }
      };

    var times = 0;
    var dateNowFunc = Date.now;
    Date.now = function () {
      return times++ * elapsedThreshold * 2;
    };
    var consoleLogFunc = console.log;
    console.log = function (what) {
      var whatObj;
      try {
        whatObj = JSON.parse(what);
      } catch (e) {
        // pass
      }
      logWasCalled = whatObj && whatObj.action && whatObj.action === 'acquire';
      consoleLogFunc.apply(console, arguments);
    };

    var redisPool = new RedisPool(_.extend(this.test_opts, enabledSlowPoolConfig));
    redisPool.acquire(0, function (err, client) {

      console.log = consoleLogFunc;
      Date.now = dateNowFunc;

      redisPool.release(0, client);
      assert.ok(logWasCalled);
      done();
    });
  });

  it('emits `status` event after pool has been used', function (done) {
    var database = 0;
    var redisPool = new RedisPool(_.extend(this.test_opts, { emitter: { statusInterval: 5 } }));
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
