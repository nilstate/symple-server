const Symple = require('./lib/symple');
const { createConfig } = require('./config');

const config = createConfig();
const sy = new Symple(config);

sy.init();

console.log('Symple server listening on port ' + (process.env.PORT || sy.config.port));
