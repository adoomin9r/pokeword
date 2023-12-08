const Discord = require("discord.js");
require('dotenv').config();
const fs = require("fs");

//chatgpt moment
function parseCSVSync(filePath) {
  try {
    // Read the CSV file synchronously
    const fileData = fs.readFileSync(filePath, 'utf8');
    
    // Parse the CSV data synchronously
    const results = [];
    fileData
      .trim() // Remove leading/trailing whitespace
      .split('\n') // Split by newline character
      .forEach((row) => {
        // Split each row by comma (or another delimiter)
        const columns = row.split(',');
        results.push(columns[1].split(' ').filter(item => !(item.includes('(') || item.includes(')'))).join(' '));
      });

    return results;
  } catch (err) {
    console.error('Error parsing CSV:', err);
    return [];
  }
}

// Usage
const filePath = 'pokedex.csv';
const parsedData = parseCSVSync(filePath);
const ACCEPTED_WORDS = [...new Set(parsedData)]
 

const SERVER_ID=process.env.SERVER_ID
const BOT_ID=process.env.BOT_ID

const timeout = 20000;
const vowels = "AEIOU"

let START_HP = 5;
let TURN_LENGTH = 25000;
const ACTIVE_GAME_CHANNELS = new Map();
const ACTIVE_GAME_TIMERS = new Map();
//key: channel id, value : 
// {
//   cur_player_turn: id,
//   lose_condition: boolean,
//   player_list: list
// }

const client = new Discord.Client({ intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent
  ]})

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`)
  //increase this list for more commands
  const commands = [
    {
      name: 'hello',
      description: 'Say hello to the little fella.',
    },
    {
        name: 'play',
        description: 'Initiates a PokeWord match.',
    },
    {
      name: 'exitgame',
      description: 'Quits a PokeWord match in the current channel (if running).',
    }
  ];

  const commandList = await client.guilds.cache
    .get(SERVER_ID)
    ?.commands.set(commands);
  //console.log(commandList);
})

const buildPlayerList = async (message) => {
  let player_list = [];
  await Promise.all(message.reactions.cache.map(async(reaction) => {
    if(reaction._emoji.name === '✅') {
      const reactionUsers = await reaction.users.fetch();
      reactionUsers.filter(item => item.id !== BOT_ID).forEach((user) => {
        player_list.push({
          id: user.id,
          username: user.username,
          hp: START_HP,
        });
      })
    }
  }));

  if(player_list.length > 0) {
      playGame(message.channel.id, player_list);
  } else {
    const channel = client.channels.cache.get(message.channel.id);
    channel.send('Nobody joined, cancelling :(');
  }
}

const playGame = (channel_id, player_list) => {
  const lose_condition = player_list.length > 1;
  ACTIVE_GAME_CHANNELS.set(channel_id, {lose_condition: lose_condition, cur_player_turn: 0, player_list: player_list});
  createTurnTimer(channel_id);
}

const createTurnTimer = async (channel_id) => {
  const channel = client.channels.cache.get(channel_id);
  // var rand = Math.floor(Math.random() * 26)
  // var target = alphanum.substring(rand, rand+1);
  var target = "";
  while(true) {
    var pokemon = ACCEPTED_WORDS[Math.floor(Math.random() * ACCEPTED_WORDS.length)]
    var substring_idx = Math.floor(Math.random() * (pokemon.length - 2))
    var substring = pokemon.substring(substring_idx, substring_idx + 3)
    if (substring.match(/[aeiou]/gi) !== null && substring.match(/[aeiou]/gi).length > 0 && !substring.includes(' ') &&!substring.includes('-')) {
      target = substring.toUpperCase();
      break;
    }
  }
  let game = ACTIVE_GAME_CHANNELS.get(channel_id)
  if(game === null) {
    return;
  }
  const lose_condition = game.player_list.length > 1
  const target_message = await channel.send(`<@${game.player_list[game.cur_player_turn].id}>, type a word containing '${target}'`);
  //console.log(target_message);
  const timer = setTimeout(() => {
    channel.send(`😓 Failed! -1 HP. total: ${game.player_list[game.cur_player_turn].hp - 1}`)
    game.player_list[game.cur_player_turn].hp -= 1;
    if(game.player_list[game.cur_player_turn].hp === 0) {
      game.player_list = game.player_list.filter(item => item.id !== game.player_list[game.cur_player_turn].id)
      if(game.player_list.length <= lose_condition) {
        channel.send('Game end!');
        if(game.player_list.length > 0) {
          channel.send(`👑 <@${game.player_list[0].id}> wins! :D`)
        } else { 
          channel.send("🤖 I win! >:)");
        }
        ACTIVE_GAME_CHANNELS.delete(channel_id);
        ACTIVE_GAME_TIMERS.delete(channel_id);
        return null;
      }
    }
    game.cur_player_turn += 1;
    if(game.cur_player_turn >= game.player_list.length) {
      game.cur_player_turn = 0;
    }
    ACTIVE_GAME_CHANNELS.set(channel_id, game);
    createTurnTimer(channel_id);
  }, TURN_LENGTH);

  const count_3 = setTimeout(async () => {
    await target_message.react('3️⃣');
  }, TURN_LENGTH-3000);
  const count_2 = setTimeout(async () => {
    await target_message.react('2️⃣');
  }, TURN_LENGTH-2000);
  const count_1 = setTimeout(async () => {
    await target_message.react('1️⃣');
  }, TURN_LENGTH-1000);

  ACTIVE_GAME_TIMERS.set(channel_id, {timer: timer, target: target, counters: [count_3, count_2, count_1]});
}

const clearCounters = (timeouts) => {
  for(var i = 0; i < timeouts.length; i++) {
    clearTimeout(timeouts[i]);
  }
}

const quitGame = async (interaction, channel_id) => {
  if(ACTIVE_GAME_CHANNELS.has(channel_id)) {
    let game_timer = ACTIVE_GAME_TIMERS.get(channel_id);
    clearTimeout(game_timer.timer);
    clearCounters(game_timer.counters);
    ACTIVE_GAME_TIMERS.delete(channel_id)
    ACTIVE_GAME_CHANNELS.delete(channel_id)
    await interaction.reply("👋 Quitting current game, bye bye...");
  } else {
    await interaction.reply("🤨 No game running!");
  }
}


client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
  
    const { commandName } = interaction;
  
    if (commandName === 'hello') {
      await interaction.reply('Helo c:');
    } else if(commandName === 'exitgame') {
      await quitGame(interaction, interaction.channelId);
    }else if (commandName === 'play') {
      interaction.reply("⚔️ Starting, react to play!! ⚔️");
      let message = await interaction.fetchReply()
      let running = ACTIVE_GAME_CHANNELS.has(message.channel.id)
      if(running > -1) {
        ACTIVE_GAME_CHANNELS.delete(message.channel.id);
      }
      await message.react('✅');
      setTimeout(async () => {
        await message.react('3️⃣');
      }, timeout-3000);
      setTimeout(async () => {
        await message.react('2️⃣');
      }, timeout-2000);
      setTimeout(async () => {
        await message.react('1️⃣');
      }, timeout-1000);
      setTimeout(async () => {
        message = message = await interaction.fetchReply() 
        buildPlayerList(message)
      }, timeout);

    }
});


//change how it reacts to messages
client.on("messageCreate", msg => {
  //channelId, content, author.id
  let game = ACTIVE_GAME_CHANNELS.get(msg.channelId);
  let game_timer = ACTIVE_GAME_TIMERS.get(msg.channelId);
  if(typeof game !== 'undefined' && typeof game_timer !== 'undefined') {
    if(msg.author.id === game.player_list[game.cur_player_turn].id && msg.content.toUpperCase().includes(game_timer.target) && ACCEPTED_WORDS.map(item => item.toLowerCase()).includes(msg.content.toLowerCase())) {
      const channel = client.channels.cache.get(msg.channel.id);
      var rand = Math.floor(Math.random() * 30)
      channel.send(rand === 0 ? 'Pikapika!' : rand < 20 ? 'Nice!' : 'Great!');
      //increment current player, destroy and remake timer with new target
      game.cur_player_turn++;
      if(game.cur_player_turn >= game.player_list.length) {
        game.cur_player_turn = 0;
      }
      ACTIVE_GAME_CHANNELS.set(msg.channelId, game);
      clearTimeout(game_timer.timer);
      clearCounters(game_timer.counters);
      ACTIVE_GAME_TIMERS.delete(msg.channelId);
      createTurnTimer(msg.channelId);
    }
  }

})

client.login(process.env.TOKEN)
//client.login(TOKEN)