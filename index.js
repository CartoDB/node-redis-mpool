'use strict';

const EventEmitter = require('events').EventEmitter;
const redis = require('redis');
const { createPool } = require('generic-pool');

const FLUSH_CONNECTION = true;
const DEFAULT_STATUS_INTERVAL = 60000
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
        statusInterval: DEFAULT_STATUS_INTERVAL
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
    constructor (options = {}, logger = console) {
        super();

        this.pools = {};
        this.options = Object.assign({}, DEFAULTS, options);
        this.logger = logger;

        this._addCommands();
        this._emitStatus();
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
            pool = this.pools[database] = makePool(this, database);
        }

        const startTime = Date.now();
        const client = await pool.acquire();
        const elapsedTime = Date.now() - startTime;

        if (this.options.slowPool.log && elapsedTime > this.options.slowPool.elapsedThreshold) {
            this.logger.info({ name: this.options.name, db: database, action: 'acquire', elapsed: elapsedTime, waiting: pool.pending });
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

    _emitStatus () {
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
        }, this._getStatusDelay());
    }

    _getStatusDelay () {
        return (this.options.emitter && this.options.emitter.statusInterval) || DEFAULT_STATUS_INTERVAL;
    }
};

/**
 * Factory to create new Redis pools for a given Redis database
 * @param redisPool
 * @param database
 * @returns {Pool}
 */
function makePool (redisPool, database) {
    const factory = {
        // create function will loop forever if reject is called or exception is thrown
        // https://github.com/coopernurse/node-pool/issues/175
        create () {
            return new Promise(resolve => {
                let settled = false;

                const client = redis.createClient(redisPool.options.port, redisPool.options.host, {
                    no_ready_check: redisPool.options.noReadyCheck
                });

                client.on('error', (err) => {
                    err.name = redisPool.options.name;
                    err.db = database;
                    err.action = 'create';
                    redisPool.logger.error(err);

                    if (!settled) {
                        settled = true;
                        client.end(FLUSH_CONNECTION);

                        if (err) {
                            return resolve(err);
                        }

                        return resolve(client);
                    }
                });

                client.on('ready', () => {
                    client.select(database, err => {
                        if (!settled) {
                            settled = true;

                            if (err) {
                                return resolve(err);
                            }
                            return resolve(client);
                        }
                    });
                });
            });
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
            });
        },

        validate (client) {
            return new Promise(resolve => {
                return resolve(client && client.connected);
            });
        }
    };

    const config = {
        max: redisPool.options.max,
        idleTimeoutMillis: redisPool.options.idleTimeoutMillis,
        reapIntervalMillis: redisPool.options.reapIntervalMillis,
        returnToHead: redisPool.options.returnToHead
    };

    return createPool(factory, config);
}
