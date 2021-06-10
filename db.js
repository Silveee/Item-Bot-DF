'use strict';

const format = require('util').format;
const MongoClient = require('mongodb').MongoClient;

module.exports = MongoClient.connect(
	format(
		'mongodb://%s:%s@%s:%s/?authMechanism=%s&authSource=%s',
		process.env.DB_USER, process.env.DB_PASS, process.env.DB_HOST, process.env.DB_PORT,
		process.env.DB_AUTH_MECHANISM, process.env.DB_NAME,
	),
	{
		useUnifiedTopology: true,
		useNewUrlParser: true
	}
).then(client => client.db(process.env.DB_NAME));

/*const sqlite = require('sqlite3').verbose();
const db = sqlite.Database('./weapons.db');

db.serialize(() => {
	db.run(
		`CREATE TABLE IF NOT EXISTS Special (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type VARCHAR(20) NOT NULL CHECK(type IN ('on-hit', 'on-attack', 'element-switching', 'auto-trigger')),
			name VARCHAR(20),
			activation VARCHAR(1000),
			effect VARCHAR(1000),
			element VARCHAR(150),
			damage_type VARCHAR(20),
			rate INTEGER NOT NULL CHECK(rate BETWEEN 0 AND 100)
		)`
	);
	db.run(
		`CREATE TABLE IF NOT EXISTS Special (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type VARCHAR(20) NOT NULL CHECK(type IN ('on-hit', 'on-attack', 'element-switching', 'auto-trigger')),
			name VARCHAR(20),
			activation VARCHAR(1000),
			effect VARCHAR(1000),
			element VARCHAR(150),
			damage_type VARCHAR(20),
			rate INTEGER NOT NULL CHECK(rate BETWEEN 0 AND 100)
		)`
	);
	db.run(
		`CREATE TABLE IF NOT EXISTS Special (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type VARCHAR(20) NOT NULL CHECK(type IN ('on-hit', 'on-attack', 'element-switching', 'auto-trigger')),
			name VARCHAR(20),
			activation VARCHAR(1000),
			effect VARCHAR(1000),
			element VARCHAR(150),
			damage_type VARCHAR(20),
			rate INTEGER NOT NULL CHECK(rate BETWEEN 0 AND 100)
		)`
	)
	db.run(`CREATE TABLE IF NOT EXISTS Weapon (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name VARCHAR(100) NOT NULL,
		
		special 
	`
});
*/