const pg = require('pg');
const deny = () => { throw new Error('Unexpected I/O during background runner validation'); };
pg.Client.prototype.connect = deny;
pg.Pool.prototype.connect = deny;
require('node:net').Socket.prototype.connect = deny;
globalThis.fetch = deny;
