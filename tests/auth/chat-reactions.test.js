const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createChatRoutes } = require("../../server/chat/routes");
const { normalizeReaction, REACTION_OPTIONS } = require("../../server/chat/reactions");
const { ensureChatSchema } = require("../../server/chat/schema");

function createChatDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'User');
    CREATE TABLE driver_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,nickname TEXT NOT NULL,nickname_key TEXT NOT NULL UNIQUE,driver_type TEXT NOT NULL,country_code TEXT);
    CREATE TABLE chat_rooms (id INTEGER PRIMARY KEY,room_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,title TEXT NOT NULL,created_by INTEGER,created_at TEXT NOT NULL);
    CREATE TABLE chat_room_members (room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,joined_at TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'MEMBER',PRIMARY KEY(room_id,user_id));
    CREATE TABLE chat_room_spaces (room_id INTEGER PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,space_kind TEXT NOT NULL,country_code TEXT,created_at TEXT NOT NULL);
    CREATE TABLE chat_direct_pairs (first_user_id INTEGER NOT NULL,second_user_id INTEGER NOT NULL,room_id INTEGER NOT NULL UNIQUE,created_at TEXT NOT NULL,PRIMARY KEY(first_user_id,second_user_id));
    CREATE TABLE driver_blocks (blocker_id INTEGER NOT NULL,blocked_id INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE driver_relationships (requester_id INTEGER NOT NULL,target_id INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requester_id,target_id));
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,client_message_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(sender_id,client_message_id));
    CREATE TABLE chat_message_reactions (message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,reaction TEXT NOT NULL CHECK(reaction IN ('👍','✅','👀','❤️')),created_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id,reaction));
  `);
  const now = "2026-08-19T10:00:00.000Z";
  for (const [id, nickname] of [[1,"Alpha"],[2,"Bravo"],[3,"Outsider"]]) {
    db.prepare("INSERT INTO users(id,username) VALUES(?,?)").run(id,nickname.toLowerCase());
    db.prepare("INSERT INTO driver_profiles(user_id,nickname,nickname_key,driver_type,country_code) VALUES(?,?,?,'GENERAL','PL')").run(id,nickname,nickname.toLowerCase());
  }
  db.prepare("INSERT INTO chat_rooms VALUES(1,'general','GENERAL','Общий чат',NULL,?)").run(now);
  db.prepare("INSERT INTO chat_room_spaces VALUES(1,'GENERAL',NULL,?)").run(now);
  db.prepare("INSERT INTO chat_rooms VALUES(2,'direct:1:2','DIRECT','Личный чат',1,?)").run(now);
  db.prepare("INSERT INTO chat_room_spaces VALUES(2,'DIRECT',NULL,?)").run(now);
  db.prepare("INSERT INTO chat_room_members VALUES(2,1,?,'MEMBER')").run(now);
  db.prepare("INSERT INTO chat_room_members VALUES(2,2,?,'MEMBER')").run(now);
  db.prepare("INSERT INTO chat_direct_pairs VALUES(1,2,2,?)").run(now);
  const generalMessageId = Number(db.prepare("INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at) VALUES(1,1,'general_message_01','Общее сообщение',?)").run(now).lastInsertRowid);
  const directMessageId = Number(db.prepare("INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at) VALUES(2,1,'direct_message_01','Личное сообщение',?)").run(now).lastInsertRowid);
  db.prepare("INSERT INTO chat_message_reactions(message_id,user_id,reaction,created_at) VALUES(?,?,?,?)").run(generalMessageId,1,"❤️",now);
  ensureChatSchema(db,now);
  return { db,generalMessageId,directMessageId,now };
}

function createHarness(db) {
  const published=[];
  const handle=createChatRoutes({
    db,
    json(res,status,data){res.status=status;res.data=data;},
    requireSession(req,res){if(!req.userId){res.status=401;res.data={error:"authentication_required"};return null;}return {user:{id:req.userId}};},
    requireCsrf(){return true;},checkRate(){return true;},audit(){},nowIso(){return "2026-08-19T10:01:00.000Z";},publish(event){published.push(event);}
  });
  async function request(userId,pathname,{method="GET",body}={}){const req={method,userId,headers:{}};const res={};const handled=await handle(req,res,new URL(pathname,"http://test.local"),body);assert.equal(handled,true);return res;}
  return {request,published};
}

test("Chat Console V2 supports a curated 12-reaction set and still rejects arbitrary emoji",()=>{
  assert.equal(REACTION_OPTIONS.length,12);
  for(const key of ["👍","❤️","😂","😮","😢","🙏","🔥","✅","👀","👎","🎉","💯"]) assert.equal(normalizeReaction(key),key);
  assert.equal(normalizeReaction("🚀"),null);
  assert.equal(normalizeReaction(""),null);
});

test("legacy reactions migrate into v2, new reactions toggle, aggregate people and publish realtime",async()=>{
  const {db,generalMessageId}=createChatDb();
  const {request,published}=createHarness(db);
  let result=await request(2,`/api/driver/chat/messages/${generalMessageId}/reactions`,{method:"POST",body:{reaction:"🔥"}});
  assert.equal(result.status,200);assert.equal(result.data.added,true);
  assert.deepEqual(result.data.reactions.map((item)=>item.key),["❤️","🔥"]);
  assert.equal(result.data.reactions.find((item)=>item.key==="❤️").people[0],"Alpha");
  assert.equal(result.data.reactions.find((item)=>item.key==="🔥").reactedByMe,true);
  assert.equal(published.at(-1).type,"chat.reaction.updated");
  result=await request(2,`/api/driver/chat/messages/${generalMessageId}/reactions`,{method:"POST",body:{reaction:"🔥"}});
  assert.equal(result.status,200);assert.equal(result.data.added,false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_reactions_v2 WHERE reaction='🔥'").get().n,0);
  result=await request(1,"/api/driver/chat/rooms/1/messages");
  assert.equal(result.status,200);assert.equal(result.data.messages[0].reactions.some((item)=>item.key==="❤️"),true);
  db.close();
});

test("direct-room reactions still require membership and honor Driver blocks",async()=>{
  const {db,directMessageId,now}=createChatDb();const {request}=createHarness(db);
  let result=await request(3,`/api/driver/chat/messages/${directMessageId}/reactions`,{method:"POST",body:{reaction:"👀"}});
  assert.equal(result.status,404);assert.equal(result.data.error,"chat_room_not_found");
  db.prepare("INSERT INTO driver_blocks(blocker_id,blocked_id,created_at) VALUES(1,2,?)").run(now);
  result=await request(2,`/api/driver/chat/messages/${directMessageId}/reactions`,{method:"POST",body:{reaction:"👀"}});
  assert.equal(result.status,403);assert.equal(result.data.error,"driver_blocked");
  db.close();
});

test("Chat Console schema stays module-local while global auth migration remains 12",()=>{
  const runDir=fs.mkdtempSync(path.join(os.tmpdir(),"patap-chat-v2-schema-"));
  const previousDbPath=process.env.PATAP_DB_PATH,previousSecretPath=process.env.PATAP_AUTH_SECRET_PATH;
  const dbModulePath=require.resolve("../../server/auth/db");
  try{
    process.env.PATAP_DB_PATH=path.join(runDir,"auth.sqlite");process.env.PATAP_AUTH_SECRET_PATH=path.join(runDir,"secret.key");delete require.cache[dbModulePath];
    const {openDb,nowIso}=require("../../server/auth/db");const db=openDb();
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,12);
    const schema=ensureChatSchema(db,nowIso());assert.equal(schema.version,1);
    assert.equal(db.prepare("SELECT version FROM chat_schema_meta WHERE singleton=1").get().version,1);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get());
    db.close();
  }finally{
    delete require.cache[dbModulePath];
    if(previousDbPath===undefined)delete process.env.PATAP_DB_PATH;else process.env.PATAP_DB_PATH=previousDbPath;
    if(previousSecretPath===undefined)delete process.env.PATAP_AUTH_SECRET_PATH;else process.env.PATAP_AUTH_SECRET_PATH=previousSecretPath;
    fs.rmSync(runDir,{recursive:true,force:true});
  }
});
