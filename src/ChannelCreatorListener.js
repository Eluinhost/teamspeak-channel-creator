var TeamSpeakClient = require('node-teamspeak'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  chance = new require('chance')();

/**
 * @param {Object} [options={}]
 * @param {String} [options.address='localhost'] - address to connect to
 * @param {Number} [options.queryport=10011] - server query port
 * @param {Number} [options.serverport=9987] - port of server to use
 * @param {String} [options.username='serveradmin'] - server query account username
 * @param {String} [options.password=''] - server query account password
 * @param {Number} [options.listenChannel=1] - the channel to squat in
 * @param {Number} [options.channelId=1] - the channel to create new channels in
 * @param {Number[]} [options.groupIds=[]] - the group ID to toggle or empty to allow all
 * @param {Number} [options.codec=5] - the codec ID to use
 * @param {Number} [options.codec_quality=10] - the quality of the codec
 * @param {Number} [options.channelGroupId=5] - the channel group to assign the user
 * @param {String} [options.noPermissionMessage] - the message to send on no permission
 * @constructor
 */
function ChannelCreatorListener(options) {
  options = options || {};
  _.defaults(options, {
    address: 'localhost',
    queryport: 10011,
    serverport: 9987,
    username: 'serveradmin',
    password: '',
    listenChannel: 1,
    channelId: 1,
    groupIds: [],
    codec: 5,
    codec_quality: 10,
    channelGroupId: 5,
    noPermissionMessage: "You do not have permission to make a channel"
  });

  // group IDs need to be strings
  options.groupIds = options.groupIds.map(function(element) {
    return '' + element;
  });

  this._options = options;
  this._client = new TeamSpeakClient(options.address, options.queryport);

  this._send = Promise.promisify(this._client.send, this._client);
}

/**
 * Send a login request to initalize connection
 *
 * @returns {Promise}
 * @private
 */
ChannelCreatorListener.prototype._login = function() {
  return this._send('login', {client_login_name: this._options.username, client_login_password: this._options.password});
};

/**
 * Tell the client to use the server on the supplied port, required after login
 *
 * @returns {Promise}
 * @private
 */
ChannelCreatorListener.prototype._useServer = function() {
  return this._send('use', {port: this._options.serverport});
};

/**
 * Register for channel events, required for events to trigger
 *
 * @returns {Promise}
 * @private
 */
ChannelCreatorListener.prototype._notifyForEvents = function() {
  return this._send('servernotifyregister', {event: 'channel', id: this._options.listenChannel});
};

/**
 * Start connection to the server, runs login, selects a server and then notifies for events
 *
 * @returns {Promise}
 * @private
 */
ChannelCreatorListener.prototype._connect = function() {
  var self = this;
  return this._login()
    .then(function() {
      return self._useServer();
    }).then(function() {
      return self._notifyForEvents();
    });
};

/**
 * Listener. Fired on when clients are moved into/out of the registered channel. If the client was moved into our
 * channel we toggle their group and kick them
 *
 * @param {Object} moveEvent
 * @private
 */
ChannelCreatorListener.prototype._onClientMove = function(moveEvent) {
  if(moveEvent.ctid !== this._options.listenChannel) return; // moved out of the channel

  var clid = moveEvent.clid;

  var self = this;
  this._getClientInfo(clid)
    .spread(function(info) {
      // server groups are a string unless a single group when it's a number. logical..
      var clgroups = isNaN(info.client_servergroups) ? info.client_servergroups.split(',') : ['' + info.client_servergroups];

      var allowed;
      if (self._options.groupIds.length == 0) {
        allowed = true;
      } else {
        allowed = _.any(clgroups, function (group) {
          return _.contains(self._options.groupIds, group);
        });
      }

      if (!allowed) {
        console.log('Client doesn\'t have permissions to create a channel');

        return self._kickClient(clid, '').then(function() {
          return self._sendMessageToClient(clid, self._options.noPermissionMessage);
        });
      }

      var pass = chance.word({length: 10});

      return self
        ._createClosestChannel(self._options.channelId, info.client_nickname, pass, 5)
        .spread(function(channelInfo) {
          return self._changeChannelIcon(channelInfo.cid, info.client_icon_id).return(channelInfo.cid);
        })
        .then(function(cid) {
          return self._moveClient(clid, cid, pass).return(cid);
        })
        .then(function(cid) {
          return self._addChannelGroupToClient(info.client_database_id, cid);
        })
        .then(function() {
          return self._sendMessageToClient(clid, 'The password for your new channel is: ' + pass);
        })
        .catch(function(error) {
          console.log(error);
          return self._kickClient(clid, 'Error trying to create the channel').then(function() {
            return self._sendMessageToClient(clid, 'Error trying to create a channel, please try again later or contact an admin if this persists');
          });
        });
    });
};

/**
 * Adds the options channel group to the client
 *
 * @param {Number} cldbid - the client's DATABASE id
 * @param {Number} cid - the channel id to set for
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._addChannelGroupToClient = function(cldbid, cid) {
  return this._send('setclientchannelgroup', {
    cgid: this._options.channelGroupId,
    cldbid: cldbid,
    cid: cid
  });
};

/**
 * Send a private message to the client
 *
 * @param {Number} clid - the client id
 * @param {String} message - the message to send
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._sendMessageToClient = function(clid, message) {
  return this._send('sendtextmessage', {
    target: clid,
    targetmode: 1,
    msg: message
  });
};


/**
 * Listener. Fired when a client connects to the channel registered. Kicks the client on connection to the channel
 *
 * @param {Object} viewEvent
 * @private
 */
ChannelCreatorListener.prototype._onEnterView = function(viewEvent) {
  if(viewEvent.ctid !== this._options.listenChannel) return; // not in this channel

  return this._kickClient(viewEvent.clid, 'Channel not allowed');
};


/**
 * Kick the client with the given id from the channel
 *
 * @param {Number} clid - the id of the client to kick
 * @param {String} message - the reason for kicking
 * @returns {Promise}
 * @private
 */
ChannelCreatorListener.prototype._kickClient = function(clid, message) {
  return this._send('clientkick', {
    clid: clid,
    reasonid: 4,
    reasonmsg: message
  });
};

/**
 * Moves the client to the given channel
 *
 * @param {Number} clid - the client id to  move
 * @param {Number} cid - the channel id to move to
 * @param {String} password - the channel's password
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._moveClient = function(clid, cid, password) {
  return this._send('clientmove', {
    clid: clid,
    cid: cid,
    pwd: password
  });
};

/**
 * Returns all of the info for the client
 *
 * @param {Number} clid - the client id
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._getClientInfo = function(clid) {
  return this._send('clientinfo', {
    clid: clid
  });
};

/**
 * Creates a channel. If it fails trys `name1`, `name2` e.t.c. up to maxAttempts.
 * Sets the channel description and topic to `Channel for <name>`
 *
 * @param {Number} cpid - the parent channel id
 * @param {String} name - the name of the channel
 * @param {String} password - the password of the channel
 * @param {Number} maxAttempts - maximum number to go to
 * @return {Promise}
 */
ChannelCreatorListener.prototype._createClosestChannel = function(cpid, name, password, maxAttempts) {
  var attempt = 0;
  var current = name;
  var self = this;

  var error = function(error) {
    console.log(error);

    if (attempt == maxAttempts) {
      return Promise.reject('too many attempt to create a channel');
    }

    attempt++;
    current = name + attempt;

    return run();
  };

  var run = function() {
    return self._createChannel(cpid, current, 'Channel for ' + name, 'Channel for ' + name, password).catch(error);
  };

  return run();
};

/**
 * Changes a channel icon
 *
 * @param {Number} cid - the id of the channel to change
 * @param {Number} iconId - the id of the icon to set
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._changeChannelIcon = function(cid, iconId) {
  return this._send('channeledit', {
    cid: cid,
    channel_icon_id: iconId
  });
};

/**
 * Creates a new channel
 *
 * @param {Number} cpid - the parent channel ID
 * @param {String} name - the name to give the channel
 * @param {String} description - the channel description
 * @param {String} topic - the channel topic
 * @param {String} password - the channel password
 * @returns {Promise}
 */
ChannelCreatorListener.prototype._createChannel = function(cpid, name, description, topic, password) {
  return this._send('channelcreate', {
    cpid: cpid,
    channel_name: name,
    channel_description: description,
    channel_topic: topic,
    channel_password: password,
    channel_codec: this._options.codec,
    channel_codec_quality: this._options.codec_quality,
    channel_flag_permanent: 1
  });
};

/**
 * Starts the conection up and starts listening/responding to events
 *
 * @returns {Promise} resolves after initial connection
 */
ChannelCreatorListener.prototype.run = function() {
  // register events
  this._client.on('clientmoved', this._onClientMove.bind(this));
  this._client.on('cliententerview', this._onEnterView.bind(this));

  var self = this;
  return this._connect().then(function() {

    // run a keep alive
    setInterval(function() {
      self._send('whoami', {} , function(err) {
        if(err) console.log(err);
      });
    }, 60000)
  });
};

module.exports = ChannelCreatorListener;