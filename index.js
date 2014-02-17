/**
 * RedisPool. A database specific redis pooling lib
 *
 */

var redis  = require('redis')
  , _      = require('underscore')
  , Pool   = require('generic-pool').Pool;

// constructor.
// 
// - `opts` {Object} optional config for redis and pooling
var RedisPool = function(opts){
  var opts = opts || {};
  var defaults = {
    host: '127.0.0.1', 
    port: '6379', 
    max: 50, 
    idleTimeoutMillis: 10000, 
    reapIntervalMillis: 1000, 
    unwatchOnRelease: true,
    log: false
  };    
  var options = _.defaults(opts, defaults)

  var me = {
    pools: {} // cached pools by DB name
  };
  
  // Acquire resource.
  //
  // - `database` {String} redis database name
  // - `callback` {Function} callback to call once acquired. Takes the form
  //   `callback(err, resource)`  
  me.acquire = function(database, callback) {
      var pool = this.pools[database];
      if (!pool) {
        pool = this.pools[database] = this.makePool(database);            
      }
      pool.acquire(callback);
  };
  
  // Release resource.
  //
  // - `database` {String} redis database name
  // - `resource` {Object} resource object to release
  me.release = function(database, resource) {
      if ( options.unwatchOnRelease ) resource.UNWATCH();
      var pool = this.pools[database];
      if ( pool ) pool.release(resource);
  };
    
  // Factory for pool objects.
  me.makePool = function(database) {
    return Pool({
      name: database,
      create: function(callback){
        var client = redis.createClient(options.port, options.host);          
        client.on('connect', function () {
          client.send_anyway = true;
          client.select(database);  
          client.send_anyway = false;
          callback(null, client);
        });    
        client.on('error', function (err) {
          callback(err, null);
        });
      },
      destroy: function(client) { 
        return client.quit(); 
      },
      max: options.max, 
      idleTimeoutMillis: options.idleTimeoutMillis, 
      reapIntervalMillis: options.reapIntervalMillis, 
      log: options.log 
    });
  };
      
  return me;
};

module.exports = RedisPool;
