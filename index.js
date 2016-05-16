const BotFactory = require('teamspeak-channel-squatter');
const Promise = require('bluebird');
const chance = require('chance')();

const config = require('./config.json');

const createClosestChannel = (bot, parentId, username, password, maxAttempts) => {
    let attempt = 0;
    let current = username;

    const error = error => {
        console.error(error);

        if (attempt == maxAttempts) {
            return Promise.reject('too many attempt to create a channel');
        }

        attempt++;
        current = username + attempt;

        return run();
    };

    const run = () => createChannel(bot, parentId, current, 'Channel for ' + current, 'Channel for ' + current, password).catch(error);

    return run();
};

const createChannel = (bot, parentId, name, topic, description, password) => bot._send('channelcreate', {
    cpid: parentId,
    channel_name: name,
    channel_description: description,
    channel_topic: topic,
    channel_password: password,
    channel_codec: config.codec,
    channel_codec_quality: config.codec_quality,
    ['channel_flag_' + config.channelType]: 1
});

const createForUser = Promise.coroutine(function * (bot, clid) {
    const password = chance.word({ length: 10 });

    const { client_nickname, client_database_id } = yield bot._send('clientinfo', { clid: clid });

    const { cid } = yield createClosestChannel(bot, config.channelId, client_nickname, password);

    yield Promise.join(
        // Move to channel
        bot._send('clientmove', {
            clid: clid,
            cid: cid,
            pwd: password
        }),
        // Add channel group to client
        bot._send('setclientchannelgroup', {
            cgid: config.channelGroupId,
            cldbid: client_database_id,
            cid: cid
        }),
        // Send password in PM
        bot.sendMessage(clid, `The password for your new channel is: ${password}`)
    );
});

const sendError = (bot, clid, error, publicError = error) => {
    console.error(error);

    return Promise.join(
        bot.kickClient(clid, publicError),
        bot.sendPoke(clid, publicError)
    );
};

(new BotFactory())
    .withCredentials(config.username, config.password, config.botName)
    .withAllowedGroups(config.groupIds)
    .withConnectionInfo(config.address, config.queryport, config.serverport)
    .inChannel(config.listenChannel)
    .withActions(
        (bot, clid) => createForUser(bot, clid).catch(err => sendError(bot, clid, err, 'Error trying to create a channel, please try again later or contact an admin if this persists')),
        (bot, clid) => sendError(bot, clid, config.noPermissionMessage)
    )
    .build() // Build the bot
        .start() // Start the bot
        .then(() => console.log('Connected!'))
        .catch(err => console.error(err));