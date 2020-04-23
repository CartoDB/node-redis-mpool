'use strict';

const EventEmitter = require('events').EventEmitter;
const redis = require('redis');
const { createPool } = require('generic-pool');

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

    this._addCommands()
    this._emitStatus()
  }

  /**
   * Acquire Redis client
   *
   * @param {String|Number} database redis database name
   * @returns {Promise} with the Redis client
   */
  async acquire (database) {
    let pool = this.pools[database];
    if (!pool) {
      pool = this.pools[database] = makePool(this.options, database);
    }

    const startTime = Date.now();
    const client = await pool.acquire()
    const elapsedTime = Date.now() - startTime;

    if (elapsedTime > this.options.slowPool.elapsedThreshold) {
      log(this.options, { db: database, action: 'acquire', elapsed: elapsedTime, waiting: pool.pending });
    }

    return client;
  }

  /**
   * Release resource.
   *
   * @param {String|Number} database redis database name
   * @param {Object} resource resource object to release
   */
  async release (database, resource) {
    if (this.options.unwatchOnRelease) {
      resource.UNWATCH();
    }

    const pool = this.pools[database];

    if (pool) {
      await pool.release(resource);
    }
  }

  _addCommands () {
    if (this.options.commands.length) {
      this.options.commands.forEach(newCommand => redis.add_command(newCommand));
    }
  }

  _emitStatus() {
    setInterval(() => {
      for (const [poolKey, pool] of Object.entries(this.pools)) {
        this.emit('status', {
          name: this.options.name,
          db: poolKey,
          count: pool.size,
          unused: pool.available,
          waiting: pool.pending
        });
      }
    }, this.options.emitter.statusInterval);
  }
};

/**
 * Factory to create new Redis pools for a given Redis database
 * @param options
 * @param database
 * @returns {Pool}
 */
function makePool (options, database) {
  const factory = {
    create () {
      return new Promise((resolve, reject) => {
        let settled = false;

        const client = redis.createClient(options.port, options.host, {
          no_ready_check: options.noReadyCheck
        });

        client.on('error', function (err) {
          log(options, { db: database, action: 'error', err: err.message });

          if (!settled) {
            settled = true;
            client.end(FLUSH_CONNECTION);

            if (err) {
              return reject(err);
            }
            return resolve(client);
          }
        });

        client.on('ready', function () {
          client.select(database, err => {
            if (!settled) {
              settled = true;

              if (err) {
                return reject(err);
              }
              return resolve(client);
            }
          });
        });
      })
    },

    destroy (client) {
      return new Promise((resolve, reject) => {
        client.quit(err => {
          client.end(FLUSH_CONNECTION);
          if (err) {
            return reject(err);
          }
          return resolve();
        });
      })
    },

    validate (client) {
      return new Promise(resolve => {
        return resolve(client && client.connected)
      })
    }
  }

  const config = {
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    reapIntervalMillis: options.reapIntervalMillis,
    returnToHead: options.returnToHead
  }

  return createPool(factory, config);
}

function log (options, what) {
  if (options.slowPool.log) {
    console.log(JSON.stringify(Object.assign({ name: options.name }, what)));
  }
}
