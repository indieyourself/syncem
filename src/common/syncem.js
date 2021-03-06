(function(syncem) {
	
syncem.timeOffset = 0;
function getTime() {
	return new Date().getTime() + syncem.timeOffset;
}
syncem.getTime = getTime;

function lerpTimeOffset(target_offset, lerp) {
	if (typeof lerp === 'undefined') lerp = 0.5;
	syncem.timeOffset += (target_offset - syncem.timeOffset) * lerp;
}
syncem.lerpTimeOffset = lerpTimeOffset;

syncem.uniqSeed = getTime().toString(36) + '-' + ((Math.random() * 60466176)|0).toString(36);
var uniqSeq = 0;

syncem.makeUid = function() {
	return syncem.uniqSeed + '-' + (uniqSeq++).toString(36);
};


function SyncOb() {
}
SyncOb.prototype.update = function() {};
SyncOb.prototype.onDelete = function() {};
syncem.SyncOb = SyncOb;

function SyncMove(tick, id) {
	SyncOb.call(this);
	
	this.id = id || syncem.makeUid();
	this.tick = tick;
}
SyncMove.prototype = new SyncOb();
SyncMove.prototype.constructor = SyncMove;
SyncMove.fieldConfig = [
	{name:'id', type:'string'},
	{name:'tick', type:'float64'}
];
bserializer.registerClass(SyncMove, SyncMove.fieldConfig);
syncem.SyncMove = SyncMove;

SyncMove.prototype.checkValid = function(state) {
	return true;
};

SyncMove.prototype.apply = function(state) {
};



function SyncObjectMove(objectId) {
	SyncMove.call(this);
	this.objectId = objectId;
}
SyncObjectMove.prototype = new SyncMove();
SyncObjectMove.prototype.constructor = SyncObjectMove;
SyncObjectMove.fieldConfig = SyncMove.fieldConfig.concat([
	{name:'objectId', type:'string'}
]);
bserializer.registerClass(SyncObjectMove, SyncObjectMove.fieldConfig);
syncem.SyncObjectMove = SyncObjectMove;

SyncObjectMove.prototype.checkValid = function(state) {
	return this.objectId in state.objects;
};
	
SyncObjectMove.prototype.apply = function(state) {
	if (this.objectId in state.objects) {
		this.applyTo(state, state.objects[this.objectId]);
	}
	else {
		console.warn("Failed to apply move, couldn't find ", this.objectId);
	}
};
	
SyncObjectMove.prototype.applyTo = function(state, object) {
	throw "Unimplemented applyTo";
};


function ObjectAddedMove(object) {
	SyncObjectMove.call(this, object && object.id);
	this.object = object;
}
ObjectAddedMove.prototype = new SyncObjectMove();
ObjectAddedMove.prototype.constructor = ObjectAddedMove;
syncem.ObjectAddedMove = ObjectAddedMove;
bserializer.registerClass(ObjectAddedMove);
ObjectAddedMove.prototype.apply = function(state) {
	state.objects[this.object.id] = this.object;
	state.messages.push({
		id: this.id,
		objectId: this.objectId,
		message: "has joined",
		expiresAt: state.tick + 50,
		system:true
	});
};
ObjectAddedMove.prototype.checkValid = function(state) {
	return !(this.objectId in state.objects);
};


function ObjectRemovedMove(objectId) {
	SyncObjectMove.call(this, objectId);
}
ObjectRemovedMove.prototype = new SyncObjectMove();
ObjectRemovedMove.prototype.constructor = ObjectRemovedMove;
syncem.ObjectRemovedMove = ObjectRemovedMove;
bserializer.registerClass(ObjectRemovedMove);

ObjectRemovedMove.prototype.apply = function(state) {
//	console.log("Applying ObjectRemovedMove for ", this.objectId, " in tick ", state.tick);
	state.messages.push({
		id: this.id,
		objectId: (this.objectId && this.objectId in state.objects && state.objects[this.objectId].name) || this.objectId,
		message: "has left",
		expiresAt: state.tick + 50,
		system:true
	});
	state.removeObject(this.objectId);
};


function ObjectChatMove(objectId, message, ttl) {
	SyncObjectMove.call(this, objectId);
	
	this.message = message;
	this.ttl = ttl || 50;
	
}
ObjectChatMove.prototype = new SyncObjectMove();
ObjectChatMove.prototype.constructor = ObjectChatMove;
syncem.ObjectChatMove = ObjectChatMove;
bserializer.registerClass(ObjectChatMove);

ObjectChatMove.prototype.apply = function(state) {
	state.messages.push({
		id: this.id,
		objectId: this.objectId,
		message: this.message,
		expiresAt: state.tick + 50
	});
	if (state.messages.length > 50) {
		state.messages.shift();
	}
};


function SyncRoot() {
	syncem.SyncOb.call(this);
	
	//Moves are not copied between states and not synchronized in the same way
	this.moves = {};
	
	this.uidCounter = 0;
	this.tick = 0;
	this.objects = {};
	this.messages = [];
}
SyncRoot.prototype = new SyncOb();
SyncRoot.prototype.constructor = SyncRoot;
syncem.SyncRoot = SyncRoot;
syncem.syncRootFields = [
	{name:'uidCounter', type:'float64'},
	{name:'tick', type:'float64'},
	{name:'objects', type:'object'},
	{name:'messages', type:'array'}
];

SyncRoot.prototype.makeUidString = function() {
	return (this.uidCounter++).toString(36);
};

SyncRoot.prototype.removeObject = function(objectId) {
	if (objectId in this.objects) {
		this.objects[objectId].onDelete(this);
		delete this.objects[objectId];
	}
};
	
SyncRoot.prototype.applyMoves = function() {
	var moveIds = [];
	for (var moveId in this.moves) {
		moveIds.push(moveId);
	}
	moveIds.sort();
	for (var i = 0 ; i < moveIds.length; i++) {
		var move = this.moves[moveIds[i]];
		if (move.checkValid(this)) {
			move.apply(this);
		}
		else {
			console.warn("Move invalid! ", move);
		}
	}
};

SyncRoot.prototype.updateObjects = function() {
//	var n_objects = 0;
//	for (var objId in this.objects) {
//		n_objects ++;
//	}
//	console.log("Updating SyncRoot with ", n_objects, " objects");
	var objectIds = [];
	for (var objectId in this.objects) {
		objectIds.push(objectId);
	}
	objectIds.sort();
	for (var i = 0; i < objectIds.length ; i++) {
		this.objects[objectIds[i]].update(this);
	}
};

SyncRoot.prototype.updateMessages = function() {
	for (var messageIndex = 0; messageIndex < this.messages.length ; messageIndex ++) {
		var message = this.messages[messageIndex];
		if (message.expiry && this.tick >= message.expiresAt) {
			this.messages.splice(messageIndex, 1);
			messageIndex--;
		}
	}
};

SyncRoot.prototype.update = function() {
	this.applyMoves();
	this.updateObjects();
	this.updateMessages();
};

SyncRoot.prototype.getAsInitial = function() {
	var out = {};
//	var config = registrationsByConstructor[this.constructor];
	var config = registrationsByIndex[this.constructor.$syncemclassid];
	out.constructor = config.index;
	copyFieldsWithConfig(out, this, config);
	return out;
};


function Syncer(config) {
	config = config || {};
	if (config.lps == null) {
		config.lps = 10;
	}
	if (config.history_size == null) {
		config.history_size = config.lps;
	}
	
	this.config = config;
	this.tick = 0;
	this.dirty_tick = 0;
	this.states = [];
	this.start_time = null;
	this.interval = null;
	this.queuedMoves = {};
	this.lazyUpdater = false;
	this.pauseTick = null;
}
syncem.Syncer = Syncer;

Syncer.prototype.start = function(state, tick) {
	if (state == null) {
		state = new syncem.SyncRoot();
	}
	if (tick == null) {
		tick = 0;
	}
	this.tick = tick;
	this.states[tick % this.config.history_size] = state;
	this.start_time = getTime();
	this.startInterval();
};

Syncer.prototype.startInterval = function() {
	var syncer = this;
	console.log("startInterval with time ", new Date(syncer.start_time), syncer.start_time);
	var interval_ms = 1000 / this.config.lps;
	this.interval = setInterval(function() {
		if (syncer.pauseTick === null) {
			syncer.update();
		}
	}, interval_ms);
};

Syncer.prototype.stop = function() {
	if (this.interval) {
		clearInterval(this.interval);
		this.interval = null;
	}
};

Syncer.prototype.pause = function() {
	var pauseTick = this.getNowTick();
	this.pauseAt(pauseTick);
	return pauseTick;
};

Syncer.prototype.pauseAt = function(pauseTick) {
	this.pauseTick = pauseTick;
	this.stop();
};

Syncer.prototype.unpause = function() {
	var unpauseTime = getTime();
	this.unpauseAt(unpauseTime);
	return unpauseTime;
};

Syncer.prototype.unpauseAt = function(now) {
	// (now - this.start_time) * this.config.lps / 1000 = tick;
	// (tick * 1000 / this.config.lps) = now - this.start_time
	// this.start_time = now - (tick * 1000 / this.config.lps)
	this.start_time = now - (this.pauseTick * 1000 / this.config.lps);
	this.pauseTick = null;
	this.startInterval();
};

Syncer.prototype.isPaused = function() {
	return this.pauseTick !== null;
};

Syncer.prototype.addMove = function(move, allowFuture) {
	var next_tick = this.getNowTick() + 1;
	var valid = move.tick > this.getOldestTick() && (allowFuture || move.tick <= next_tick);
//		console.log("addMove valid tick range:",this.getOldestTick(),"->",now_tick,":",move);
	if (valid) {
		if (move.tick > this.tick) {
			if (!(move.tick in this.queuedMoves)) {
				this.queuedMoves[move.tick] = {};
			}
//			console.log("Enqueued move @" + move.tick + ": " + move.id + " " + move.constructor.name);
			this.queuedMoves[move.tick][move.id] = move;
		}
		else {
			var move_state = this.getState(move.tick);
			if (move_state) {
				move_state.moves[move.id] = move;
			}
			else {
				console.error("Failed to add move ", move, ", move state null, oldest=",this.getOldestTick()," next=" + next_tick);
			}
		}
		if (move.tick <= this.dirty_tick) {
			console.log("Old move at ",move.tick," causing dirtiness from ",this.dirty_tick);
			this.dirty_tick = move.tick - 1;
		}
	}
	else {
		console.warn("addMove failed, out of range (",this.getOldestTick(),"->",next_tick,"):", move);
	}
	return valid;
};

Syncer.prototype.getNowTickPrecise = function() {
	var now = getTime();
	var nowTick = (now - this.start_time) * this.config.lps / 1000;
	if (this.isPaused() && nowTick > this.pauseTick) {
		nowTick = this.pauseTick;
	}
	return nowTick;
};
Syncer.prototype.getNowTick = function() {
	return Math.floor(this.getNowTickPrecise());
};
Syncer.prototype.getTargetTick = function() {
	var target_tick = this.getNowTick();
	if (this.lazyUpdater) {
		target_tick -= this.config.lps - 1;
	}
	return target_tick;
};

Syncer.prototype.needsUpdate = function() {
	var now_tick = this.getNowTick();
	return this.dirty_tick < now_tick;
};

Syncer.prototype.update = function() {
	var updated = false;
	var target_tick = this.getTargetTick();
	var t0 = new Date().getTime();
//	console.log("Updating ", this.dirty_tick, "->", target_tick);
	while (this.dirty_tick < target_tick) {
		var prev_tick = this.dirty_tick++;

//		console.log("copying ", prev_tick, " into ", this.dirty_tick);
		var prev_index = prev_tick % this.config.history_size;
		var next_index = this.dirty_tick % this.config.history_size;

		var prev_state = this.states[prev_index];
		var next_state = this.states[next_index];

		//Fresh state?
		if (next_state == null) {
			next_state = this.states[next_index] = bserializer.copyGeneric(null, prev_state, undefined, {test:true});
		}
		//Recycled old state?
		else if (next_state.tick != this.dirty_tick) {
			//clear out old invalid moves
			next_state.moves = {};
			next_state.record = null;
		}
		//Any queued moves for this state?
		if (this.dirty_tick in this.queuedMoves) {
			var moves = this.queuedMoves[this.dirty_tick];
			for (var moveId in moves) {
//				console.log("Adding queued move ", moveId, ":", moves[moveId]);
				next_state.moves[moveId] = moves[moveId];
			}
			delete this.queuedMoves[this.dirty_tick];
		}

//		console.log("copying ", prev_tick, " into ", this.dirty_tick);
		//Only copy the objects, not the moves
		next_state = bserializer.copyGeneric(next_state, prev_state);
//		next_state = bserializer.copyGeneric(next_state, prev_state, undefined, true);
//		console.log("copied ", prev_tick, " into ", this.dirty_tick);
		next_state.tick = this.dirty_tick;
		next_state.update();
		
//		if (typeof require != 'undefined') {
//			var util = require('util');
//			var old_record = next_state.record;
//			delete next_state.record;
//			var record = util.inspect(next_state, false, 10);
//			if (old_record && replays_written < 10) {
//				if (record != old_record) {
//					console.log("Dumping rewound results");
//					var fs = require('fs');
//					var serial = this.dirty_tick;
//					while (serial.length < 9) serial = '0' + serial;
//					fs.writeFile('dump_' + serial + 'a.json', old_record);
//					fs.writeFile('dump_' + serial + 'b.json', record);
//					replays_written++;
//				}
//				else {
//					console.log("REPLAY IDENTICAL! :D");
//				}
//			}
//			next_state.record = record;
//		}
		
//		console.log("updated", this.dirty_tick);
		if (this.tick < this.dirty_tick) {
			this.tick = this.dirty_tick;
		}
		if (this.onUpdate) {
			this.onUpdate();
		}
		updated = true;
		if (new Date().getTime() > t0 + 1000) {
			console.warn("Bailing out of update, taking too long!");
			break;
		}
	}
	target_tick = this.getTargetTick();
	if (this.dirty_tick + 1 < target_tick)  {
		console.warn("Falling behind! Updated to " + this.tick + ", but need to be at " + target_tick);
	}
	return updated;
};
//var replays_written = 0;

Syncer.prototype.getOldestTick = function() {
	return Math.max(0, this.tick - this.config.history_size + 1);
};

Syncer.prototype.getState = function(tick) {
	if (tick == null) {
		tick = this.tick;
	}
	var state = null;
	if (tick >= this.getOldestTick() && tick <= this.tick) {
		state = this.states[tick % this.config.history_size];
	}
	return state;
};

Syncer.prototype.getAllMovesByTick = function() {
	var moves_by_tick = {};
	function addMoves(moves) {
		for (var move_id in moves) {
			var move = moves[move_id];
			if (!(move.tick in moves_by_tick)) {
				moves_by_tick[move.tick] = {};
			}
			moves_by_tick[move.tick][move_id] = move;
		}
	}
	for (var stateIndex = 0; stateIndex < this.states.length; stateIndex ++) {
		addMoves(this.states[stateIndex].moves);
	}
	for (var tick in this.queuedMoves) {
		addMoves(this.queuedMoves[tick]);
	}
	return moves_by_tick;
};

function StartPacket(name) {
	this.name = name;
}
syncem.StartPacket = StartPacket;
bserializer.registerClass(StartPacket);

function SetupPacket(syncer, user_id) {
	if (syncer) {
		var oldest_tick = syncer.getOldestTick();
		this.config = syncer.config;
		this.oldest = syncer.states[oldest_tick % syncer.config.history_size];
		this.start_time = syncer.start_time;
		this.pauseTick = syncer.pauseTick;
		this.moves = syncer.getAllMovesByTick();
		this.user_id = user_id;
	}
}
bserializer.registerClass(SetupPacket, [
	{name:'config', type:'object'},
	{name:'oldest'},
	{name:'start_time', type:'float64'},
	{name:'pauseTick', type:['null','float64']},
	{name:'moves', type:'object'},
	{name:'user_id', type:'string'}
]);
syncem.SetupPacket = SetupPacket;

SetupPacket.prototype.createSyncer = function() {
	var syncer = new syncem.Syncer(this.config);
	syncer.config.history_size *= 2;
	syncer.states[this.oldest.tick % syncer.config.history_size] = this.oldest;
	syncer.tick = syncer.dirty_tick = this.oldest.tick;
	syncer.start_time = this.start_time;
	syncer.queuedMoves = this.moves;
	syncer.pauseTick = this.pauseTick;
	syncer.update();
	if (!syncer.isPaused()) {
		syncer.startInterval();
	}
	return syncer;
};

function simpleChecksum(d) {
	var checksum = 0;
	if (typeof d === 'string') {
		for (var i=0 ; i < d.length ; i++) {
			checksum = d.charCodeAt(i) ^ (checksum << 5) ^ (checksum >>> 27);
		}
	}
	else {
		if (d.constructor === ArrayBuffer) {
			d = new Uint8Array(d);
		}
		for (var i=0 ; i < d.length ; i++) {
			checksum = d[i] ^ (checksum << 5) ^ (checksum >>> 27);
		}
	}
	return checksum;
}
syncem.simpleChecksum= simpleChecksum;

function SyncPacket() {
	this.clientTime = null;
	this.serverTime = null;
}
syncem.SyncPacket = SyncPacket;
bserializer.registerClass(SyncPacket, {
	fields: [
		{name: 'clientTime', type: 'float64'},
		{name: 'serverTime', type: ['null','float64']}
	]
});

function ChecksumPacket(tick, checkstring) {
	this.tick = tick;
	this.checksum = checkstring ? simpleChecksum(checkstring) : 0;
}
syncem.ChecksumPacket = ChecksumPacket;
bserializer.registerClass(ChecksumPacket, [
	{name:'tick',type:'uint32'},
	{name:'checksum',type:'int32'}
]);

function StartRequestPacket(name) {
	this.name = name;
}
syncem.StartRequestPacket = StartRequestPacket;
bserializer.registerClass(StartRequestPacket, [
	{name:'name',type:'string'}
]);

function PauseRequestPacket(pauseTick) {
	this.pauseTick = pauseTick;
}
syncem.PauseRequestPacket = PauseRequestPacket;
bserializer.registerClass(PauseRequestPacket, [
	{name:'pauseTick',type:'float64'}
]);

function UnpauseRequestPacket(unpauseTime) {
	this.unpauseTime = unpauseTime;
}
syncem.UnpauseRequestPacket = UnpauseRequestPacket;
bserializer.registerClass(UnpauseRequestPacket, [
	{name:'unpauseTime',type:'float64'}
]);


})(typeof exports === 'undefined'? this['syncem']={}: exports);

