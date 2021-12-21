"use strict";

const {
  capitalize,
  embed,
  formatTag,
  formatBoosts,
  sanitizeText,
} = require("./utils");

const searchBuilder = require("./search-builder");
const connection = require("./db");

const searchIndex = searchBuilder.build();

const fullWordAliases = {
  "dm cannon": "defender cannon",
  "drgn capacitor": "drgn c4p4c170r",
  "drgn claw": "drgn c74w",
  "drgn visor": "drgn v1z0r",
  "drgn vizor": "drgn v1z0r",
  "ur mom": "unsqueakable farce",
  "your mom": "unsqueakable farce",
  "1k wings": "wings of the thousand flames",
  "1k infernos": "wings of the thousand infernos",
};

const singleWordAliases = {
  adl: "ancient dragonlord helm",
  adsoe: "ancient dragon amulet scythe of the elements",
  aya: "summon gem ayauhnqui ex",
  ba: "baltaels aventail",
  blod: "blinding light of destiny",
  boa: "blade of awe",
  bod: "blade of destiny",
  bsw: "baltaels aventail",
  c7: "the corrupted seven",
  ddb: "defenders dragon belt",
  ddn: "defenders dragon necklace",
  ddr: "defenders dragon ring",
  ddsoe: "doomed dragon amulet scythe of the elements",
  ddsoe1: "doomed dragon amulet scythe of elementals",
  ddsoe2: "doomed dragon amulet scythe of the elements",
  ddv: "distorted doom visage",
  drk: "dragonknight",
  dsod: "dragonstaff of destiny",
  eud: "elemental unity defender",
  fc: "frozen claymore",
  fdl: "fierce dragonlord",
  dlc: "dragonlord captain",
  fs: "frostscythe",
  gg: "forgotten gloom glaive",
  gt: "grove tender",
  isis: "ice scythe",
  lh: "lucky hammer",
  npsb: "necro paragon soulblade",
  nsod: "necrotic sword of doom",
  nstb: "not so tiny bubbles",
  pdl: "dragons patience",
  rdl: "dragons rage",
  bdl: "dragons bulwark",
  wdl: "dragons wrath",
  scc: "sea chickens conquest",
  sf: "soulforged",
  tbod: "twin blades of destiny",
  udsod: "ultimate dragonstaff of destiny",
  ublod: "ultimate blinding light of destiny",
  utbod: "ultimate twin blades of destiny",
  unrav: "unraveler",
  uok: "ultra omniknight",
  vik: "vanilla ice katana",
};

const CT = process.env.COMMAND_TOKEN;

/**
 * Get details of an item from the database. The input item name is sanitized and converted to its original form
 * if it is an alias of another item name.
 *
 * @param {String} itemName
 *   Name of the item to be fetched from the database
 * @param {Object} existingQuery
 *   An existing mongoDB query object to be modified with filter queries before being run
 *
 * @return {Promise<Object>}
 *   Promise that resolves an object containing the details of the item or the closest match.
 *   Resolves null if no item is found
 */
async function getItem(itemName, existingQuery, fuzzy = false) {
  let sanitizedName = sanitizeText(itemName);
  if (sanitizedName in fullWordAliases)
    sanitizedName = fullWordAliases[sanitizedName];
  const itemNameFragments = sanitizedName
    .split(" ")
    .map((word) => singleWordAliases[word] || word);

  let searchResults;
  let searchScores;
  delete existingQuery.$text;
  delete existingQuery.$or;
  delete existingQuery.$and;
  if (!fuzzy) {
    existingQuery.$text = {
      $search: `${itemNameFragments.map((word) => `"${word}"`).join(" ")}`,
    };

    if (sanitizedName.length >= 3) {
      const noSpaceText = sanitizedName.replace(/ /g, "");
      const splitText =
        noSpaceText.slice(0, 3) +
        " ?" +
        noSpaceText.slice(3).split("").join(" ?");
      const nameRegex = new RegExp(
        `(?:^${splitText})|(?:${splitText}$)|(?: ${splitText})|(?:${splitText} )`,
        "i"
      );
      existingQuery.$or = [{ $text: existingQuery.$text }, { name: nameRegex }];
      delete existingQuery.$text;
    }
  } else {
    searchResults = searchIndex.search(
      itemNameFragments
        .map((name) => {
          if (name === "blade") return "blade sword dagger knife";
          if (name in { dagger: 1, knife: 1 }) return "dagger knife blade";
          if (name === "sword") return "blade sword";
          if (name === "staff") return "staff stave";
          if (name.length <= 2) return name;
          if (name.length <= 3) return `${name}~1`;
          if (name.length <= 5) return `+${name}~1`;
          return `+${name[0]}+${name.slice(1)}~2`;
        })
        .join(" ")
    );
    // if (!searchResults.length) {
    //   searchResults = searchIndex.search(
    //     itemNameFragments
    //       .map((name) => {
    //         if (name.length <= 3) return name;
    //         if (name.length <= 4) return name + "~1";
    //         if (name.length <= 9) return `+${name[0]}+${name.slice(1)}~2`;
    //         return `+${name[0]}+${name.slice(1)}~3`;
    //       })
    //       .join(" ")
    //   );
    // }
    existingQuery.name = { $in: searchResults.map((result) => result.ref) };
    searchScores = {};
    for (const result of searchResults) {
      searchScores[result.ref] = result.score;
    }
  }
  // Check if the query contains a roman numeral
  const romanNumberRegex = /^(?:x{0,3})(ix|iv|v?i{0,3})$/i;
  for (const word of itemNameFragments.slice(-2).reverse()) {
    if (word.match(romanNumberRegex)) {
      const expression = new RegExp(`(?: ${word} )|(?: ${word}$)`, "i");
      if (existingQuery.name) {
        existingQuery.$and = [
          { name: existingQuery.name },
          { name: expression },
        ];
        delete existingQuery.name;
      } else {
        existingQuery.name = expression;
      }
      break;
    }
  }

  const items = await connection.then((db) =>
    db.collection(process.env.DB_COLLECTION)
  );

  const pipeline = [
    { $match: existingQuery },
    ...(fuzzy
      ? [
          {
            $addFields: {
              textScore: {
                $let: {
                  vars: { searchResults },
                  in: {
                    $filter: {
                      input: "$$searchResults",
                      cond: { $eq: ["$$this.ref", "$name"] },
                    },
                  },
                },
              },
            },
          },
          {
            $addFields: {
              textScore: { $arrayElemAt: ["$textScore.score", 0] },
            },
          },
        ]
      : [{ $addFields: { textScore: { $meta: "textScore" } } }]),
    // Temporary items are given least priority, followed by special offer, DC, and then rare items
    {
      $addFields: {
        priority: {
          $max: {
            $map: {
              input: "$tagSet.tags",
              as: "tags",
              in: {
                $sum: {
                  $map: {
                    input: "$$tags",
                    as: "tag",
                    in: {
                      $switch: {
                        branches: [
                          { case: { $eq: ["$$tag", "temp"] }, then: -4 },
                          { case: { $eq: ["$$tag", "rare"] }, then: -3 },
                          { case: { $eq: ["$$tag", "so"] }, then: -2 },
                          { case: { $eq: ["$$tag", "dc"] }, then: -1 },
                        ],
                        default: 0,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        bonusSum: { $sum: "$bonuses.v" },
        combinedScore: {
          $sum: [
            { $sum: "$bonuses.v" },
            { $multiply: ["$level", "$textScore"] },
          ],
        },
        hasTextScore: { $cond: [{ $gt: ["$textScore", 0] }, 1, 0] },
      },
    },
    { $sort: { priority: -1, level: -1, combinedScore: -1 } },
    {
      $group: {
        _id: "$family",
        doc: { $first: "$$CURRENT" },
      },
    },
    { $replaceRoot: { newRoot: "$doc" } },
    // Prioritize exact matches
    {
      $addFields: {
        exactMatch: { $cond: [{ $eq: ["$name", sanitizedName] }, 1, 0] },
      },
    },
    {
      $sort: {
        exactMatch: -1,
        priority: -1,
        hasTextScore: -1,
        combinedScore: -1,
        bonusSum: -1,
      },
    },
    { $limit: 4 },
  ];
  let results = items.aggregate(pipeline);
  let item = await results.next();
  if (!item) {
    return { item: null, similarItems: [] };
  }

  const similarItems = [];
  let otherItem;
  while ((otherItem = await results.next()) !== null) {
    similarItems.push(otherItem);
  }
  return { item, similarItems };
}

exports.commands = {
  wep: "item",
  weap: "item",
  weapon: "item",
  sword: "item",
  axe: "item",
  mace: "item",
  staff: "item",
  wand: "item",
  dagger: "item",
  scythe: "item",
  acc: "item",
  accessory: "item",
  belt: "item",
  cape: "item",
  wings: "item",
  wing: "item",
  helm: "item",
  helmet: "item",
  necklace: "item",
  ring: "item",
  trinket: "item",
  bracer: "item",
  item: async function ({ channel }, input, commandName) {
    if (!input) {
      return channel.send(
        embed(
          `Usage: ${CT}${commandName} \`[name]\` - Fetches the details of an item\n` +
            "_or_" +
            `${CT}${commandName} \`[name]\` \`(operator)\` \`level\` - Fetches the details of an item ` +
            "and filters based on `level`\n" +
            "`level` should be between 0 and 90 and `operator` must be one of the following: " +
            "`=`, `<`, `>`, `<=`, `>=`, `!= or =/=`"
        )
      );
    }

    const query = {};

    const mongoOperatorMapping = {
      "=": "$eq",
      "==": "$eq",
      "===": "$eq",
      "<": "$lt",
      ">": "$gt",
      "<=": "$lte",
      "/": "$lte",
      "=<": "$lte",
      ">=": "$gte",
      "=>": "$gte",
      "!=": "$ne",
      "=/=": "$ne",
    };
    const operators = Object.keys(mongoOperatorMapping).sort(
      (a, b) => b.length - a.length
    );
    const opRegexp = new RegExp(operators.map((op) => `(?:${op})`).join("|"));
    const opMatch = input.match(opRegexp);

    let itemName = input;
    if (opMatch) {
      const operator = opMatch ? opMatch[0] : null;
      itemName = input.slice(0, opMatch.index).trim();
      let levelFilter = input.slice(opMatch.index + operator.length).trim();

      if (!levelFilter || isNaN(levelFilter)) {
        return channel.send(
          embed(
            "Either the operator you used or the number you entered is invalid."
          )
        );
      }

      levelFilter = Number(levelFilter);
      if (levelFilter < 0 || levelFilter > 90) {
        return channel.send(
          embed("The `level` filter must be between 0 and 90.")
        );
      }

      query.level = { [mongoOperatorMapping[operator]]: levelFilter };
    }

    if (itemName.match(/[^a-zA-Z0-9 \-\|'"‘’“”]/)) {
      return channel.send(
        embed("The search query cannot contain special characters.")
      );
    }

    if (commandName !== "item") {
      query.category = "weapon";
      if (commandName in { sword: 1, mace: 1, axe: 1 })
        query.type = { $in: ["sword", "mace", "axe"] };
      else if (commandName in { staff: 1, wand: 1 })
        query.type = { $in: ["staff", "wand"] };
      else if (commandName in { dagger: 1, scythe: 1 })
        query.type = commandName;
      else if (!(commandName in { wep: 1, weap: 1, weapon: 1 })) {
        query.category = "accessory";

        if (commandName === "helmet") query.type = "helm";
        else if (commandName in { cape: 1, wings: 1, wing: 1 })
          query.type = { $in: ["cape", "wings"] };
        else if (!(commandName in { acc: 1, accessory: 1 }))
          query.type = commandName;
      }
    }

    let itemResults = await getItem(itemName, query);
    if (!itemResults.item) {
      itemResults = await getItem(itemName, query, true);
      if (!itemResults.item) return channel.send(embed("No item was found"));
    }
    let item = itemResults.item;

    const embedFields = [];
    let description = null;

    const fullTagList = item.tagSet.map(({ tags }) => tags);
    const isCosmetic = fullTagList.flat().includes("cosmetic");
    const tagSet = fullTagList
      .map((tags) => `\`${tags.map(formatTag).join(", ") || "None"}\``)
      .join(" or ");
    if (item.category === "weapon") {
      description = [
        `**Tags:** ${tagSet}`,
        `**Level:** ${item.level}`,
        `**Type:** ${capitalize(item.type)}`,
        ...(isCosmetic
          ? []
          : [`**Damage:** ${item.damage.map(String).join("-") || "Scaled"}`]),
        `**Element:** ${item.elements.map(capitalize).join(" / ")}`,
        ...(isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`]),
        ...(isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`]),
      ];
      for (const special of item.specials || []) {
        embedFields.push({
          name: "Weapon Special",
          value: [
            `**Activation:** ${capitalize(special.activation)}`,
            `**Effect:** ${special.effect}`,
            ...(special.elements
              ? [`**Element:** ${special.elements.map(capitalize).join(" / ")}`]
              : []),
            ...(special.activation in { "specific enemy": 1, "click weapon": 1 }
              ? // Precision of 5 decimal places
                []
              : [`**Rate:** ${Math.round(special.rate * 10 ** 5) / 10 ** 3}%`]),
          ].join("\n"),
          inline: true,
        });
      }
    } else if (item.category === "accessory") {
      description = [
        `**Tags:** ${tagSet}`,
        `**Level:** ${item.level}`,
        `**Type:** ${capitalize(item.type)}`,
        ...(isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`]),
        ...(isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`]),
        ...(item.modifies ? [`**Modifies:**: ${item.modifies}`] : []),
      ];

      if (item.skill)
        embedFields.push({
          name: "Trinket Skill",
          value: [
            `\n**Effect:** ${item.skill.effect}`,
            `**Mana Cost:** ${item.skill.manaCost}`,
            `**Cooldown:** ${item.skill.cooldown}`,
            `**Damage Type:** ${capitalize(item.skill.damageType || "N/A")}`,
            `**Element:** ${
              (item.skill.element || [])
                .map((elem) => capitalize(elem))
                .join(" / ") || "N/A"
            }`,
          ],
          inline: true,
        });
    }

    if (itemResults.similarItems.length) {
      const otherItemText = itemResults.similarItems
        .map((similarItem) => `[${similarItem.title}](${similarItem.link})`)
        .join(", ");
      embedFields.push({ name: "Similar Results", value: otherItemText });
    }

    if (item.images && item.images.length > 1)
      embedFields.push({
        name: "Other Appearances",
        value: item.images
          .slice(1)
          .map((imageLink, index) => `[Appearance ${index + 2}](${imageLink})`)
          .join(", "),
      });
    // else if (item.images && item.images.length === 1 && item.images[0].includes('imgur')) {
    // 	description.push(`[Appearance](${item.images[0]})`);
    // }

    channel.send({
      embed: {
        title: item.title,
        url: item.link,
        description: description.join("\n"),
        fields: embedFields,
        image: { url: item.images ? item.images[0] : null },
        footer: {
          text: item.colorCustom
            ? `This item is color-custom to your ${item.colorCustom.join(
                ", "
              )} color`
            : null,
        },
      },
    });
  },

  bossgen: async function ({ channel }) {
    // TODO: Refactor. I literally copy-pasted this
    const array1 = new Array(
      "You are a duo fight called",
      "You are a solo fight called",
      "You are an EX fight called",
      "You are the boss of a dungeon called",
      "You are an open world boss called",
      "You are a gauntlet called",
      "You are a regular quest mook named",
      "You are the boss of a 1000 room dungeon called",
      "You are one of a series of endless togs named",
      "You are a trio fight called",
      "You are a quartet fight called"
    );

    const array2 = new Array(
      "The Last Stand of",
      "Super Mega Ultra",
      "Inevitable",
      "The",
      "Doomed",
      "Ehr'",
      "Heretic",
      "The One and Only",
      "Larry",
      "Fake",
      "Rare",
      "Gloom",
      "Extreme",
      "Very",
      "Mega",
      "Super",
      "Ultra",
      "Huge",
      "Elemental",
      "Pumpkin",
      "The Doomed",
      "The Chosen",
      "Avatar of",
      "Togmothy",
      "Lord",
      "The Nefarious",
      "Dreamspace",
      "Unfortunate",
      "Displaced",
      "Timetorn",
      "Timewarped",
      "Drahr'",
      "Seer",
      "Summoner",
      "King",
      "Swole",
      "Chronomancer",
      "True",
      "Unreal",
      "Ultimate",
      "The Real",
      "The Sequel to",
      "Shadow",
      "Slayer of",
      "Queen",
      "Princess",
      "Prince",
      "Necrotic",
      "Unlucky",
      "Caged",
      "Baby",
      "Titan",
      "Defender's",
      "Exalted",
      "Ascended",
      "Enhanced",
      "Master",
      "The Fallen",
      "Challenger",
      "Ancient",
      "Eternal",
      "Draconic"
    );

    const array3 = new Array(
      "Hero",
      "Tog",
      "Zeclem",
      "Timothy",
      "Larry",
      "Part 2",
      "Impostor",
      "Glaive",
      "???",
      "Chosen",
      "Dragon",
      "Human",
      "Infernal",
      "Celestial",
      "Unraveler",
      "Chaos",
      "Destiny",
      "Savior",
      "Destroyer",
      "Matrix",
      "Castle",
      "Amalgam",
      "Dungeon",
      "Professor",
      "Gauntlet",
      "Corrupted",
      "Balance",
      "Equilibrium",
      "Apex",
      "Duo",
      "Trio",
      "Quartet",
      "Ex",
      "Tower",
      "Thorn",
      "Rose",
      "Shifting",
      "Future-Past",
      "Present",
      "Cysero",
      "Cysero 2",
      "2",
      "?!",
      "Verlyrus",
      "Beast",
      "SuLema",
      "Sielu",
      "Twilly",
      "Pet Tog",
      "Paladin",
      "DeathKnight",
      "Dragonlord",
      "Necromancer",
      "DoomKnight",
      "Calendar",
      "Illumina",
      "Sans",
      "Golem",
      "Voice of the Wastes",
      "Voice of the Plains",
      "Voice of the Fallen",
      "Arbiter",
      "Scythe",
      "Blade",
      "Sword",
      "Dagger",
      "Knife",
      "Axe",
      "Mace",
      "Wand",
      "Staff",
      "Hammer",
      "Thousand Infernos",
      "Thousand Flames"
    );

    const array4 = new Array(
      "and deal heavy Light damage.",
      "and deal basically no damage.",
      "and rely on DoTs to deal damage.",
      "and deal exclusively Null damage.",
      "and deal damage of multiple elements.",
      "and deal heavy Ice damage.",
      "and deal heavy Darkness damage.",
      "and deal heavy Water damage.",
      "and deal heavy Energy damage.",
      "and deal heavy Good damage.",
      "and deal heavy ??? damage.",
      "and deal heavy Stone damage.",
      "and deal heavy Nature damage.",
      "and deal heavy Fire damage.",
      "and deal heavy Wind damage.",
      "and deal moderate Ice damage.",
      "and weakness seek on all your attacks.",
      "and deal Curse damage.",
      "and deal Ebil damage.",
      "and deal heavy Evil damage.",
      "and deal only indirect damage.",
      "and don't do any damage at all.",
      "and deal None damage.",
      "and deal heavy None damage.",
      "and deal moderate Good damage.",
      "and deal heavy Good and Evil damage.",
      "and deal Poison damage.",
      "and do basically no damage but inflict multiple debuffs.",
      "and constantly miss.",
      "and deal damage of a random element.",
      "and are listed as ??? damage but do damage of multiple elements.",
      "and have high base MPM.",
      "and have absurdly high base Bonus.",
      "and deal middling damage.",
      "and are bugged to do much more damage than intended.",
      "and are bugged to do much less damage than intended."
    );

    const array5 = new Array(
      "You have a 2 hit When shield",
      "You have a 1 hit When shield",
      "You somehow have a 0 hit When shield, to everyone's frustration",
      "You have a 3 hit When shield",
      "You have a 4 hit When shield",
      "You have a 5 hit When shield",
      "You have adaptive resistance",
      "You reflect 50% of direct damage",
      "You reflect 100% of direct damage",
      "You reflect 200% of direct damage",
      "You are immune to damage",
      "You are enraged",
      "You deal 200% more damage",
      "You deal 100% more damage",
      "You gain 900 MPM",
      "You gain 10 MPM",
      "You change forms",
      "You gain 200 Bonus",
      "You gain 5 Bonus",
      "You gain 75 Bonus",
      "You gain 1 Bonus",
      "You retaliate with 100% of your damage range",
      "You inflict a 5-turn stun",
      "You inflict -100 All resistance",
      "You inflict a 20-turn stun",
      "You gain a thorns effect",
      "You fully heal",
      "You heal 25% of your health",
      "You heal 50% of your health",
      "You heal exactly 5 health",
      "You nuke",
      "You inflict -50 Bonus",
      "You inflict -50 Boost",
      "You gain 100 resistance to the last element you were damaged by",
      "You purge effects from yourself",
      "You purge effects from the player",
      "You gain 100 All res",
      "You inflict -50 MPM",
      "You instantly kill the player",
      "You set the player to 1 HP",
      "You inflict a DoT",
      "You gain an extra hit on your attack",
      "You take an extra turn",
      "You crash the game",
      "You lag the game",
      "Your attacks deal 1% more damage",
      "You remove all temporary items",
      "You steal a potion",
      "You have +200 crit on your next attack",
      "Your next attack deals Null damage",
      "You do half damage",
      "You gain 1% more damage per hit"
    );

    const array6 = new Array(
      "every 10 turns.",
      "every 2 turns.",
      "every turn.",
      "when the player enters the battle.",
      "when the player is affected by a status.",
      "when you are affected by a status.",
      "when you are below 50% health.",
      "when you are below 5% health.",
      "every turn if the player has a pet equipped.",
      "when the player shields.",
      "when the player deals 10% of your health in a single turn.",
      "when you are affected by more statuses than the player.",
      "whenever you are hit.",
      "when your HP reaches 0.",
      "at the beginning of every rotation.",
      "when the player drinks a potion.",
      "when the player equips a temporary item.",
      "when the player heals.",
      "every 5 turns.",
      "whenever the player changes equipment.",
      "every turn if the player has Adventure Mode on.",
      "if the player has more All resistance than you.",
      "if the player attempts to stun you.",
      "if the player inflicts a blind on you.",
      "if the player uses a trinket.",
      "every turn if the player has DoomKnight V1 equipped.",
      "every turn if the player has a calendar class equipped.",
      "every turn if the player has a fully trained class equipped.",
      "every turn if the player has Kathool Adept equpped.",
      "if the player procs Ice Scythe.",
      "if the player is watching a guide video during the fight.",
      "every turn if the player has a Rare equipped.",
      "every turn if the player is NDA.",
      "only when the player is below 50% HP.",
      "only when the player is at full HP.",
      "every turn if the player is playing a DC class.",
      "at random.",
      "50% of the time.",
      "when you are affected by a DoT.",
      "only half the time due to a bug.",
      "under unknown conditions that players just can't figure out.",
      "replacing a random attack in your rotation.",
      "if your last hit connected.",
      "if your last hit missed.",
      "if the player deals a critical hit.",
      "if you miss more than twice in a turn.",
      "if the player misses against you.",
      "based on a coinflip."
    );

    const array7 = new Array(
      "You have 10 All res.",
      "You have 90 base MPM.",
      "You have 300 Immobility resistance.",
      "You have 100 All res.",
      "You have 50 All res.",
      "You have 50 Ice res.",
      "You have 1000 base Bonus.",
      "You have 10 base Bonus.",
      "You have 100 Shrink res.",
      "You have 200 Shrink res.",
      "You have 50 Fire res.",
      "You have 100 Good and Evil res.",
      "You have -100 Evil res.",
      "You have -5 flavor res.",
      "You have 5000 base HP.",
      "You have 100 base HP.",
      "You have 50 base HP but have weirdly high MPM and All res.",
      "You have 1000 base HP.",
      "You have 20000 base HP.",
      "You have 50000 base HP outside of Doomed Mode!",
      "You have 50 base MPM and high resistances.",
      "You have 50 Good and Evil res.",
      "You have base 90 MPM and 20 All res.",
      "You have 300 CHA.",
      "You have 212 STR but all your attacks deal magic damage.",
      "You have 112 INT but all your attacks do melee damage.",
      "You have 200 DEX and deal 100% damage range DoTs.",
      "You had 252 LUK and constantly direct hit players before those were removed.",
      "You have 25 All res and -25 Nature res.",
      "You have -5 Good res.",
      "You have -1 Light res just for flavor.",
      "You have 200 Dark and Light res.",
      "You have 100 MPM and 10k base HP.",
      "You have 0 MPM and 20k base HP.",
      "Your elemental resistances change every turn.",
      "Your fight has a lot of animated elements.",
      "Your attacks have really long animations."
    );

    const array8 = new Array(
      "You are immune to indirect damage.",
      "You enrage when any participant in the battle dies.",
      "You are immune to pet damage.",
      "You are immune to direct damage.",
      "You are immune to DoTs.",
      "You have an attack that gives you a HoT.",
      "Players often complain your fight is really laggy.",
      "All your attacks just happen randomly, much to the dismay of people trying to copy strategies.",
      "Your rotation is randomized, which players are frequently confused about.",
      "One of your attacks seems to do nothing.",
      "Sometimes one of your attacks sticks and it takes 10 minutes for the unstick button to load.",
      "Guests are banned against you.",
      "You become enraged by guests.",
      "You frequently heal in your fight.",
      "Players are often surprised to realize that there's a second phase to your fight.",
      "Players think you're easy, until they see that the next battle is your stronger form.",
      "You were nerfed after frequent player complaints.",
      "Players often complain about how hard it is to access your fight.",
      "You have a telegraphed rotation that people still somehow miss.",
      "Your damage was nerfed multiple times.",
      "You were buffed after players complained how easy you were, and now you're considered one of the hardest fights in the game.",
      "Players hate having to farm you.",
      "You drop one of the best items in the game.",
      "People farm you looking for a 1% drop.",
      "Pets deal extra damage to you.",
      "You are considered a bonus boss.",
      "You're secretly an easter egg.",
      "Players are usually underprepared and undergeared for you.",
      "The developers intended you to be a challenge.",
      "Every couple of weeks, a new bug shows up even though your code wasn't touched.",
      "Players praise you for your high quality art and animations.",
      "Players praise you for your high quality art, but are disappointed by your fight mechanics.",
      "No one actually understands how your mechanics work.",
      "Players completely misunderstand how they're supposed to approach your fight.",
      "Your fight is weirdly laggy for no discernible reason.",
      "The developers put a lot of time into your mechanics and rotation, but people just burst you from full anyway.",
      "The optimal strategy in your fight is to stack DEX.",
      "The optimal strategy in your fight is resistance stack.",
      "The mechanics of your fight are incredibly complex, but they're entirely ignorable.",
      "Your rotation is bugged.",
      "All the guides to your fight are extremely outdated.",
      "People constantly tweet about not being able to beat you without food and 5 potions.",
      "You were indirectly buffed a few months ago due to a game engine change.",
      "Your reward has been power crept since release.",
      "You were once considered one of the hardest bosses in the game, before you were power crept.",
      "You were bugged to be extremely difficult on release.",
      "Your drop is extremely good at a single niche and players are frustrated when they have to fight you to use your drop in another fight."
    );

    const strRandomizer =
      array1[Math.floor(Math.random() * array1.length)] +
      " " +
      array2[Math.floor(Math.random() * array2.length)] +
      " " +
      array3[Math.floor(Math.random() * array3.length)] +
      " " +
      array4[Math.floor(Math.random() * array4.length)] +
      " " +
      array5[Math.floor(Math.random() * array5.length)] +
      " " +
      array6[Math.floor(Math.random() * array6.length)] +
      " " +
      array7[Math.floor(Math.random() * array7.length)] +
      " " +
      array8[Math.floor(Math.random() * array8.length)] +
      " ";

    await channel.send({
      embed: {
        description: strRandomizer,
        title: "DragonFable Fight Generator",
        footer: { text: "Made by shrike" },
      },
    });
  },
};
