teamspeak-channel-creator
=========================

Teamspeak bot for creating channels for user. When a user joins the 
specific channel and has one of the server groups a channel will be
created for them. Channels are permanent and passworded, the password
is sent to the user and they are also given the specified channel group

    {
      "address": "uhc.gg",  // address to connect to
      "queryport": 10011,   // port serverquery is on
      "serverport": 9987,   // port of the server to run for
      "username": "serveradmin",  // username to login with
      "botName": "BOT", // unique name for the bot to use
      "password": "password",    // password for the account
      "listenChannel": 107, // the channel to listen for joins
      "channelId": 107,     // channel ID to make channels under
      "groupIds": [6],    // array of group IDs that should be allowed permissions, empty for all
      "codec": 5,           // 0: Speex Narrowband 1: Speex Wideband 2: Speex Ultra-wideband 3: Celt Mono 4: Opus Voice 5: Opus Music
      "codec_quality": 10,
      "channelGroupId": 5,   // the channel group ID to assign after create
      "noPermissionMessage": "You do not have permission to create a channel"
    }