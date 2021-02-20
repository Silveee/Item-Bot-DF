'use strict';

const connect = require('./db');

const CT = process.env.COMMAND_TOKEN;
const aliases = {
	'nsod': 'necrotic sword of doom',
	'boa': 'blade of awe',
	'bod': 'blade of destiny',
	'doomed': 'doomed dragon amulet scythe of elementals',
	'ddsoe': 'doomed dragon amulet scythe of elementals',
	'ultimate scythe': 'ultimate dragon amulet scythe of elementals',
	'adsoe': 'ancient dragon amulet scythe of the elements',
	'ancient': 'ancient dragon amulet scythe of the elements',
	'vik': 'vanilla ice katana',
	'uok': 'ultra omniknight blade',
	'ublod': 'ultimate blinding light of destiny',
	'fc': 'frozen claymore',
	'nstb': 'not so tiny bubbles',
	'ba': 'baltael\'s aventail',
	'npsb': 'necro paragon soulblade',
	'gg': 'forgotten gloom glaive',
	'scc': 'sea chicken\'s conquest',
	'adl': 'ancient dragonlord helm',
	'eud': 'elemental unity defender',
	'pdl': 'dragon\'s patience',
	'rdl': 'dragon\'s rage',
	'fdl': 'fierce dragonlord helm',
	'ddv': 'distorted doom visage',
	'ddb': 'defender\'s dragon belt',
	'ddr': 'defender\'s dragon ring',
	'ddn': 'defender\'s dragon necklace',
	'c7': 'the corrupted seven',
	'ricterild': 'summon gem ricterild ex',
	'roktoru': 'summon gem roktoru ex',
	'aya': 'summon gem ayauhnqui ex',
	'gt': 'grove tender',
	'sf': 'soulforged scythe',
	'lh': 'lucky hammer',
};
const validTypes = new Set([
	'weapon', 'accessory', 'cape', 'wing', 'helm',
	'ring', 'belt', 'necklace', 'trinket', 'bracer'
]);
const bonuses = new Set([
	'block', 'dodge', 'parry', 'crit', 'magic def', 'pierce def', 'melee def',
	'wis', 'end', 'cha', 'luk', 'int', 'dex', 'str', 'bonus'
]);

/**
 * Capitalizes the first letter of every other word in the input text, with
 * few exceptions, which are instead capitalized fully.
 *
 * @param {String} text
 *   Text to be capitalized
 *
 * @return {String}
 *   String with alternate words in the input text capitalized, or the text
 *   fully capitalized if the text is one of several values
 */
function capitalize(text) {
	const fullCapWords = new Set([ // These words are fully capitalized
		'str', 'int', 'dex', 'luk', 'cha',
		'wis', 'end', 'dm', 'so', 'dc', 'da', 'ak'
	]);
	if (fullCapWords.has(text)) return text.toUpperCase();

	if (!text || !text.trim()) return text;

	return text
		.trim()
		.split(' ')
		.map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Format an input tag
 *
 * @param {String} tag
 *   Tag to be formatted
 *
 * @return {String}
 *   'Seasonal', 'ArchKnight Saga', 'Alexander Saga' if the input tag is 'se', 'ak', or 'alexander'
 *   respectively. The return value is capitalize(tag) otherwise
 */
function formatTag(tag) {
	return {
		'se': 'Seasonal',
		'ak': 'ArchKnight Saga',
		'alexander': 'Alexander Saga'
	}[tag] || capitalize(tag);
}

/**
 * Does the following:
 * - Lowercases input text
 * - Removes leading and trailing whitespace
 * - Removes accents from input text characters
 * - Removes brackets, quotes, and backticks
 * - Replaces all other alphanumeric characters with a single whitespace
 * - Replaces all instances of more than one whitespace with a single whitespace
 * Example: "Alina's Battle-Bouquet Staff" -> "alinas battle bouquet staff"
 *
 * @param {String} text
 *   Input text to be sanitized
 *
 * @return {String}
 *   Sanitized text
 */
function sanitizeText(text) {
	return text.toLowerCase()
		// Replace accented characters with their non-accented versions
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/[()'"“”‘’`]/g, '') // Remove brackets, quotes, and backticks
		// Replace all other non-alphanumeric character (other than |)
		// sequences with a single whitespace
		.replace(/[^a-z0-9|]+/g, ' ')
		.trim();
}

/**
 * Formats an array of boosts (resistances or stat bonuses) into a comma-separated list
 * Example: [{ k: 'int', v: 3 }, { k: 'melee def', v: -1 }] -> 'INT +3, Melee Def -1'
 * 
 * @param {{ k: String, v: Number }[] | null} boosts
 *   An array of objects listing each boost's name (k) and value (v)
 *
 * @return {String}
 *   A comma separated list of boost names and their corresponding values, obtained by:
 *   - Capitalizing each boost name
 *   - Prepending a '+' to the boost's value if it is > 0
 *   - Joining boost's name and value together with a space
 *   - Joining each string of boost name/value pairs with ', '
 */
function formatBoosts(boosts) {
	return (boosts || [])
		.map(boost => {
			const name = capitalize(boost.k);
			const value = (boost.v < 0 ? '' : '+') + boost.v;
			return name + ' ' + value;
		})
		.join(', ') || 'None';
}

/**
 * Get details of an item from the database. The input item name is sanitized and converted to its original form
 * if it is an alias of another item name.
 * If the exact item name is not found in the database, a text search is done in descending order of level.
 * The details of the first result is then returned instead
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
async function getItem(itemName, existingQuery) {
	itemName = sanitizeText(itemName);
	if (itemName in aliases) itemName = aliases[itemName];
	existingQuery.name = itemName;

	const db = await connect();
	const items = await db.collection(process.env.DB_COLLECTION);

	const pipeline = [
		{ $match: existingQuery },
		// Temporary items are to be at the bottom of the search, followed by special offer and DC items
		{
			$addFields: {
				priority: {
					$switch: {
						branches: [
							{ case: { $in: ['temporary', { $ifNull: ['$tags', []] }] }, then: -3 },
							{ case: { $in: ['so', { $ifNull: ['$tags', []] }] }, then: -2 },
							{ case: { $in: ['dc', { $ifNull: ['$tags', []] }] }, then: -1 },
						],
						default: 0
					}
				}
			}
		},
		{ $sort: { level: -1, priority: -1 } },
		{ $limit: 1 }
	];
	let results = items.aggregate(pipeline);
	let item = await results.next();
	// Do a text search instead if no exact match is found
	if (!item) {
		delete existingQuery.name;
		existingQuery.$text = { $search: '"' + itemName + '"' };
		results = items.aggregate(pipeline);
		item = await results.next();
	}
	return item;
}

exports.commands = {
	wep: 'item',
	weap: 'item',
	weapon: 'item',
	acc: 'item',
	accessory: 'item',
	item: async function ({ channel }, args, commandName) {
		const [itemName, maxLevel] = args.split('/');
		if (!itemName.trim() || (maxLevel && isNaN(maxLevel))) {
			return channel.send(`Usage: ${CT}${commandName} \`[name]\` / \`[max level (optional)]\``);
		}

		const query = {};
		if (maxLevel) query.level = { $lte: Number(maxLevel) };
		if (commandName in { 'wep': 1, 'weap': 1, 'weapon': 1 }) query.category = 'weapon';
		else if (commandName in { 'acc': 1, 'accessory': 1 }) query.category = 'accessory';

		const item = await getItem(itemName, query);
		if (!item) return channel.send('No item was found');

		const embedFields = [];
		let description = null;
		const isCosmetic = item.tags && item.tags.includes('cosmetic');
		if (item.category === 'weapon') {
			description = [
				`**Tags:** ${(item.tags || []).map(formatTag).join(', ') || 'None'}`,
				`**Level:** ${item.level}`,
				`**Type:** ${item.type.map(capitalize).join(' / ')}`,
				...isCosmetic ? [] : [`**Damage:** ${item.damage.map(String).join('-') || 'Scaled'}`],
				`**Element:** ${item.elements.map(capitalize).join(' / ')}`,
				...isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`],
				...isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`],
			];
			for (const special of item.specials || []) {
				embedFields.push({
					name: 'Weapon Special',
					value: [
						`**Activation:** ${capitalize(special.activation)}`,
						`**Effect:** ${special.effect}`,
						...special.elements ? [`**Element:** ${special.elements.map(capitalize).join(' / ')}`] : [],
						...special.activation in { 'specific enemy': 1, 'click weapon': 1 } ?
							[] : [`**Rate:** ${special.rate * 100}%`],
					].join('\n'),
					inline: true
				});
			}
		} else if (item.category === 'accessory') {
			description = [
				`**Tags:** ${(item.tags || []).map(formatTag).join(', ') || 'None'}`,
				`**Level:** ${item.level}`,
				`**Type:** ${capitalize(item.type)}`,
				...isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`],
				...isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`],
				...item.modifies ? [`**Modifies:**: ${item.modifies}`]: []
			];
	
			if (item.skill) embedFields.push({
				name: 'Trinket Skill',
				value: [
					`\n**Effect:** ${item.skill.effect}`,
					`**Mana Cost:** ${item.skill.manaCost}`,
					`**Cooldown:** ${item.skill.cooldown}`,
					`**Damage Type:** ${capitalize(item.skill.damageType || 'N/A')}`,
					`**Element:** ${(item.skill.elements || []).map(elem => capitalize(elem)).join(' / ')}`
				],
				inline: true,
			});
		}

		if (item.images && item.images.length > 1)
			embedFields.push({
				name: 'Images',
				value: item.images.map((imageLink, index) => `[Appearance ${index + 1}](${imageLink})`).join(', ')
			});
		else if (item.images && item.images.length === 1 && item.images[0].includes('imgur')) {
			description.push(`[Appearance](${item.images[0]})`);
		}

		channel.send({ embed:
			{
				title: item.title,
				url: item.link,
				description: description.join('\n'),
				fields: embedFields,
				image: { url: item.images && item.images.length === 1 ? item.images[0] : null },
				footer: {
					text: item.colorCustom ?
						`This item is color-custom to your ${item.colorCustom.join(', ')} color`
						: null
				}
			}
		});
	},

	sort: async function ({ channel }, args) {
		const embed = (text, title) => { 
			const body = {};
			body.description = text;
			if (title) body.title = title;
			return { embed: body };
		};

		let [itemType, sortExp, maxLevel] = args
			.split(',')
			.map(arg => arg.trim().toLowerCase()) || [];
		if (!itemType || !sortExp)
			return channel.send(embed(
				`Usage: ${CT}sort\`item type\`, \`attribute to sort by\`, \`max level (optional)\\n` +
				`\`item type\` - Valid types are: _${[...validTypes].join(', ')}_. ` +
				"Abbreviations such as 'acc' and 'wep' also work.\n" +
				'`attribute to sort by` can be any stat bonus or resistance ' +
				'_(eg. STR, Melee Def, Bonus, All, Ice, Health etc.)_, or in the case of weapons, _damage_. ' +
				'Add a - sign at the beginning of the `attribute` to sort in ascending order.'
			));
		if (maxLevel && maxLevel.match(/[^\-0-9]/)) {
			return channel.send(embed(`"${maxLevel}" is not a valid number.`));
		}

		maxLevel = Number(maxLevel);
		if (maxLevel < 0 || maxLevel > 90) {
			return channel.send(embed(`The max level should be between 0 and 90 inclusive. ${maxLevel} is not valid.`));
		}
		if (itemType.slice(-1) === 's') itemType = itemType.slice(0, -1); // strip trailing s

		if (itemType === 'wep') itemType = 'weapon';
		// "accessorie" because the trailing s would have been removed
		else if (itemType === 'acc' || itemType === 'accessorie') itemType = 'accessory';
		else if (itemType === 'helmet') itemType = 'helm';
		if (!validTypes.has(itemType)) {
			return channel.send(embed(
				`"${itemType}" is not a valid item type. Valid types are: _${[...validTypes].join(', ')}_. ` +
				'"acc" and "wep" are valid abbreviations for accessories and weapons.'
			));
		}

		sortExp = sortExp.trim().toLowerCase();
		// Ignore search query if it contains an invalid character
		if (sortExp.match(/[^\-0-9a-z? ]/)) return channel.send(embed('No results were found.'));

		const db = await connect();
		let items = null;
		items = await db.collection(process.env.DB_COLLECTION);

		const filter = { newField: { $exists: true, $ne: 0 } };
		if (!isNaN(maxLevel)) filter.level = { $lte: maxLevel };
		if (itemType === 'weapon') {
			filter.tags = { $ne: 'temporary' };
			filter.damage = { $lt: 125 }; // Default weapons of certain classes. Ignore these
		}
		else if (itemType in { 'cape':1, 'wings':1 }) filter.type = { $in: ['cape', 'wings'] };
		// Temporary until all accessories with type 'helmet' are converted to 'helm'
		else if (itemType === 'helm') filter.type = { $in: ['helm', 'helmet'] };
		else if (itemType !== 'accessory') filter.type = itemType;

		// sort in descending order by default, but sort in ascending order if the sorting
		// expression starts with a - sign
		let sortOrder = -1;
		if (sortExp[0] === '-') {
			sortExp = sortExp.slice(1).trim();
			sortOrder = 1;
		}
		// The expression before prepending anything to it
		const originalExp = sortExp;

		if (bonuses.has(sortExp)) sortExp = 'bonuses.' + sortExp;
		else if (sortExp !== 'damage') sortExp = 'resists.' + sortExp;

		/* Keeps lower level items but removes items with the same name or pedia url
		   within the same group. This block of code might be needed later. */
		// const pipeline = [
		// 	{ $addFields: { damage: { $avg: '$damage' }, bonuses: { $arrayToObject: '$bonuses' }, resists: { $arrayToObject: '$resists' } } },
		// 	{ $addFields: { newField: '$' + sortExp } },
		// 	{ $match: filter },

		// 	{ $sort: { level: -1 } },
		// 	// Remove documents that have the same name and newly added field value, keep only max level version
		// 	{ $group: { _id: { newField: '$newField', name: '$name' }, doc: { $first: '$$CURRENT' } } },
		// 	// Remove documents that have the same pedia url and newly added field value
		// 	{ $group: { _id: { newField: '$doc.newField', link: '$doc.link' }, doc: { $first: '$doc' } } },
		// 	// Place all items with the same new field value into the same group
		// 	{ $group: { _id: '$doc.newField', newField: { $first: '$doc.newField' }, items: { $addToSet: { title: '$doc.title', level: '$doc.level', tags: '$doc.tags' } } } },
		// 	{ $sort: { newField: sortOrder } },
		// 	{ $limit: 10 }
		// ];
		const pipeline = [
			{
				$addFields: {
					damage: { $avg: '$damage' },
					bonuses: { $arrayToObject: '$bonuses' },
					resists: { $arrayToObject: '$resists' }
				}
			},
			{ $addFields: { newField: '$' + sortExp } },
			{ $match: filter },
			{ $sort: { newField: sortOrder, level: -1 } },
			// Remove documents that share the same pedia URL, only keep the max level version
			{ $group: { _id: { link: '$link' }, doc: { $first: '$$CURRENT' } } },
			// Remove documents that share the same item name
			{ $group: { _id: { name: '$doc.name' }, doc: { $first: '$doc' } } },
			// Group documents 
			{
				$group: {
					_id: '$doc.newField', newField: { $first: '$doc.newField' }, 
					items: { $addToSet: { title: '$doc.title', level: '$doc.level', tags: '$doc.tags' } }
				}
			},
			{ $sort: { newField: sortOrder, level: -1 } },
			{ $limit: 10 }
		];
		const results = items.aggregate(pipeline);

		let sorted = '';
		let itemGroup = null;
		let index = 0;
		while ((itemGroup = (await results.next())) !== null) {
			if (index > 1)
				itemGroup.items = itemGroup.items.filter(item => !(item.tags || []).includes('rare'));
			if (!itemGroup.items.length) continue;

			const items = itemGroup.items.map(item => {
				const tags = item.tags ? `[${item.tags.map(capitalize).join(', ')}]` : '';
				return `${item.title} _(lv. ${item.level})_ ${tags}`.trim();
			});
			const message = `**${++index})** ${items.join(' / ')} **_(${itemGroup.newField})_**\n\n`;
			if (message.length + sorted.length > 2048) break;
			sorted += message;
		}

		if (!sorted) return channel.send(embed('No results were found.'));

		let formattedItemType = '';
		if (itemType === 'accessory') formattedItemType = 'accessories';
		else formattedItemType = itemType.slice(-1) === 's' ? itemType : itemType + 's';
		formattedItemType = capitalize(formattedItemType);

		channel.send(embed(sorted.trim(), `Sort ${formattedItemType} by ${capitalize(originalExp)}`))
			.catch(() => channel.send('An error occured'));
	},
};
