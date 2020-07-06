" use strict ";

//Import libraries
var http = require('http');
var path = require('path');
var socketio = require('socket.io');
var express = require('express');
var fs = require('fs');

//The app, server and socket variables
var app = express();
var server = http.createServer(app);
var io = socketio.listen(server);

//Set the main client based page in the client folder (where the index.html is)
//This is where the page which is shown to the client is stored
app.use(express.static(path.resolve(__dirname, 'client')));

//Host the page
// server.listen(process.env.PORT || 5000, function () {
server.listen(process.env.OPENSHIFT_NODEJS_PORT || 8080, function () {
	var addr = server.address();
	console.log("Server listening at", addr.address + ":" + addr.port);
});

let decks = null;

const filename = 'decks/decks.json';

fs.readFile(filename, (err, data) => {
	if (err) {
		console.log('---SERVER NOT STARTED!\nError reading decks file.');
		console.log("File reading Error: " + err);
		throw err;
	}
	decks = JSON.parse(data);
	startServer();
});

console.log('starting server...\n');


const FIGHT_TIME = 30;
const CHOOSE_TIME = 60;
const ROUND_END_TIME = 7000;
const NEXT_GAME_TIME = 60;

class Card {
	constructor(key, text, isChar, actions) {
		this.key = key;
		this.text = text ? text : "_no_text_";
		this.isChar = isChar ? isChar : false;
		//this.actions = (actions && actions.length > 0) ? actions : null;
		this.actions = actions;
		this.isActionCard = (actions && ObjectSize(actions) > 0) ? true : false;
	}

	getData() {
		return {
			key: this.key,
			text: this.text,
			isChar: this.isChar,
			actions: this.actions,
			isActionCard: this.isActionCard
		};
	}

	getActionsAsString() {
		var stringAction = [];

		for (var key in this.actions) {
			if (this.actions.hasOwnProperty(key) && this.actions[key] == true) stringAction.push(key);
		}
		return stringAction;
	}
}

class User {
	constructor(socket, username) {
		this.socket = socket;
		this.username = username;
		this.winCount = 0;
		this.charCards = [];
		this.attrCards = [];
		this.fighterCards = [];
		this.extraFighterCards = [];
		this.room = null;
		this.isBusy = false;
		this.isChoosing = true;
		this.hasVoted = false;
	}

	getData() {
		const charCardsList = this.charCards.map(card => card.getData());
		const attrCardsList = this.attrCards.map(card => card.getData());
		const fighterCardsList = this.fighterCards.map(card => card.getData()).concat(this.extraFighterCards.map(card => card.getData()));
		//const isFighter = ((this.room.players[this.room.fighters[0]] == this) ||  (this.room.players[this.room.fighters[1]] == this)) ? true : false;

		return {
			socketID: this.socket.id,
			username: this.username,
			winCount: this.winCount,
			charCards: charCardsList,
			attrCards: attrCardsList,
			fighterCards: fighterCardsList,
			isChoosing: this.isChoosing,
			hasVoted: this.hasVoted,
			//isFighter: isFighter
		};
	}

	addWin() {
		this.winCount++;
	}

	resetWins() {
		this.winCount = 0;
	}

	setFighterCards(fighterCards) {
		this.fighterCards = fighterCards;
	}

	addFighterCards(fighterCards) {
		this.fighterCards = this.fighterCards.concat(fighterCards);
	}

	setExtraFighterCards(fighterCards) {
		this.extraFighterCards = fighterCards;
	}

	addFighterCards_nonDestructive(fighterCards) {
		this.extraFighterCards = this.extraFighterCards.concat(fighterCards);
	}

	setCharCards(charCards) {
		this.charCards = charCards;
	}

	setAttrCards(attrCards) {
		this.attrCards = attrCards;
	}

	pickCharCard(chosenCard, newCard) {
		this.charCards.some((card, index) => {
			if(card == chosenCard) {
				this.charCards.splice(index, 1, newCard);
				return true;
			}
			return false;
		});
	}

	pickAttrCard(chosenCard, newCard) {
		this.attrCards.some((card, index) => {
			if(card == chosenCard) {
				this.attrCards.splice(index, 1, newCard);
				return true;
			}
			return false;
		});
	}

	pickCharCardByPos(chosenCardPos, newCard) {
		if(chosenCardPos >= 0 && chosenCardPos < this.charCards.length) {
			let pickedCard = this.charCards[chosenCardPos];
			this.charCards.splice(chosenCardPos, 1, newCard);
			return pickedCard;
		}
		return null;
	}

	pickAttrCardByPos(chosenCardPos, newCard) {
		if(chosenCardPos >= 0 && chosenCardPos < this.attrCards.length) {
			let pickedCard = this.attrCards[chosenCardPos];
			this.attrCards.splice(chosenCardPos, 1, newCard);
			return pickedCard;
		}
		return null;
	}
}

class Room {
	constructor(roomName, firstPlayer, maxPlayers, maxRound, isPrivate) {
		this.roomName = roomName;
		this.maxPlayers = maxPlayers;
		this.maxRound = maxRound;
		this.isPrivate = isPrivate;
		this.players = [firstPlayer];
		this.fighters = [0, null];
		this.nextFighter = 1;
		this.fullDeck = null;
		this.charDeck = null;
		this.attrDeck = null;
		this.roundCount = 1;
		this.lastWinner = null;
		this.roundVotes = [];
		this.isChoosing = true;
		this.fightTimer = FIGHT_TIME;
		this.isFighting = true;
		this.chooseTimer = CHOOSE_TIME;
		this.fightInterval = null;
		this.chooseInterval = null;
		this.nextGameTimer = NEXT_GAME_TIME;
		this.nextGameInterval = null;
		this.isEndingRound = false;
		this.lastCardKey = 0;
		this.isBusy = false;
		this.countAnon = 0;
		this.gameCount = 0;
	}

	getData() {
		var playerList = this.players.map(function (player) {
			var playerData = player.getData();
			return {
				socketID: playerData.socketID,
				username: playerData.username,
				winCount: playerData.winCount,
				fighterCards: playerData.fighterCards,
				isChoosing: playerData.isChoosing,
				hasVoted: playerData.hasVoted
			};
		});
		return {
			roomName: this.roomName,
			maxPlayers: this.maxPlayers,
			isPrivate: this.isPrivate,
			players: playerList,
			fighters: this.fighters,
			nextFighter: this.getNextFighter(),
			roundCount: this.roundCount,
			maxRound: this.maxRound,
			isChoosing: this.isChoosing,
			isFighting: this.isFighting,
			isEndingRound: this.isEndingRound,
			//fightTimer: this.fightTimer,
			//chooseTimer: this.chooseTimer
		};
	}

	resetGame() {
		if(this.players.length < 2) {
			this.fighters = [0, null];
			this.nextFighter = 1;
		} else {
			this.fighters = [0, 1];
			this.nextFighter = 2;
		}
		this.roundCount = 1;
		this.lastWinner = null;
		this.roundVotes = [];
		this.isChoosing = true;
		this.fightTimer = FIGHT_TIME;
		this.isFighting = true;
		this.chooseTimer = CHOOSE_TIME;
		this.fightInterval = null;
		this.chooseInterval = null;
		// this.nextGameTimer = NEXT_GAME_TIME;
		// this.nextGameInterval = null;
		this.isEndingRound = false;

		this.players.forEach((player, i) => {
			player.winCount = 0;
			player.charCards = this.pickCharCards(3);
			player.attrCards = this.pickAttrCards(3);
			player.fighterCards = [];
			player.extraFighterCards = [];
			player.isChoosing = true;
			player.hasVoted = false;
		});

		this.gameCount++;
	}

	startFightTimer(func = null) {
		console.log("Starting fight timer");
		this.fightInterval = setInterval((function() {
			this.fightTimer--;
			console.log(this.roomName + " fightTimer: " + this.fightTimer);
			if(func != null) func(this.fightTimer);

			if(this.fightTimer <= 0) {
				this.fightTimer = FIGHT_TIME;
				clearInterval(this.fightInterval);
				this.fightInterval = null;
			}
		}).bind(this), 1000);
	}

	stopFightTimer() {
		console.log("stoping fight timer");
		if(this.fightInterval != null) {
			this.fightTimer = FIGHT_TIME;
			clearInterval(this.fightInterval);
			this.fightInterval = null;
			return true;
		}
		return false;
	}

	startChooseTimer(func = null) {
		console.log("Starting choose timer");
		this.chooseInterval = setInterval((function() {
			this.chooseTimer--;
			//console.log(this.roomName + " chooseTimer: " + this.chooseTimer);
			if(func != null) func(this.chooseTimer);

			if(!this.isChoosing || this.chooseTimer <= 0) {
				this.chooseTimer = CHOOSE_TIME;
				clearInterval(this.chooseInterval);
				this.chooseInterval = null;
			}
		}).bind(this), 1000);
	}

	stopChooseTimer() {
		console.log("stoping choose timer");
		if(this.chooseInterval != null) {
			this.chooseTimer = CHOOSE_TIME;
			clearInterval(this.chooseInterval);
			this.chooseInterval = null;
			return true;
		}
		return false;
	}

	startNextGameTimer(func = null) {
		console.log("Starting next game timer");
		this.nextGameInterval = setInterval((function() {
			this.nextGameTimer--;
			//console.log(this.roomName + " chooseTimer: " + this.chooseTimer);
			if(func != null) func(this.nextGameTimer);

			if(this.nextGameTimer <= 0) {
				this.nextGameTimer = NEXT_GAME_TIME;
				clearInterval(this.nextGameInterval);
				this.nextGameInterval = null;
			}
		}).bind(this), 1000);
	}

	stopNextGameTimer() {
		console.log("stoping next game timer");
		if(this.nextGameInterval != null) {
			this.nextGameTimer = CHOOSE_TIME;
			clearInterval(this.nextGameInterval);
			this.nextGameInterval = null;
			return true;
		}
		return false;
	}

	endRound(winnerFighterNum) {
		// this.stopFightTimer();
		const loserFighter = (winnerFighterNum == 0) ? 1 : 0;
		const loser = this.players[this.fighters[loserFighter]];
		if(loser) {
			loser.setFighterCards([]);
			loser.setExtraFighterCards([]);
		}
		this.roundVotes = [];
		this.roundCount++;
		this.players.forEach((player, i) => {
			player.hasVoted = false;
			if(this.fighters[winnerFighterNum] != i) {
				player.isChoosing = true;
				//player.setFighterCards([]);
				//player.setExtraFighterCards([]);
			} else player.isChoosing = false; // just to make sure
		});
		const winner =	this.players[this.fighters[winnerFighterNum]];
		winner.setExtraFighterCards([]);
		winner.addWin();
		this.lastWinner = winner; // getData() ?
	}

	resetVotes() {
		this.roundVotes = [];
		this.players.forEach((player) => {
			player.hasVoted = false;
		});
	}

	setIsChoosing(isChoosing) {
		if((this.fighters[0] != null ? (this.players[this.fighters[0]] ? (!this.players[this.fighters[0]].isChoosing) : false) : false) && (this.fighters[1] != null ? (this.players[this.fighters[1]] ? !this.players[this.fighters[1]].isChoosing : false) : false)) {
			this.isChoosing = isChoosing;
		} else {
			this.isChoosing = true;
		}
		console.log(this.roomName + " is choosing: " + this.isChoosing);
		return this.isChoosing;
	}

	setDeck(deck) {
		this.fullDeck = deck;
		//populate decks
		this.charDeck = shuffle(this.fullDeck.characters).map((function(card) {
			const newCard = new Card(this.lastCardKey, card.text, true, null);
			this.lastCardKey++;
			return newCard;
		}).bind(this));
		this.attrDeck = shuffle(this.fullDeck.attributes).map((function(card) {
			if(card.actions && card.actions.disposable) card.actions.key = this.lastCardKey;
			// card.actions = { drawHandChar: true, "keep": true };
			const newCard = new Card(this.lastCardKey, card.text, false, card.actions);
			this.lastCardKey++;
			return newCard;
		}).bind(this));
		console.log("total counted cards: ", this.lastCardKey);
	}

	pickCharCards(amount) {
		if(amount > 0 && amount <= this.charDeck.length) {
			return this.charDeck.splice(0, amount);
		} else {
			amount = amount - this.charDeck.length;
			const chosenCards = this.charDeck;
			this.charDeck = shuffle(this.fullDeck.characters).map(function(card) {
				return new Card(card.text, true, null);
			});
			return chosenCards.concat(this.charDeck.splice(0, amount));
		}
	}

	pickAttrCards(amount) {
		if(amount > 0 && amount <= this.attrDeck.length) {
			return this.attrDeck.splice(0, amount);
		} else {
			amount = amount - this.attrDeck.length;
			const chosenCards = this.attrDeck;
			this.attrDeck = shuffle(this.fullDeck.attributes).map(function(card) {
				return new Card(card.text, false, card.actions);
			});
			return chosenCards.concat(this.attrDeck.splice(0, amount));
		}
	}

	addPlayers(players) {
		const addPos = this.players.length;
		this.players = this.players.concat(players);
		if(this.fighters[1] == null) this.fighters[1] = addPos;
		if(this.players.length == 2) this.nextFighter = 2;
		return addPos;
	}

	removePlayer(chosenPlayer) {
		let playerPos = -1;
		this.players.some((player, index) => {
			if(player == chosenPlayer) {
				this.players.splice(index, 1);
				playerPos = index;
				return true;
			}
			return false;
		});

		if(playerPos >= 0) {
			if(this.players.length == 1) {
				const fighter = this.fighters[0] == playerPos ? 0 : (this.fighters[1] == playerPos ? 1 : null);
				this.fighters[0] = 0;
				this.fighters[1] = null;
				this.stopChooseTimer();
				this.stopFightTimer();
				// this.setIsChoosing(true);
				this.setNextFighter();
				return [playerPos, fighter];
			} else if(this.players.length > 1) {
				if(this.nextFighter > playerPos) this.nextFighter--;
				if(this.fighters[0] == playerPos) {
					// player was fighter 1
					if (this.stopChooseTimer() || this.isEndingRound) this.setIsChoosing(true);
					this.stopFightTimer();
					//this.setIsChoosing(true);
					//this.fighters[0] = this.getNextFighter();
					if(this.fighters[1] > playerPos) this.fighters[1]--;
					this.setNextFighter(0);
					//this.endRound(1);
					return [playerPos, 0];
				} else if(this.fighters[1] == playerPos) {
					// player was fighter 2
					if (this.stopChooseTimer() || this.isEndingRound) this.setIsChoosing(true);
					this.stopFightTimer();
					//this.setIsChoosing(true);
					if(this.fighters[0] > playerPos) this.fighters[0]--;
					this.setNextFighter(1); // debug
					//this.endRound(0);
					return [playerPos, 1];
				} else {
					if(this.fighters[0] > playerPos) this.fighters[0]--;
					if(this.fighters[1] > playerPos) this.fighters[1]--;
					return [playerPos, null];
				}
			}
		}
		return [null, null];
	}

	setNextFighter(fighterNum = null) {
		if(this.players.length == 1) {
			this.nextFighter = 1;
		} else if(this.players.length == 2) {
			// do not change
			if(this.nextFighter < 2) {
				console.log("2 players - nextFighter: " + this.nextFighter);
				this.fighters[fighterNum] = this.nextFighter; // debug
			}
			this.nextFighter = 2;
		} else if(this.players.length > 2) {
			if(fighterNum != null) {
				this.nextFighter = this.getNextFighter();
				this.fighters[fighterNum] = this.nextFighter;
				this.nextFighter++;
			}
			if(this.nextFighter == this.fighters[0] || this.nextFighter == this.fighters[1]) { // probably useless
				this.nextFighter++;
			}
		} else {
			return null;
		}
		return (fighterNum != null) ? this.fighters[fighterNum] : null;
	}

	getNextFighter() {
		let nextFighter = this.nextFighter;
		if(this.players.length == 1) {
			nextFighter = 1;
		} else if(this.players.length == 2){
			// do not change
			nextFighter = 2;
		} else if(this.players.length > 2){
			if(nextFighter > (this.players.length - 1)) {
				if(this.fighters[0] === 0 || this.fighters[1] === 0) {
					if(this.fighters[0] === 1 || this.fighters[1] === 1) {
						nextFighter = 2;
					} else {
						nextFighter = 1;
					}
				} else {
					nextFighter = 0;
				}
			} else {
				// if(nextFighter == this.fighters[0] || nextFighter == this.fighters[1]) { // probably useless
				// 	nextFighter++;
				// }
			}
		} else {
			return null;
		}
		return nextFighter;
	}

	getCountAnon() {
		return this.countAnon++;
	}

	getFighterPos(player) {
		let fighterPos = null, fighterNum = null;
		if(this.players[this.fighters[0]] == player) {
			fighterPos = this.fighters[0];
			fighterNum = 0;
		} else if(this.players[this.fighters[1]] == player) {
			fighterPos = this.fighters[1];
			fighterNum = 1;
		}
		return [fighterNum, fighterPos];
	}

	checkIsFighter(player) {
		let isFighter = false;
		if(this.players[this.fighters[0]] == player || this.players[this.fighters[1]] == player) isFighter = true;
		return isFighter;
	}

	setFighters(fighter1Pos, fighter2Pos) {
		if(fighter1Pos < this.players.length && fighter2Pos < this.players.length) {
			this.fighters = [fighter1, fighter2];
			return true;
		}
		return false;
	}

	setSingleFighter(fighterNum, fighterPos) {
		if(fighterPos < this.players.length) {
			if(fighterNum <= 1) this.fighters[0] = fighterPos;
			else this.fighters[1] = fighterPos;
			return true;
		}
		return false;
	}
}

const users = [];
const rooms = [];

function startServer() {
	console.log('---SERVER STARTED---\n');
	console.log('Number of decks read: ' + decks.length);
	console.log('\n----------\n\nConnection log:\n');
	//Main events and listener
	io.on('connection', function (socket) {
		console.log("User connected. Socket ID: " + socket.id);

		let thisUser = null;
		let thisRoom = null;

		socket.on("joinRoom", function (username, roomName) {
			console.log("joinRoom");
			//username = username.replace(/[^a-zA-Z0-9_\-()¬&$@#£!?%|'"°ª.,<>=+*çáàâãäéèêëíìîïóòôõöúùûüÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜ ]/g, "").trim();
			let isAnon = false;
			username = username.trim();
			if(username.length === 0) [username, isAnon] = ['Anonymous ', true];
			if(username.length > 25) username = username.slice(0,25);
			roomName = roomName.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
			if(roomName.length > 25) roomName = roomName.slice(0,25);

			const newUser = new User(socket, username);

			let gameRoom, isValidRoom;
			if(roomName.length === 0) {
				gameRoom = joinRandomRoom(newUser);
				gameRoom.setDeck(decks[0]);
				isValidRoom = true;
			} else {
				[isValidRoom, gameRoom] = joinExistingRoom(newUser, roomName);
			}

			if(isValidRoom) {
				users.push(newUser);
				thisUser = newUser;
				thisRoom = gameRoom;

				if(isAnon) newUser.username = newUser.username + gameRoom.getCountAnon();

				newUser.setCharCards(gameRoom.pickCharCards(3));
				newUser.setAttrCards(gameRoom.pickAttrCards(3));

				socket.room = gameRoom.roomName;
				socket.join(socket.room);
				console.log("'" + newUser.username + "' entered room '" + socket.room + "'. Users count: " + users.length + " | Rooms count: " + rooms.length);

				const isFighterNum = gameRoom.getFighterPos(newUser)[0];

				if(isFighterNum != null && gameRoom.players.length > 1 && gameRoom.isChoosing && gameRoom.chooseTimer >= CHOOSE_TIME) {
					thisRoom.startChooseTimer(chooseTimerFunction);
				}

				const playerData = newUser.getData();
				const gameData = gameRoom.getData();

				socket.emit("startGame", playerData, gameData, gameRoom.checkIsFighter(newUser), gameRoom.gameCount);
				socket.broadcast.to(gameRoom.roomName).emit("setGame", gameData);
				console.log("Player e Game enviados");
			}
		});


		socket.on("createRoom", function (username, roomName, maxRound, maxPlayers, isPrivate) {
			console.log("createRoom");
			console.log("Creating room with: username: " + username + " | roomName: " + roomName + " | maxRound: " + maxRound + " | maxPlayers: " + maxPlayers + " | isPrivate: " + isPrivate);

			if(roomName.length < 5) {
				console.log("Error: Room name too short");
				socket.emit("setLoginError", "Room name too short");

			} else if(!validateRoomName(roomName)) {
				console.log("Error: This room name is already been used");
				socket.emit("setLoginError", "This room name is already been used");

			} else {
				//username = username.replace(/[^a-zA-Z0-9_\-()¬&$@#£!?%|'"°ª.,<>=+*çáàâãäéèêëíìîïóòôõöúùûüÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜ ]/g, "").trim();
				let isAnon = false;
				username = username.trim();
				if(username.length === 0) [username, isAnon] = ['Anonymous ', true];
				if(username.length > 25) username = username.slice(0,25);
				roomName = roomName.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
				if(roomName.length > 25) roomName = roomName.slice(0,25);

				if(maxRound > (10 * maxPlayers - 1)) maxRound = 10 * maxPlayers - 1;
				if(maxRound < maxPlayers - 1) maxRound = maxPlayers - 1;

				const newUser = new User(socket, username);

				console.log("Creating room with: username: " + username + " | roomName: " + roomName + " | maxRound: " + maxRound + " | maxPlayers: " + maxPlayers + " | isPrivate: " + isPrivate);
				const gameRoom = new Room(roomName, newUser, maxPlayers, maxRound, isPrivate);

				console.log("Created room: ", gameRoom);
				gameRoom.setDeck(decks[0]);

				rooms.push(gameRoom);
				users.push(newUser);

				thisUser = newUser;
				thisRoom = gameRoom;

				if(isAnon) newUser.username = newUser.username + gameRoom.getCountAnon();

				newUser.setCharCards(gameRoom.pickCharCards(3));
				newUser.setAttrCards(gameRoom.pickAttrCards(3));

				socket.room = gameRoom.roomName;
				socket.join(socket.room);
				console.log("'" + newUser.username + "' created room '" + socket.room + "'. Users count: " + users.length + " | Rooms count: " + rooms.length);

				const playerData = newUser.getData();
				const gameData = gameRoom.getData();

				socket.emit("startGame", playerData, gameData, gameRoom.checkIsFighter(newUser), gameRoom.gameCount);
				socket.broadcast.to(gameRoom.roomName).emit("setGame", gameData);
				console.log("Player e Game enviados");
			}
		});



		socket.on("getFullDeck", function () {
			console.log("getFullDeck");
			decks ? console.log('Número de decks lidos: ' + decks.length) : console.log("não lido ainda");
			socket.emit("setDeck", decks[0]);
			console.log("Deck enviado");
		});

		socket.on("chooseCards", function (selectedCharCardPos, selectedAttrCardPos) {
			console.log("chooseCards");
			while(thisRoom.isBusy || thisUser.isBusy){	// wait till room & player aren't been used
				console.log("is busy");
			}
			thisRoom.isBusy = true;
			thisUser.isBusy = true;

			const [newCharCard] = thisRoom.pickCharCards(1);
			const [newAttrCard, randomAttrCard] = thisRoom.pickAttrCards(2);

			console.log(thisUser.username + "'s cards:");
			console.log(thisUser.charCards.map((card) => card.text));
			console.log(thisUser.attrCards.map((card) => card.text));

			const charCard = thisUser.pickCharCardByPos(selectedCharCardPos, newCharCard);
			const attrCard = thisUser.pickAttrCardByPos(selectedAttrCardPos, newAttrCard);


			console.log(thisUser.username + "'s picked(" + selectedCharCardPos + ", "+ selectedAttrCardPos + ") cards:");
			console.log([charCard, attrCard, randomAttrCard].map((card) => card.text));

			thisUser.setFighterCards([charCard, attrCard, randomAttrCard]);
			thisUser.isChoosing = false;
			//thisRoom.setIsChoosing(false);
			if(!thisRoom.setIsChoosing(false)) {
				thisRoom.startFightTimer(fightTimerFunction);
			}

			thisRoomData = thisRoom.getData();

			console.log("\n" + thisUser.username + "'s fighter cards:");
			console.log(thisUser.fighterCards.map((card) => card.text));

			console.log("sending this game:");
			console.log(thisRoomData);

			//socket.emit("setGame", thisRoomData);
			const playerIsFighter = thisRoom.checkIsFighter(thisUser);
			socket.emit("setPlayer", thisUser.getData(), playerIsFighter);
			socket.emit("setGame", thisRoomData, null, "setting game with isChoosing " + thisRoomData.isChoosing);
			socket.broadcast.to(thisRoom.roomName).emit("setGame", thisRoomData, null, "setting game with isChoosing " + thisRoomData.isChoosing);
			console.log("Player sent to '" + thisUser.username + "' and Game sent to everyone");

			thisRoom.isBusy = false;
			thisUser.isBusy = false;
		});

		socket.on("votePlayer", votePlayer);

		function votePlayer(vote) {
			const isDisconnected = socket.disconnected;
			let auxGameData = null;
			let winnerPlayer = null;

			if(!isDisconnected) {
				console.log(thisUser.username + " voted in fighter " + vote);
				thisRoom.roundVotes.push(vote);
				thisUser.hasVoted = true;
				auxGameData = thisRoom.getData();
			}

			auxGameData = thisRoom.getData();

			let fighter1Votes = 0;
			let fighter2Votes = 0;
			const halfPlayers = Math.floor(thisRoom.players.length/2);

			thisRoom.roundVotes.forEach(function (vote) {
				if (vote == 0) fighter1Votes++;
				else fighter2Votes++;
			});

			if(fighter1Votes > halfPlayers) {
				//player 1 wins
				console.log("Fighter 1 won");
				winnerPlayer = thisRoom.players[thisRoom.fighters[0]].getData();
				thisRoom.endRound(0);
				thisRoom.isEndingRound = true;

				if(!isDisconnected) socket.emit("informWinner", 0, auxGameData);
				socket.broadcast.to(socket.room).emit("informWinner", 0, auxGameData);
				setTimeout(() => {
					thisRoom.setNextFighter(1);
					thisRoom.setIsChoosing(true);
					thisRoom.isEndingRound = false;
					thisRoom.isFighting = true;
					const gameData = thisRoom.getData();
					if(thisRoom.roundCount <= thisRoom.maxRound) {
						if(!isDisconnected) socket.emit("startNewRound", gameData);
						socket.broadcast.to(socket.room).emit("startNewRound", gameData);

						if(thisRoom.players.length > 1 && thisRoom.isChoosing && thisRoom.chooseTimer >= CHOOSE_TIME) {
							thisRoom.startChooseTimer(chooseTimerFunction);
						}
					} else {
						if(!isDisconnected) socket.emit("endGame", winnerPlayer, gameData);
						socket.broadcast.to(socket.room).emit("endGame", winnerPlayer, gameData);

						thisRoom.startNextGameTimer(nextGameFunction);
					}

				}, ROUND_END_TIME);

			} else if(fighter2Votes > halfPlayers) {
				//player 2 wins
				console.log("Fighter 2 won");
				winnerPlayer = thisRoom.players[thisRoom.fighters[1]].getData();
				thisRoom.endRound(1);
				thisRoom.isEndingRound = true;

				if(!isDisconnected) socket.emit("informWinner", 1, auxGameData);
				socket.broadcast.to(socket.room).emit("informWinner", 1, auxGameData);
				setTimeout(() => {
					thisRoom.setNextFighter(0);
					thisRoom.setIsChoosing(true);
					thisRoom.isEndingRound = false;
					thisRoom.isFighting = true;
					const gameData = thisRoom.getData();
					if(thisRoom.roundCount <= thisRoom.maxRound) {
						if(!isDisconnected) socket.emit("startNewRound", gameData);
						socket.broadcast.to(socket.room).emit("startNewRound", gameData);

						if(thisRoom.players.length > 1 && thisRoom.isChoosing && thisRoom.chooseTimer >= CHOOSE_TIME) {
							thisRoom.startChooseTimer(chooseTimerFunction);
						}
					} else {
						if(!isDisconnected) socket.emit("endGame", winnerPlayer, gameData);
						socket.broadcast.to(socket.room).emit("endGame", winnerPlayer, gameData);

						thisRoom.startNextGameTimer(nextGameFunction);
					}

				}, ROUND_END_TIME);
			} else if(thisRoom.roundVotes.length >= thisRoom.players.length) {
				//draw
				console.log("Starting draw round");
				if(!isDisconnected) thisUser.hasVoted = false;
				thisRoom.isFighting = true;
				thisRoom.resetVotes();
				const fighter1 = thisRoom.players[thisRoom.fighters[0]];
				const fighter2 = thisRoom.players[thisRoom.fighters[1]];
				if(fighter1) {
					fighter1.setFighterCards(thisRoom.pickCharCards(1));
					fighter1.extraFighterCards = [];
				}
				if(fighter2) {
					fighter2.setFighterCards(thisRoom.pickCharCards(1));
					fighter2.extraFighterCards = [];
				}
				//socket.emit("setPlayers", thisUser.getData());
				const gameData = thisRoom.getData();
				if(!isDisconnected) socket.emit("startDrawRound", gameData);
				socket.broadcast.to(socket.room).emit("startDrawRound", gameData);
				thisRoom.startFightTimer(fightTimerFunction);
			} else {
				const gameData = thisRoom.getData();
				if(!isDisconnected) socket.emit("setGame", gameData);
				socket.broadcast.to(socket.room).emit("setGame", gameData);
			}
		}

		socket.on("runActions", function (actions) {
			console.log("runActions");
			console.log(actions);

			console.log(thisUser.username + " running actions");
			const gameData = runCardActions(actions, thisUser, thisRoom);

			if(gameData.players[gameData.fighters[0]]) console.log("got data. " + gameData.players[gameData.fighters[0]].username + " fighter cards:\n", gameData.players[gameData.fighters[0]].fighterCards);
			if(gameData.players[gameData.fighters[1]]) console.log("got data. " + gameData.players[gameData.fighters[1]].username + " fighter cards:\n", gameData.players[gameData.fighters[1]].fighterCards);

			if(actions.keep || actions.disposable) {
				socket.emit("setPlayer", thisUser.getData());
				console.log("Player enviado");
			}

			socket.emit("setGame", gameData);
			socket.broadcast.to(thisRoom.roomName).emit("setGame", gameData);
			console.log("Game enviado" + (actions.keep ? "" : " (Estado atual do round)"));

			console.log("STORED DATA: \n" + thisRoom.players[thisRoom.fighters[0]].username + " fighter cards:\n", thisRoom.getData().players[thisRoom.fighters[0]].fighterCards);
			console.log(thisRoom.players[thisRoom.fighters[1]].username + " fighter cards:\n", thisRoom.getData().players[thisRoom.fighters[1]].fighterCards);

		});

		//When a user disconnects
		socket.on("disconnect", function () {
			const [user, userPos] = findUser(socket);
			if(user != null) {
				users.splice(userPos, 1);
				const [room, roomPos] = findRoom(socket.room);

				if(room != null) {
					const [playerPos, fighterNum] = thisRoom.removePlayer(user);

					if(thisRoom.players.length >= 1) {
						if(fighterNum != null) {
							const loser = fighterNum;
							const winner = fighterNum == 0 ? 1 : 0;
							const winnerPlayer = thisRoom.players[thisRoom.fighters[winner]] ? thisRoom.players[thisRoom.fighters[winner]].getData() : null;
							//room.players[room.fighters[fighterNum]].socket.emit("setIsFighter", true);
							//room.startChooseTimer(chooseTimerFunction);
							if(!thisRoom.isChoosing && !thisRoom.isEndingRound) {
								console.log("Fighter " + winner + " won by W.O.");
								thisRoom.endRound(thisRoom.players.length == 1 ? 0 : winner);
								thisRoom.isEndingRound = true;

								socket.broadcast.to(socket.room).emit("informWinner", winner);
								setTimeout(() => {
									//thisRoom.setNextFighter(loser);
									thisRoom.setIsChoosing(true);
									thisRoom.isEndingRound = false;
									thisRoom.isFighting = true;
									const gameData = thisRoom.getData();
									if(thisRoom.roundCount <= thisRoom.maxRound) {
										socket.broadcast.to(socket.room).emit("startNewRound", gameData);

										if(thisRoom.players.length > 1 && thisRoom.isChoosing && thisRoom.chooseTimer >= CHOOSE_TIME) {
											thisRoom.startChooseTimer(chooseTimerFunction);
										}
									} else {
										socket.broadcast.to(socket.room).emit("endGame", winnerPlayer, gameData);

										thisRoom.startNextGameTimer(nextGameFunction);
									}
								}, ROUND_END_TIME);

							}
						} else {
							console.log(thisUser.username + " is disconnected: " + socket.disconnected);
							console.log("calculating votes");
							votePlayer(null);
						}
					}
					if(room.players.length <= 0) {
						rooms.splice(roomPos, 1);
					}
					console.log("enviando userDisconnected...");
					socket.broadcast.to(room.roomName).emit("setGame", room.getData());
					console.log("Game sent to players");
				}
				console.log("User '" + user.username + (room != null ? "'(on '" + room.roomName + "')" : "'") + " disconnected. Users count: " + users.length + (room != null ? " | Rooms count: " + rooms.length : ""));
			} else {
				console.log("User disconnect");
			}
		});

		function chooseTimerFunction(chooseTimer) {
			//console.log(gameRoom.roomName + "'s time to choose: " + chooseTimer);
			socket.emit("setChooseTimer", thisRoom.chooseTimer);
			socket.broadcast.to(thisRoom.roomName).emit("setChooseTimer", thisRoom.chooseTimer);

			if(chooseTimer <= 0) {
				console.log("Time up. Will auto choose cards");
				const fighter1 = thisRoom.players[thisRoom.fighters[0]];
				const fighter2 = thisRoom.players[thisRoom.fighters[1]];

				if(fighter1.isChoosing) {
					console.log("sending getSelectedCards to " + fighter1.username);
					fighter1.socket.emit("getSelectedCards");
				}
				if(fighter2.isChoosing) {
					console.log("sending getSelectedCards to " + fighter2.username);
					fighter2.socket.emit("getSelectedCards");
				}
			}
		}

		function fightTimerFunction(fightTimer) {
			//console.log(gameRoom.roomName + "'s time to choose: " + chooseTimer);
			if(!socket.disconnected) socket.emit("setFightTimer", thisRoom.fightTimer);
			socket.broadcast.to(thisRoom.roomName).emit("setFightTimer", thisRoom.fightTimer);

			if(fightTimer <= 0) {
				console.log("Fight time up. Players can vote");
				thisRoom.isFighting = false;
				const gameData = thisRoom.getData();
				if(!socket.disconnected) socket.emit("fightEnded", gameData);
				socket.broadcast.to(thisRoom.roomName).emit("fightEnded", gameData);
			}
		}

		function nextGameFunction(nextGameTimer) {
			//console.log(gameRoom.roomName + "'s time to choose: " + chooseTimer);
			if(!socket.disconnected) socket.emit("setNextGameTimer", thisRoom.nextGameTimer);
			socket.broadcast.to(thisRoom.roomName).emit("setNextGameTimer", thisRoom.nextGameTimer);

			if(nextGameTimer <= 0) {
				console.log("Starting a new game now.");
				thisRoom.isFighting = false;
				thisRoom.stopFightTimer();
				thisRoom.stopChooseTimer();
				thisRoom.resetGame();
				const isFighterNum = thisRoom.getFighterPos(thisUser)[0];
				if(isFighterNum != null && thisRoom.players.length > 1 && thisRoom.isChoosing && thisRoom.chooseTimer >= CHOOSE_TIME) {
					thisRoom.startChooseTimer(chooseTimerFunction);
				}
				const gameData = thisRoom.getData();
				// const playerData = thisUser.getData();
				// if(!socket.disconnected) socket.emit("startGame", playerData, gameData, thisRoom.checkIsFighter(thisUser), thisRoom.gameCount);
				thisRoom.players.forEach((player) => {
					if(!player.socket.disconnected) player.socket.emit("startGame", player.getData(), gameData, thisRoom.checkIsFighter(player), thisRoom.gameCount); // is there need to check if is connected?
				});

				// socket.broadcast.to(thisRoom.roomName).emit("startGame", playerData, gameData, thisRoom.checkIsFighter(thisUser), thisRoom.gameCount);
			}
		}

	});
}

function joinRandomRoom(player) {
	let chosenRoom = null;

	rooms.some(function(room) {
		if(!room.isPrivate && (room.players.length < room.maxPlayers)) {
			chosenRoom = room;
			console.log("Sala existe");
			return true;
		}
		return false;
	});

	if (chosenRoom == null) {
		console.log("Sala não existe. Criando sala");
		var roomsLength = rooms.length;
		var roomName = 'room' + roomsLength;

		var count = 1;
		while(!validateRoomName(roomName)) {
			roomName = 'room' + (roomsLength + count);
		}
		chosenRoom = new Room(roomName, player, 5, 9, false);
		rooms.push(chosenRoom);

	} else {
		var playerPos = chosenRoom.addPlayers([player]);
	}

	return chosenRoom;
}


function joinExistingRoom(player, roomName) {
	let chosenRoom = null, isValidRoom = false, errorMsg = "Sala '" + roomName + "' não existe";

	rooms.some(function(roomIter) {
		if(roomIter.roomName === roomName) {
			if(roomIter.players.length < roomIter.maxPlayers) {
				chosenRoom = roomIter;
				errorMsg = "";
				console.log("Sala buscada existe");
			} else {
				console.log("Sala '" + roomName + "' está cheia");
				errorMsg = "Sala '" + roomName + "' está cheia";
			}
			return true;
		}
		return false;
	});

	if (chosenRoom === null) {
		console.log("Sala não existe. Enviando mensagem de erro");
		player.socket.emit("setLoginError", errorMsg);

	} else {
		console.log(player.username + " entrando na sala " + chosenRoom.roomName);
		var playerPos = chosenRoom.addPlayers([player]);
		isValidRoom = true;
	}

	return [isValidRoom, chosenRoom];
}

function findRoom(roomName) {
	let roomFound = null;
	let roomFoundPos = -1;

	rooms.some(function(room, i) {
		if(room.roomName == roomName) {
			roomFound = room;
			roomFoundPos = i;
			return true;
		}
		return false;
	});

	return [roomFound, roomFoundPos];
}

function findUser(socket) {
	let userFound = null;
	let userFoundPos = -1;

	users.some(function(user, i) {
		if(user.socket == socket) {
			userFound = user;
			userFoundPos = i;
			return true;
		}
		return false;
	});
	return [userFound, userFoundPos];
}

function validateRoomName(roomName) {
	let isValid = true;

	rooms.some((room) => {
		if(room.roomName == roomName) {
			isValid = false;
			return true;
		}
		return false;
	});

	return isValid;
}

function runCardActions(actions, player, game) {
	console.log("running actions...");
	const keep = actions.keep ? actions.keep : false;
	let randPos;

	if(actions.disposable) {
		//this card will disapear after the round
		console.log("card is disposable (key: " + actions.key + "). Disposing now.");
		const key = actions.key;
		player.fighterCards = player.fighterCards.filter(function(card) {
			return card.actions ? (card.actions.key ? card.actions.key !== key : true) : true;
		});
	}

	if(!keep) {
		console.log("DO NOT KEEP CHANGES");
		// const auxPlayer = { ...player };
		// auxPlayer.socket = null;
		// player = { ...player };
		// player = JSON.parse(JSON.stringify(auxPlayer));

		// const auxGame = { ...game };
		// auxGame.players = auxGame.players.map(function (player) {
		// 	return { ...player };
		// })
		// game = auxGame;
		// game = JSON.parse(JSON.stringify(auxGame));
	} else {
		console.log("KEEP CHANGES");
	}

	if(actions.drawDeckChar) {
		//draw one character from deck
		console.log("draw one character from deck");
		if(keep) player.addFighterCards(game.pickCharCards(1));
		else {
			randPos = Math.floor(Math.random() * game.charDeck.length);
			player.addFighterCards_nonDestructive([game.charDeck[randPos]]);
		}
	}
	if(actions.drawDeckAttr) {
		//draw one attribute from deck
		console.log("draw one attribute from deck");
		if(keep) player.addFighterCards(game.pickAttrCards(1));
		else {
			randPos = Math.floor(Math.random() * game.attrDeck.length);
			player.addFighterCards_nonDestructive([game.attrDeck[randPos]]);
		}
	}
	if(actions.drawHandChar) {
		//draw one character from hand
		console.log("draw one character from hand");
		if(keep) player.addFighterCards([player.pickCharCardByPos(0, game.pickCharCards(1)[0])]);
		else {
			randPos = Math.floor(Math.random() * player.charCards.length);
			player.addFighterCards_nonDestructive([player.pickCharCardByPos(randPos, game.pickCharCards(1)[0])]);
		}
	}
	if(actions.drawHandAttr) {
		//draw one attribute from hand
		console.log("draw one attribute from hand");
		if(keep) player.addFighterCards([player.pickAttrCardByPos(0, game.pickAttrCards(1)[0])]);
		else {
			randPos = Math.floor(Math.random() * player.attrCards.length);
			player.addFighterCards_nonDestructive([player.pickAttrCardByPos(randPos, game.pickAttrCards(1)[0])]);
		}
	}
	if(actions.drawTwoDeckAttr) {
		//draw two attribute from deck
		console.log("draw two attribute from deck");
		if(keep) player.addFighterCards(game.pickAttrCards(2));
		else {
			// randPos = [Math.floor(Math.random() * game.attrDeck.length), Math.floor(Math.random() * game.attrDeck.length)];
			// player.addFighterCards_nonDestructive( [ game.attrDeck[randPos[0]], game.attrDeck[randPos[1]] ] );
			player.addFighterCards_nonDestructive(game.pickAttrCards(2));
		}
	}
	let gameData = game.getData();
	console.log("got game data");

	// if(!keep) player.extraFighterCards = [];

	if(actions.removeAllAttr) {
		//remove all attributes for this round
		console.log("remove all attributes for this round");
		// const auxGameData = game.getData();
		gameData.players = gameData.players.map(function (player) {
			player.fighterCards = player.fighterCards.filter(card => card.isChar);
		});
		// gameData = auxGameData;
	}

	return gameData;
}

//Shuffles an array
function shuffle(array) {
	var counter = array.length;
	var temp;
	var index;
	while (counter > 0) {
		index = Math.floor(Math.random() * counter);
		counter--;
		temp = array[counter];
		array[counter] = array[index];
		array[index] = temp;
	}
	return array;
}

function ObjectSize(obj) {
	var size = 0, key;
	for (key in obj) {
		if (obj.hasOwnProperty(key)) size++;
	}
	return size;
}

function ObjectKeysToStrings(obj) {
	var stringKey = [];

	for (var key in obj) {
		if (obj.hasOwnProperty(key)) stringKey.push(key);
	}
	return stringKey;
}
