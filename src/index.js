var ChannelCreatorListener = require('./ChannelCreatorListener');
var config = require('./../config.json');

var cl = new ChannelCreatorListener(config);

cl.run().then(
  function success() {
    console.log('Connected successfully, now running.');
  },
  function error(err) {
    console.log('Error connecting:', err);
  }
);