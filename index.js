'use strict';

const redis = require('redis');
const Pool = require('generic-pool').Pool;
const EventEmitter = require('events').EventEmitter;

const FLUSH_CONNECTION = true;
const DEFAULTS = {
  host: '127.0.0.1',
  port: '6379',
  max: 50,
  idleTimeoutMillis: 10000,
  reapIntervalMillis: 1000,
  noReadyCheck: false,
  returnToHead: false,
  unwatchOnRelease: true,
  name: 'default',
  log: false,
  slowPool: {
    log: false,
    elapsedThreshold: 25
  },
  emitter: {
    statusInterval: 60000
  },
  commands: []
};

/**
 * Create a new multi database Redis pool.
 * It will emit `status` event with information about each created pool.
 *
 * @param {Object} options
 * @returns {RedisPool}
 * @constructor
 */
module.exports = class RedisPool extends EventEmitter {
  constructor (options = {}) {
    super();

    this.pools = {};
    this.options = Object.assign({}, DEFAULTS, options);
    this.elapsedThreshold = this.options.slowPool.elapsedThreshold;

    if (this.options.commands.length) {
      this._addCommands(this.options.commands)
    }

    this._emitStatus(this.options.emitter.statusInterval)
  }

  /**
   * Acquire resource
   *
   * @param {String|Number} database redis database name
   * @param {Function} callback Callback to call once acquired. Takes the form `callback(err, resource)`
   */
  acquire (database, callback) {
    let pool = this.pools[database];
    if (!pool) {
      pool = this.pools[database] = makePool(this.options, database);
    }

    const startTime = Date.now();
    pool.acquire((err, client) => {
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > this.elapsedThreshold) {
        log(this.options, { db: database, action: 'acquire', elapsed: elapsedTime, waiting: pool.waitingClientsCount() });
      }
      callback(err, client);
    });
  }

  /**
   * Release resource.
   *
   * @param database {String|Number} redis database name
   * @param resource {Object} resource object to release
   */
  release (database, resource) {
    if (this.options.unwatchOnRelease) {
      resource.UNWATCH();
    }

    const pool = this.pools[database];

    if (pool) {
      pool.release(resource);
    }
  }

  _addCommands (commands = []) {
    commands.forEach(newCommand => redis.add_command(newCommand));
  }

  _emitStatus(statusInterval) {
    setInterval(() => {
      for (const [poolKey, pool] of Object.entries(this.pools)) {
        this.emit('status', {
          name: this.options.name,
          db: poolKey,
          count: pool.getPoolSize(),
          unused: pool.availableObjectsCount(),
          waiting: pool.waitingClientsCount()
        });
      }
    }, statusInterval);
  }
};

/**
 * Factory to create new Redis pools for a given Redis database
 * @param options
 * @param database
 * @returns {Object}
 */
function makePool (options, database) {
  return Pool({
    name: options.name + ':' + database,

    create: function (callback) {
      let callbackCalled = false;

      const client = redis.createClient(options.port, options.host, {
        no_ready_check: options.noReadyCheck
      });

      client.on('error', function (err) {
        log(options, { db: database, action: 'error', err: err.message });
        if (!callbackCalled) {
          callbackCalled = true;
          callback(err, client);
        }
        client.end(FLUSH_CONNECTION);
      });

      client.on('ready', function () {
        client.select(database, function (err/*, res */) {
          if (!callbackCalled) {
            callbackCalled = true;
            callback(err, client);
          }
        });
      });
    },

    destroy: function (client) {
      client.quit();
      client.end(FLUSH_CONNECTION);
    },

    validate: function (client) {
      return client && client.connected;
    },

    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    reapIntervalMillis: options.reapIntervalMillis,
    returnToHead: options.returnToHead,
    log: options.log
  });
}

function log (options, what) {
  if (options.slowPool.log) {
    console.log(JSON.stringify(Object.assign({ name: options.name }, what)));
  }
}
