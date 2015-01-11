var net = require('net');
var cluster = require('cluster');

function hash(ip, seed) {
  var hash = ip.reduce(function(r, num) {
    r += parseInt(num, 10);
    r %= 2147483648;
    r += (r << 10)
    r %= 2147483648;
    r ^= r >> 6;
    return r;
  }, seed);

  hash += hash << 3;
  hash %= 2147483648;
  hash ^= hash >> 11;
  hash += hash << 15;
  hash %= 2147483648;

  return hash >>> 0;
}

module.exports = function sticky(num, callback) {
  var server;

  // `num` argument is optional
  if (typeof num !== 'number') {
    callback = num;
    num = require('os').cpus().length;
  }

  // Master will spawn `num` workers
  if (cluster.isMaster) {
    var workers = [];
    for (var i = 0; i < num; i++) {
      !function spawn(i) {
        workers[i] = cluster.fork();
        // Restart worker on exit
        workers[i].on('exit', function() {
          console.error('sticky-session: worker died');
          spawn(i);
        });
      }(i);
    }

    var ports = [];

    cluster.on('online', function(worker) {
      worker.on('message', function(msg) {
        console.log('got port', msg);
        ports.push(+msg);
      });
    });

    var seed = ~~(Math.random() * 1e9);
    server = net.createServer(function(conn) {
      // Get int31 hash of ip
      var worker;
      var ipHash = hash((conn.remoteAddress || '').split(/\./g), seed);

      var next = ipHash % ports.length;
      var port = ports[next];

      conn.pipe(net.connect(port)).pipe(conn);
    });

    return server;
  }

  cluster._getServer = function(tcpSelf, address, port, addressType, fd, cb) {
    var args = [address, port, addressType, fd];

    tcpSelf.once('listening', function() {
      var address = tcpSelf.address();
      process.send(address.port);
      cluster.worker.state = 'listening';
    });

    var handler = net._createServerHandle.apply(net, args);
    cb(handler);
  };

  server = typeof callback === 'function' ? callback() : callback;

  if (!server) throw new Error('Worker hasn\'t created server!');

  // Monkey patch server to not bind to port
  var oldListen = server.listen;
  server.listen = function listen() {
    var lastArg = arguments[arguments.length - 1];

    if (typeof lastArg === 'function') lastArg();

    return oldListen.call(this, null);
  };

  return server;
};
