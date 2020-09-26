'use strict';

const connect = require('./db');

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

function capitalize(word) {
	// Capitalizes the first letter of every other word

	// Except these, though; They're fully capitalized
	if (word in { 'str':1, 'int':1, 'dex':1, 'luk':1, 'cha':1, 'wis':1, 'end':1, 'dm':1, 'so':1, 'dc':1, 'da':1 }) return word.toUpperCase();
	if (!word || !word.trim()) return word;
	return word.trim().split(' ').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}
function sanitizeName(name) {
	// Lowercases names, removes leading and trailing whitespace, and removes unnecessary characters
	return name.toLowerCase().replace(/[.,\-"()]/g, ' ').replace(/’/g, '\'').replace(/ +/g, ' ').trim();
}
function formatBoosts(boosts) {
	// Displays resistances and bonuses the correct way
	const formatData = boost => {
		const name = capitalize(boost.k);
		const value = (boost.v < 0 ? '' : '+') + boost.v;
		return name + ' ' + value;
	};
	return boosts.map(formatData).join(', ') || 'None';
}

async function getItem(type, itemName, existingQuery) {
	itemName = sanitizeName(itemName);
	if (itemName in aliases) itemName = aliases[itemName];
	const query = existingQuery;
	query.name = itemName;

	const db = await connect();
	const items = await db.collection(type);

	let results = items.find(query).sort({ level: -1 }).limit(1);
	let item = await results.next();
	// Do a text search if no character is found
	if (!item) {
		delete query.name;
		query.$text = { $search: '"' + itemName + '"' };
		const results = items.find(query).sort({ level: -1 }).limit(1);
		item = await results.next();
	}
	return item;
}

// function parseNumberArgs(args) {
// 	// Converts a query of the form (operator)(number)[, (operator)(number)[, ...]] into a mongodb query object
// 	// Where (operator) is =, <, >, <=, or >=
// 	// If (operator) is missing, = is used by default
// 	const query = {};
// 	args = args.split(',').map(arg => arg.trim());
// 	for (const arg of args) {
// 		if (arg.slice(0, 2) === '<=') query.$lte = Number(arg.slice(2));
// 		else if (arg.slice(0, 2) === '>=') query.$gte = Number(arg.slice(2));
// 		else if (arg[0] === '=') query.$eq = Number(arg.slice(1));
// 		else if (arg[0] === '>') query.$gt = Number(arg.slice(1));
// 		else if (arg[0] === '<') query.$lt = Number(arg.slice(1));
// 		else query.$eq = Number(arg);
// 	}
// 	return query;
// }

// function parseNamedNumberArgs(args) {
// 	// Converts a query of the form (name 1)(operator)(number)[, (name 2)(operator)(number)[, ...]] into a mongodb query object
// 	// (name) is any string without whitespace
// 	// (operator) is =, <, >, <=, or >=
// 	// If (operator) is missing, = is used by default
// 	const query = {};
// 	args = args.split(',').map(arg => arg.trim());
// 	for (const arg of args) {
// 		if (arg.slice(0, 2) === '<=') query.$lte = Number(arg.slice(2));
// 		else if (arg.slice(0, 2) === '>=') query.$gte = Number(arg.slice(2));
// 		else if (arg[0] === '=') query.$eq = Number(arg.slice(1));
// 		else if (arg[0] === '>') query.$gt = Number(arg.slice(1));
// 		else if (arg[0] === '<') query.$lt = Number(arg.slice(1));
// 		else query.$eq = Number(arg);
// 	}
// 	return query;
// }

exports.commands = {
	wep: 'weapon',
	weapon: async function (args, channel) {
		const [item, maxLevel] = args.split('/');
		if (!item.trim() || (maxLevel && isNaN(maxLevel))) return channel.send(`Usage: ${process.env.COMMAND_TOKEN}weapon \`[name]\` / \`[max level (optional)]\``);

		const query = { tags: { $ne: 'temporary' } };
		if (maxLevel) query.level = { $lte: Number(maxLevel) };
		const weapon = await getItem('weapons', item, query);
		if (!weapon) return channel.send('No weapon was found');

		const description = [
			`**Tags:** ${weapon.tags.map(capitalize).join(', ') || 'None'}`,
			`**Level:** ${weapon.level}`,
			`**Type:** ${weapon.type.map(capitalize).join(' / ')}`,
			`**Damage:** ${weapon.damage.map(String).join('-') || 'Scaled'}`,
			`**Element:** ${weapon.elements.map(capitalize).join(' / ')}`,
			`**Bonuses:** ${formatBoosts(weapon.bonuses)}`,
			`**Resists:** ${formatBoosts(weapon.resists)}`,
			weapon.link,
		];
		const specialFields = [];
		for (const special of weapon.specials) {
			const specialField = [];
			specialField.push(`**Activation:** ${capitalize(special.activation)}`);
			specialField.push(`**Effect:** ${special.effect}`);
			if (special.elements.length) specialField.push(`**Element:** ${special.elements.map(capitalize).join(' / ')}`);
			specialField.push(`**Rate:** ${special.rate * 100}%`);
			specialFields.push({ name: 'Weapon Special', value: specialField.join('\n'), inline: true });
		}
		channel.send({ embed:
			{
				title: weapon.title,
				description: description.join('\n'),
				fields: specialFields
			}
		});
	},
	acc: 'accessory',
	accessory: async function (args, channel) {
		const [item, maxLevel] = args.split('/');
		if (!item.trim() || (maxLevel && isNaN(maxLevel))) return channel.send(`Usage: ${process.env.COMMAND_TOKEN}accessory \`[name]\` / \`[max level (optional)]\``);

		const query = { tags: { $ne: ['temporary'] } };
		if (maxLevel) query.level = { $lte: Number(maxLevel) };
		const accessory = await getItem('accessories', item, query);
		if (!accessory) return channel.send('No accessory was found.');

		const description = [
			`**Tags:** ${accessory.tags.map(capitalize).join(', ') || 'None'}`,
			`**Level:** ${accessory.level}`,
			`**Type:** ${capitalize(accessory.type)}`,
			`**Bonuses:** ${formatBoosts(accessory.bonuses)}`,
			`**Resists:** ${formatBoosts(accessory.resists)}`,
		];
		if (accessory.modifies) description.push(`**Modifies:**: ${accessory.modifies}`);

		const fields = [];
		if (accessory.skill) fields.push({
			name: 'Trinket Skill',
			value: [
				`\n**Effect:** ${accessory.skill.effect}`,
				`**Mana Cost:** ${accessory.skill.manaCost}`,
				`**Cooldown:** ${accessory.skill.cooldown}`,
				`**Damage Type:** ${capitalize(accessory.skill.damageType)}`,
				`**Element:** ${capitalize(accessory.skill.element)}`
			],
			inline: true,
		});
		description.push(accessory.link);
		channel.send({ embed:
			{
				title: accessory.title,
				description: description.join('\n'),
				fields
			}
		});
	},

	sort: async function (args, channel) {
		let [type, sortExp] = args.split(',').map(arg => arg.trim().toLowerCase()) || [];
		if (!type || !sortExp) return channel.send(`Usage: ${process.env.COMMAND_TOKEN}sort \`type\`, \`sorting expression\``);

		if (type === 'wep') type = 'weapon';
		else if (type === 'acc') type = 'accessory';
		const validTypes = new Set(['weapon', 'accessory', 'cape', 'wings', 'helm', 'belt', 'necklace', 'trinket', 'bracer']);
		if (!validTypes.has(type)) return channel.send(`Valid types are: ${[...validTypes].join(', ')}`);

		sortExp = sortExp.trim().toLowerCase();
		if (sortExp.match(/[^0-9a-z? ]/)) return channel.send('No results were found.');
		const originalExp = sortExp;

		const db = await connect();
		let items = null;
		if (type === 'weapon') items = await db.collection('weapons');
		else items = await db.collection('accessories');

		const filter = { newField: { $exists: true, $ne: 0 } };
		if (type === 'weapon') {
			filter.tags = { $ne: 'temporary' };
			filter.name = { $nin: ['longsword', 'melee'] }; // Default weapons of certain classes. Ignore these
		}
		else if (type in { 'cape':1, 'wings':1 }) filter.type = { $in: ['cape', 'wings'] };
		// Temporary until all accessories with type 'helmet' are converted to 'helm'
		else if (type === 'helm') filter.type = { $in: ['helm', 'helmet'] };
		else if (type !== 'accessory') filter.type = type;

		const bonuses = new Set(['block', 'dodge', 'parry', 'crit', 'magic def', 'pierce def', 'melee def', 'wis', 'end', 'cha', 'luk', 'int', 'dex', 'str', 'bonus']);
		if (bonuses.has(sortExp)) sortExp = 'bonuses.' + sortExp;
		else if (sortExp !== 'damage') sortExp = 'resists.' + sortExp;

		const sortOrder = sortExp === 'resists.health' ? 1 : -1;
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
			{ $addFields: { damage: { $avg: '$damage' }, bonuses: { $arrayToObject: '$bonuses' }, resists: { $arrayToObject: '$resists' } } },
			{ $addFields: { newField: '$' + sortExp } },
			{ $match: filter },
			{ $sort: { level: -1 } },
			// Remove documents that share the same pedia URL, keep only max level version
			{ $group: { _id: { link: '$link' }, doc: { $first: '$$CURRENT' } } },
			// Remove documents that share the same item name
			{ $group: { _id: { name: '$doc.name' }, doc: { $first: '$doc' } } },
			// Group documents 
			{ $group: { _id: '$doc.newField', newField: { $first: '$doc.newField' }, items: { $addToSet: { title: '$doc.title', level: '$doc.level', tags: '$doc.tags' } } } },
			{ $sort: { newField: sortOrder } },
			{ $limit: 10 }
		];
		const results = items.aggregate(pipeline);

		let message = [];
		let itemGroup = null;
		let itemCount = 0;
		let index = 0;
		while ((itemGroup = (await results.next())) !== null) {
			if (index > 0)
				itemGroup.items = itemGroup.items.filter(item => !item.tags.includes('rare'));
			if (!itemGroup.items.length) continue;

			itemCount += itemGroup.items.length;
			const items = itemGroup.items.map(item => {
				const tags = item.tags.length ? `[${item.tags.map(capitalize).join(', ')}]` : '';
				return `${item.title} _(lv. ${item.level})_ ${tags}`.trim();
			});
			message.push(`**${++index})** ${items.join(' / ')} **_(${itemGroup.newField})_**`);

			if (itemCount >= 20) break;
		}

		message = message.join('\n');
		if (!message) channel.send('No results were found.');
		else channel.send({ embed:
			{
				title: `Sort by ${capitalize(originalExp)}`,
				description: message,
			}
		})
			.catch(() => channel.send('An error occured'));
	},

	// search: 'query',
	// query: async function (args, channel) {
	// 	args = args.trim();
	// 	if (!args)
	// 		return channel.send('');
	// 	const categories = { weapon: args.slice(0, 6).toLowerCase(), accessory: args.slice(0, 9).toLowerCase() };
	// 	const isWeapon = categories.weapon === 'weapon';
	// 	if (!isWeapon && categories.accessory !== 'accessory')
	// 		return channel.send('Specify whether you\'re searching for a weapon or an accessory.');

	// 	const category = isWeapon ? 'weapons' : 'accessories';
	// 	args = args.substr((isWeapon ? 6 : 9) + 1);
	// 	if (args.slice(0, 2) !== '--') return;
	// 	args = args.slice(2).split('--');

	// 	const filter = { tags: { $ne: 'temporary' } };
	// 	const sortBy = { level: -1 };

	// 	for (const line of args) {
	// 		const firstSpace = line.indexOf(' ');
	// 		const arg = firstSpace > -1 ? line.slice(0, firstSpace) : line;
	// 		const value = firstSpace > -1 ? line.slice(firstSpace + 1) : '';

	// 		if (arg === 'name') {
	// 			const name = sanitizeName(value);
	// 			if (!name) return channel.send('`name` is not valid.');
	// 			filter.$or = [{ $text: { $search: '"' + name + '"' } }, { name }];
	// 		}
	// 		else if (arg === 'type') {
	// 			const type = value.trim().toLowerCase();
	// 			if (isWeapon && !(type in { 'key':1, 'axe':1, 'sword':1, 'mace':1, 'dagger':1, 'staff':1, 'wand':1, 'scythe':1 })) return channel.send('`type` is invalid.');
	// 			else if (!(type in { 'cape':1, 'belt':1, 'necklace':1, 'helm':1, 'trinket':1, 'bracer':1 })) return channel.send('`type` is invalid.');
	// 			filter.type = type;
	// 		}
	// 		else if (arg === 'tags') {
	// 			const tags = value.split(',').map(t => t.trim().toLowerCase());
	// 			filter.tags = { $all: tags };
	// 		}
	// 		else if (arg === 'element') {
	// 			if (!isWeapon) return channel.send('Invalid argument "element"');
	// 			const elements = value.split(',').map(t => t.toLowerCase().trim());
	// 			filter.elements = { $all: elements };
	// 		}
	// 		else return channel.send(`Invalid argument "${arg}"`);
	// 	}
	// 	const db = await connect();
	// 	const items = await db.collection(category);

	// 	const pipeline = [
	// 		{ $match: filter },
	// 		{ $group: { _id: { link: '$name', level: '$level' }, doc: { $first: '$$ROOT' } } },
	// 		{ $replaceRoot: { newRoot: '$doc' } },
	// 		{ $sort: sortBy }, { $limit : 15 },
	// 	];
	// 	const results = items.aggregate(pipeline);

	// 	const message = [];
	// 	let item = null;
	// 	while ((item = (await results.next())) !== null) 
	// 		message.push(`**${item.title}:** ${item.link} *(lv. ${item.level})*`);

	// 	channel.send(message.join('\n') || 'No results were found.');
	// }
};
