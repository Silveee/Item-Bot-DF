'use strict';

const format = require('util').format;
const MongoClient = require('mongodb').MongoClient;

const connection = MongoClient.connect(
	format(
		'mongodb://%s:%s@%s:%s/?authMechanism=%s&authSource=%s',
		process.env.DB_USER, process.env.DB_PASS, process.env.DB_HOST, process.env.DB_PORT,
		process.env.DB_AUTH_MECHANISM, process.env.DB_NAME,
	),
	{
		useUnifiedTopology: true,
		useNewUrlParser: true
	}
);

module.exports = async () => {
	const client = await connection;
	return client.db(process.env.DB_NAME);
};