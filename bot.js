const Discord = require("discord.js");
require('dotenv').config();
const fs = require("fs");

const gens = [
  {id: 1, name: "Kanto", toggle: 1, start: 1.0}, 
  {id: 2, name: "Johto", toggle: 1, start: 152.0}, 
  {id: 3, name: "Hoenn", toggle: 1, start: 252.0}, 
  {id: 4, name: "Sinnoh", toggle: 1, start: 387.0}, 
  {id: 5, name: "Unova", toggle: 1, start: 494.0}, 
  {id: 6, name: "Kalos", toggle: 1, start: 650.0}, 
  {id: 7, name: "Alola", toggle: 1, start: 722.0}, 
  {id: 8, name: "Galar", toggle: 1, start: 810.0}, 
  {id: 9, name: "Paldea", toggle: 1, start: 906.0}];

const findGenLinear = count => {
  let i;
  for(i = 0; i < gens.length; i++) {
    if(count < gens[i].start) {
      return i;
    }
  }
  return i;
}

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
        const name = columns[1].split(' ').filter(item => !(item.includes('(') || item.includes(')'))).join(' ');
        if (results.filter(item => item.name === name).length === 0)
        results.push({name: name, gen: findGenLinear(Math.floor(parseInt(columns[0])))});
      });

    return results;
  } catch (err) {
    console.error('Error parsing CSV:', err);
    return [];
  }
}

// Usage
const filePath = `${process.cwd()}/pokedex.csv`;
const parsedData = parseCSVSync(filePath);
let ACCEPTED_WORDS = parsedData;

const SERVER_ID=process.env.SERVER_ID_L
const BOT_ID=process.env.BOT_ID

const timeout = 15000;
const SUBSTRING_LENGTH = 3;
let START_HP = 5;
let TURN_LENGTH = 25000;
let DIFFICULTY = 0.5;
const ACTIVE_GAME_CHANNELS = new Map();
const ACTIVE_GAME_TIMERS = new Map();

const SUBSTRINGS = {};

const populateSubstrings = (substring_length) => {
  //parseddata entries are {name, gen}
  parsedData.forEach(entry => {
    for (let j = 0; j < entry.name.length - substring_length + 1; j++) {
      const substring = entry.name.slice(j, j+substring_length).toUpperCase();
      if(!SUBSTRINGS[substring]) {
        let newArr = Array(gens.length).fill(0);
        newArr[entry.gen - 1] = 1;
        SUBSTRINGS[substring] = newArr;
      } else {
        SUBSTRINGS[substring][entry.gen - 1] += 1;
      }
    }
  })
}

const refreshUsableSubstrings = (all) => {
  let usable_substrings = Object.entries(all).map(item => {
    let sum = 0;
    for(let i = 0; i < item[1].length; i++) {
      if(gens[i].toggle == 1) {
        sum += item[1][i];
      }
    };
    return{name: item[0], count: sum}
  }).filter(item => item.count > 0);
  usable_substrings.sort((s1, s2) => s2.count - s1.count);
  return usable_substrings;
}

populateSubstrings(SUBSTRING_LENGTH);
let usable_substrings = refreshUsableSubstrings(SUBSTRINGS);
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
  client.user.setActivity(`dead`);
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
    },
    {
      name: 'genadd',
      description: 'Adds generations of pokemon to the PokeWord name pool.'
    },
    {
      name: 'gendel',
      description: 'Removes generations of pokemon from the PokeWord name pool.'
    }
  ];

  const commandList = await client.guilds.cache
    .get(SERVER_ID)
    ?.commands.set(commands);
  const commandList2 = await client.guilds.cache
  .get(process.env.SERVER_ID)
  ?.commands.set(commands);
  const commandList3 = await client.guilds.cache
  .get(process.env.SERVER_ID_M)
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
    channel.send('😴 Nobody joined, cancelling...');
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
  // var target = "";
  // while(true) {
  //   var pokemon = ACCEPTED_WORDS[Math.floor(Math.random() * ACCEPTED_WORDS.length)].name
  //   var substring_idx = Math.floor(Math.random() * (pokemon.length - 2))
  //   var substring = pokemon.substring(substring_idx, substring_idx + 3)
  //   if (substring.match(/[aeiou]/gi) !== null && substring.match(/[aeiou]/gi).length > 0 && !substring.includes(' ') &&!substring.includes('-')) {
  //     target = substring.toUpperCase();
  //     break;
  //   }
  // }
  var target = usable_substrings[Math.floor(parseInt(Math.random() * DIFFICULTY * usable_substrings.length))].name;
  let game = ACTIVE_GAME_CHANNELS.get(channel_id)
  if(game === null) {
    return;
  }
  const lose_condition = game.player_list.length > 1
  const target_message = await channel.send(`<@${game.player_list[game.cur_player_turn].id}>, name a Pokemon containing '${target}'`);
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

const enable_gen = number => {
  if(gens[parseInt(number) - 1].toggle == 0) {
    parsedData.filter(item => item.gen == number).forEach(item => {
      ACCEPTED_WORDS.push(item);
    })
    gens[parseInt(number) - 1].toggle = 1;
  }
}
const addGens = async (message, arg) => {
  const channel_id = message.channel.id;
  if(ACTIVE_GAME_CHANNELS.length > 0) {
    await message.react("🚫");
    return;
  } else {
    if(/^\d+$/.test(arg)) {
      enable_gen(arg)
    } else if(arg === "*") {
      for(var i = 1; i <= gens.length; i++) {
        enable_gen(i);
      }
    } else if(arg.match(/^\*\d+$/)) {
      for(var i = 1; i <= parseInt(arg.substring(1, arg.length)); i++) {
        enable_gen(i);
      }
    } else if(arg.match(/^\d+\*$/)) {
      for(var i = parseInt(arg.substring(0, arg.length - 1)); i <= gens.length; i++) {
        enable_gen(i);
      }
    } else {
      await message.react("🚫");
      return;
    }
    
  }
  await message.react("💯");
  return;
}
const disable_gen = number => {
  if(gens[parseInt(number) - 1].toggle == 1) {
    ACCEPTED_WORDS = ACCEPTED_WORDS.filter(item => 
      item.gen != number
    )
    gens[parseInt(number) - 1].toggle = 0;
  }
}
const delGens = async (message, arg) => {
  const channel_id = message.channel.id;
  if(ACTIVE_GAME_CHANNELS.length > 0) {
    await message.react("🚫");
    return;
  } else {
    if(/^[1-9]$/.test(arg)) {
      disable_gen(arg)
    } else if(arg.match(/^\*[1-9]$/)) {
      for(var i = 1; i <= parseInt(arg.substring(1, arg.length)); i++) {
        disable_gen(i);
      }
    } else if(arg === "*") {
      for(var i = 1; i <= gens.length; i++) {
        disable_gen(i);
      }
    } else if(arg.match(/^[1-9]\*$/)) {
      for(var i = parseInt(arg.substring(0, arg.length - 1)); i <= gens.length; i++) {
        disable_gen(i);
      }
    } else {
      await message.react("🚫");
      return;
    }
    
  }
  await message.react("💯");
  return;
}

const showGens = async (channel_id) => {
  const channel = client.channels.cache.get(channel_id);
  let local_gens = gens.filter(item => item.toggle).map(item => item.name).join(', ')
  channel.send(`Enabled gens: ${local_gens}`);
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
  
    const { commandName } = interaction;
  
    if (commandName === 'hello') {
      await interaction.reply('Helo c:');
    } else if(commandName === 'exitgame') {
      await quitGame(interaction, interaction.channelId);
    } else if (commandName === 'play') {
      if(ACCEPTED_WORDS.length === 0) {
        interaction.reply("⚠️ You don't have any generations enabled :( turn some on with $genadd <number> to play!");
        return;
      }
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
    if(msg.author.id === game.player_list[game.cur_player_turn].id && msg.content.toUpperCase().includes(game_timer.target) && ACCEPTED_WORDS.map(item => item.name.toLowerCase()).includes(msg.content.toLowerCase())) {
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
  } else {
    if(msg.content.startsWith("$genadd ")) {
      addGens(msg, msg.content.split(' ')[1])
      usable_substrings = refreshUsableSubstrings(SUBSTRINGS);
    } else if (msg.content.startsWith("$gendel ")) {
      delGens(msg, msg.content.split(' ')[1])
      usable_substrings = refreshUsableSubstrings(SUBSTRINGS);
    }
    else if (msg.content ===("$showgens")) {
      showGens(msg.channelId)
    }
  }

})

client.login(process.env.TOKEN)