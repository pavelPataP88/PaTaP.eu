const STYLE_ID = "patap-chat-console-v2";

const ROOM_KIND_LABELS = Object.freeze({ GENERAL: "Общий", COUNTRY: "Страна", DIRECT: "Личный", GROUP: "Группа" });
const ROLE_LABELS = Object.freeze({ OWNER: "Владелец", ADMIN: "Админ", MODERATOR: "Модератор", MEMBER: "Участник", READONLY: "Только чтение" });

function button(text, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function iconButton(text, label) {
  const node = button(text, "chat-icon-button");
  node.setAttribute("aria-label", label);
  node.title = label;
  return node;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function shortTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

export function installChatConsoleStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.chat-card.chat-console-card{padding:0;overflow:hidden;background:#07110e}.chat-console-shell{display:grid;grid-template-columns:minmax(270px,330px) minmax(0,1fr);height:100%;min-height:0}.chat-console-sidebar{display:flex;min-width:0;min-height:0;flex-direction:column;border-right:1px solid var(--line);background:#091611}.chat-sidebar-head{display:grid;gap:9px;padding:13px 12px 10px;border-bottom:1px solid var(--line)}.chat-sidebar-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.chat-sidebar-title h2{margin:0;color:inherit;font-size:1.15rem}.chat-sidebar-actions{display:flex;gap:6px}.chat-icon-button{display:grid;place-items:center;min-width:40px;height:40px;padding:0;border:1px solid var(--line);border-radius:12px;background:#10251d;color:inherit;cursor:pointer;font-weight:900}.chat-icon-button:hover,.chat-icon-button:focus-visible{border-color:var(--accent);color:var(--accent)}.chat-room-search{position:relative}.chat-room-search input{min-height:42px;padding-left:38px;border-radius:13px}.chat-room-search::before{position:absolute;z-index:1;left:13px;top:11px;content:'⌕';color:var(--muted);font-size:1rem}.chat-room-filters{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}.chat-room-filters button{flex:0 0 auto;min-height:34px;padding:5px 10px;border:1px solid transparent;border-radius:999px;background:#0d2019;color:var(--muted);font-size:.76rem;font-weight:850}.chat-room-filters button.active{border-color:var(--accent);color:var(--accent);background:rgba(104,224,173,.08)}.chat-room-list{display:grid;align-content:start;min-height:0;overflow:auto;padding:7px}.chat-room-row{display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;min-height:66px;padding:8px;border:1px solid transparent;border-radius:14px;background:transparent;color:inherit;text-align:left;cursor:pointer}.chat-room-row:hover{background:#0b1b15}.chat-room-row.active{border-color:rgba(104,224,173,.35);background:#10251d}.chat-room-avatar{display:grid;width:46px;height:46px;place-items:center;border-radius:15px;background:#17382d;color:var(--accent);font-weight:950}.chat-room-row[data-kind='DIRECT'] .chat-room-avatar{border-radius:50%}.chat-room-copy{min-width:0}.chat-room-line{display:flex;align-items:center;gap:6px;min-width:0}.chat-room-line strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-room-copy small{display:block;margin-top:4px;overflow:hidden;color:var(--muted);font-size:.75rem;text-overflow:ellipsis;white-space:nowrap}.chat-room-copy small.draft{color:#ffcf7a}.chat-room-meta{display:grid;justify-items:end;gap:5px;color:var(--muted);font-size:.7rem}.chat-unread{display:grid;min-width:22px;height:22px;padding:0 6px;place-items:center;border-radius:999px;background:var(--accent);color:var(--accent-dark);font-weight:950}.chat-mention-badge{color:#ffcf7a;font-weight:950}.chat-room-pin{color:var(--accent)}.chat-console-main{display:flex;min-width:0;min-height:0;flex-direction:column;background:linear-gradient(180deg,#08130f,#07110e)}.chat-conversation-head{display:flex;align-items:center;gap:10px;min-height:66px;padding:10px 13px;border-bottom:1px solid var(--line);background:rgba(7,17,14,.96)}.chat-back{display:none}.chat-conversation-identity{min-width:0;flex:1}.chat-conversation-identity strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem}.chat-conversation-identity small{display:block;margin-top:3px;overflow:hidden;color:var(--muted);font-size:.75rem;text-overflow:ellipsis;white-space:nowrap}.chat-head-actions{display:flex;gap:6px}.chat-pinned-strip{display:flex;gap:7px;min-height:0;overflow-x:auto;padding:0 12px;background:#08130f}.chat-pinned-strip:not(:empty){padding-top:7px;padding-bottom:7px;border-bottom:1px solid var(--line)}.chat-pin-card{flex:0 0 auto;max-width:280px;min-height:40px;padding:6px 9px;border:1px solid rgba(104,224,173,.28);border-radius:11px;background:#0d261d;color:#dff8ed;text-align:left}.chat-pin-card small{display:block;margin-top:2px;color:var(--muted)}.chat-messages.chat-console-messages{position:relative;display:flex;flex:1 1 auto;min-height:0;flex-direction:column;gap:7px;margin:0;padding:16px clamp(12px,2vw,24px);overflow:auto;border:0;border-radius:0;background:radial-gradient(circle at 85% 5%,rgba(104,224,173,.06),transparent 35%),#07110e}.chat-day-separator{align-self:center;margin:6px 0;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:#0a1914;color:var(--muted);font-size:.7rem}.chat-message.chat-bubble{position:relative;width:max-content;max-width:min(78%,720px);padding:9px 11px 7px;border:1px solid rgba(176,222,204,.09);border-radius:16px 16px 16px 5px;background:#10251d;box-shadow:0 8px 22px rgba(0,0,0,.12)}.chat-message.chat-bubble.own{align-self:flex-end;border-radius:16px 16px 5px 16px;background:#124331}.chat-message.chat-bubble.deleted{opacity:.72;font-style:italic}.chat-message-author{display:block;margin-bottom:5px;color:var(--accent);font-size:.74rem;font-weight:850}.chat-reply-quote{margin-bottom:7px;padding:6px 8px;border-left:3px solid var(--accent);border-radius:7px;background:rgba(0,0,0,.18);color:var(--muted);font-size:.76rem;cursor:pointer}.chat-reply-quote strong{display:block;color:#dff8ed}.chat-forward-label{margin-bottom:5px;color:#9ad8bf;font-size:.7rem;font-weight:800}.chat-message-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.42}.chat-message-footer{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:5px;color:var(--muted);font-size:.67rem}.chat-message-footer .edited{font-style:italic}.chat-receipt{letter-spacing:-.12em;color:#86bda5}.chat-receipt.read{color:#7fbaff}.chat-message-menu{position:absolute;top:4px;right:5px}.chat-message:not(.own) .chat-message-menu{right:-34px}.chat-message.own .chat-message-menu{left:-34px;right:auto}.chat-message-menu>button{opacity:0}.chat-message:hover .chat-message-menu>button,.chat-message-menu>button:focus-visible{opacity:1}.chat-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.chat-reaction{display:inline-flex;align-items:center;gap:3px;min-height:27px;padding:2px 7px;border:1px solid var(--line);border-radius:999px;background:#0a1914;color:var(--muted);font-size:.76rem}.chat-reaction[aria-pressed='true']{border-color:var(--accent);color:var(--accent);background:rgba(104,224,173,.08)}.chat-attachment-grid{display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:5px;margin-bottom:7px}.chat-attachment{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:11px;background:#08130f}.chat-attachment img,.chat-attachment video{display:block;width:100%;max-height:320px;object-fit:cover}.chat-file-card,.chat-audio-card{display:flex;align-items:center;gap:9px;min-width:220px;padding:9px;color:inherit;text-decoration:none}.chat-file-icon{display:grid;width:38px;height:38px;place-items:center;border-radius:10px;background:#17382d;color:var(--accent);font-weight:900}.chat-file-copy{min-width:0}.chat-file-copy strong,.chat-file-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-file-copy small{margin-top:3px;color:var(--muted)}.chat-audio-card audio{width:min(320px,55vw);height:36px}.chat-poll{display:grid;gap:7px;min-width:min(360px,65vw);margin:2px 0}.chat-poll h4{margin:0;font-size:.95rem}.chat-poll-option{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;min-height:36px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:#0a1914;color:inherit;text-align:left}.chat-poll-option.voted{border-color:var(--accent)}.chat-poll-bar{grid-column:2/4;height:3px;border-radius:999px;background:rgba(104,224,173,.16);overflow:hidden}.chat-poll-bar span{display:block;height:100%;background:var(--accent)}.chat-typing.chat-console-typing{min-height:22px;margin:0;padding:3px 14px;color:var(--accent);font-size:.74rem}.chat-composer-context{display:none;align-items:center;gap:8px;margin:0 10px;padding:8px 10px;border:1px solid var(--line);border-radius:11px;background:#0a1914}.chat-composer-context.active{display:flex}.chat-composer-context-copy{min-width:0;flex:1}.chat-composer-context-copy strong,.chat-composer-context-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-composer-context-copy small{margin-top:2px;color:var(--muted)}.chat-upload-preview{display:flex;gap:6px;overflow-x:auto;padding:0 10px}.chat-upload-chip{display:flex;align-items:center;gap:7px;max-width:230px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:#0a1914;color:var(--muted);font-size:.75rem}.chat-upload-chip strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-form.chat-console-form{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:7px;align-items:end;margin:0;padding:9px 10px 11px;border-top:1px solid var(--line);background:#08130f}.chat-form.chat-console-form textarea{min-height:44px;max-height:132px;padding:11px 13px;resize:none;border-radius:15px}.chat-composer-button{display:grid;width:44px;height:44px;place-items:center;border:1px solid var(--line);border-radius:14px;background:#10251d;color:inherit;font-size:1.05rem}.chat-send-button{display:grid;width:46px;height:46px;place-items:center;border:0;border-radius:50%;background:var(--accent);color:var(--accent-dark);font-weight:950}.chat-voice-panel{display:none;align-items:center;gap:9px;margin:0 10px 8px;padding:9px 10px;border:1px solid rgba(255,143,135,.35);border-radius:12px;background:#231513}.chat-voice-panel.active{display:flex}.chat-voice-time{min-width:42px;color:#ffaaa2;font-variant-numeric:tabular-nums;font-weight:900}.chat-voice-wave{display:flex;flex:1;align-items:center;gap:2px;height:28px}.chat-voice-wave i{display:block;width:3px;border-radius:999px;background:#ff8f87}.chat-empty-conversation{display:grid;flex:1;place-items:center;padding:30px;color:var(--muted);text-align:center}.chat-dialog{width:min(640px,calc(100vw - 24px));max-height:min(84vh,760px);padding:0;border:1px solid var(--line);border-radius:20px;background:#0b1814;color:#f4f8f6}.chat-dialog::backdrop{background:rgba(0,0,0,.65);backdrop-filter:blur(3px)}.chat-dialog-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--line);background:#0b1814}.chat-dialog-head h3{margin:0}.chat-dialog-body{display:grid;gap:9px;padding:13px 15px;overflow:auto}.chat-dialog-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border:1px solid var(--line);border-radius:12px;background:#091711}.chat-dialog-row small{display:block;margin-top:3px;color:var(--muted)}.chat-dialog-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.chat-dialog button,.chat-dialog select{min-height:38px}.chat-form-stack{display:grid;gap:10px}.chat-form-actions{display:flex;justify-content:flex-end;gap:7px}.chat-load-older{align-self:center}.chat-search-result{cursor:pointer}.chat-search-result mark{background:rgba(104,224,173,.24);color:inherit}@media(max-width:820px){.chat-console-shell{grid-template-columns:1fr}.chat-console-sidebar{border-right:0}.chat-console-main{display:none;position:absolute;inset:0;z-index:7}.chat-console-card.conversation-open .chat-console-sidebar{display:none}.chat-console-card.conversation-open .chat-console-main{display:flex}.chat-back{display:grid}.chat-message.chat-bubble{max-width:88%}.chat-message:not(.own) .chat-message-menu,.chat-message.own .chat-message-menu{position:static;margin-top:3px}.chat-message-menu>button{opacity:1}.chat-attachment-grid{grid-template-columns:1fr}.chat-form.chat-console-form{grid-template-columns:auto minmax(0,1fr) auto}.chat-form.chat-console-form .chat-voice-button{grid-column:1}.chat-send-button{grid-column:3}.chat-audio-card audio{width:min(260px,52vw)}}@media(max-width:480px){.chat-room-row{min-height:62px}.chat-messages.chat-console-messages{padding:12px 9px}.chat-message.chat-bubble{max-width:92%}.chat-poll{min-width:min(300px,75vw)}}
`;
  document.head.append(style);
}

export function createChatConsoleUi({ card, roomTitle, roomsElement, messagesElement, form, typingElement, stateElement }) {
  installChatConsoleStyles();
  card.classList.add("chat-console-card");
  messagesElement.classList.add("chat-console-messages");
  typingElement.classList.add("chat-console-typing");
  form.classList.add("chat-console-form");

  const shell = document.createElement("div"); shell.className = "chat-console-shell";
  const sidebar = document.createElement("aside"); sidebar.className = "chat-console-sidebar";
  const sidebarHead = document.createElement("div"); sidebarHead.className = "chat-sidebar-head";
  const sidebarTitle = document.createElement("div"); sidebarTitle.className = "chat-sidebar-title";
  const title = document.createElement("h2"); title.textContent = "Чаты";
  const sidebarActions = document.createElement("div"); sidebarActions.className = "chat-sidebar-actions";
  const newDirectButton = iconButton("✎", "Новый личный чат");
  const newGroupButton = iconButton("＋", "Создать группу");
  const menuButton = iconButton("⋮", "Ещё");
  sidebarActions.append(newDirectButton, newGroupButton, menuButton); sidebarTitle.append(title, sidebarActions);
  const searchWrap = document.createElement("div"); searchWrap.className = "chat-room-search";
  const roomSearch = document.createElement("input"); roomSearch.type = "search"; roomSearch.placeholder = "Поиск чатов"; roomSearch.setAttribute("aria-label", "Поиск чатов"); searchWrap.append(roomSearch);
  const filters = document.createElement("div"); filters.className = "chat-room-filters";
  const filterButtons = new Map();
  for (const [key,label] of [["ALL","Все"],["DIRECT","Личные"],["GROUP","Группы"],["COUNTRY","Страна"],["ARCHIVED","Архив"]]) { const node=button(label); node.dataset.filter=key; filterButtons.set(key,node); filters.append(node); }
  sidebarHead.append(sidebarTitle, searchWrap, filters); sidebar.append(sidebarHead, roomsElement);

  const main = document.createElement("section"); main.className = "chat-console-main";
  const head = document.createElement("header"); head.className = "chat-conversation-head";
  const backButton = iconButton("←", "Назад к чатам"); backButton.classList.add("chat-back");
  const identity = document.createElement("div"); identity.className = "chat-conversation-identity";
  const identityTitle = document.createElement("strong"); identityTitle.textContent = "Выберите чат";
  const identityMeta = document.createElement("small"); identityMeta.textContent = ""; identity.append(identityTitle, identityMeta);
  const headActions = document.createElement("div"); headActions.className = "chat-head-actions";
  const searchButton = iconButton("⌕", "Поиск в сообщениях");
  const roomInfoButton = iconButton("ⓘ", "Информация о чате");
  headActions.append(searchButton, roomInfoButton); head.append(backButton, identity, headActions);
  const pins = document.createElement("div"); pins.className = "chat-pinned-strip";
  const empty = document.createElement("div"); empty.className = "chat-empty-conversation"; empty.textContent = "Выберите разговор слева или создайте новый.";
  const context = document.createElement("div"); context.className = "chat-composer-context";
  const contextCopy = document.createElement("div"); contextCopy.className = "chat-composer-context-copy";
  const contextTitle = document.createElement("strong"); const contextText = document.createElement("small"); contextCopy.append(contextTitle, contextText);
  const contextClose = iconButton("×", "Отменить ответ или редактирование"); context.append(contextCopy, contextClose);
  const uploads = document.createElement("div"); uploads.className = "chat-upload-preview";
  const voice = document.createElement("div"); voice.className = "chat-voice-panel";
  const voiceTime = document.createElement("strong"); voiceTime.className = "chat-voice-time"; voiceTime.textContent = "0:00";
  const voiceWave = document.createElement("div"); voiceWave.className = "chat-voice-wave";
  for (let i=0;i<28;i+=1){const bar=document.createElement("i");bar.style.height=`${8+(i%7)*3}px`;voiceWave.append(bar);}
  const voicePause = button("Пауза"); const voiceCancel = button("Отмена"); const voiceDone = button("Готово"); voice.append(voiceTime,voiceWave,voicePause,voiceCancel,voiceDone);

  const input = form.elements.message;
  const attachmentButton = iconButton("＋", "Прикрепить файл"); attachmentButton.classList.add("chat-composer-button");
  const voiceButton = iconButton("🎙", "Записать голосовое сообщение"); voiceButton.classList.add("chat-composer-button","chat-voice-button");
  const sendButton = form.querySelector('button[type="submit"]'); sendButton.className = "chat-send-button"; sendButton.textContent = "➤"; sendButton.setAttribute("aria-label","Отправить");
  form.replaceChildren(attachmentButton,input,voiceButton,sendButton);

  main.append(head,pins,empty,messagesElement,typingElement,context,uploads,voice,form);
  shell.append(sidebar,main); card.replaceChildren(shell);
  roomTitle.hidden = true; stateElement.hidden = true;

  const dialog = document.createElement("dialog"); dialog.className = "chat-dialog";
  const dialogHead = document.createElement("div"); dialogHead.className = "chat-dialog-head";
  const dialogTitle = document.createElement("h3"); const dialogClose = iconButton("×","Закрыть"); dialogHead.append(dialogTitle,dialogClose);
  const dialogBody = document.createElement("div"); dialogBody.className = "chat-dialog-body"; dialog.append(dialogHead,dialogBody); document.body.append(dialog);
  dialogClose.addEventListener("click",()=>dialog.close()); dialog.addEventListener("click",(event)=>{if(event.target===dialog)dialog.close();});

  let currentFilter = "ALL", currentRooms = [], currentRoomId = null, selectHandler = null;
  function matches(room) {
    if (currentFilter === "ARCHIVED") return room.archived;
    if (room.archived) return false;
    if (currentFilter === "DIRECT") return room.kind === "DIRECT";
    if (currentFilter === "GROUP") return room.kind === "GROUP";
    if (currentFilter === "COUNTRY") return room.kind === "COUNTRY";
    return true;
  }
  function roomPreview(room) {
    if (room.draft?.text) return { text:`Черновик: ${room.draft.text}`, draft:true };
    const last = room.lastMessage;
    if (!last) return { text:ROOM_KIND_LABELS[room.kind] || "Чат", draft:false };
    return { text:`${last.own ? "Вы" : last.sender}: ${last.text || "Вложение"}`, draft:false };
  }
  function renderRooms() {
    roomsElement.replaceChildren();
    const query = roomSearch.value.trim().toLocaleLowerCase();
    const items = currentRooms.filter(matches).filter((room)=>!query||room.title.toLocaleLowerCase().includes(query)||(room.lastMessage?.text||"").toLocaleLowerCase().includes(query));
    if (!items.length) { const p=document.createElement("p");p.className="contacts-empty";p.textContent=query?"Ничего не найдено.":"Здесь пока нет чатов.";roomsElement.append(p);return; }
    for (const room of items) {
      const row = button(""); row.className="chat-room-row"; row.dataset.kind=room.kind; row.classList.toggle("active",Number(room.id)===Number(currentRoomId));
      const avatar=document.createElement("span");avatar.className="chat-room-avatar";avatar.textContent=(room.title||"?").trim().slice(0,1).toLocaleUpperCase();
      const copy=document.createElement("span");copy.className="chat-room-copy";const line=document.createElement("span");line.className="chat-room-line";const strong=document.createElement("strong");strong.textContent=room.title;
      line.append(strong);if(room.favorite){const fav=document.createElement("span");fav.textContent="★";fav.title="Избранное";fav.className="chat-room-pin";line.append(fav);}if(room.muted){const mute=document.createElement("span");mute.textContent="⌁";mute.title="Без уведомлений";line.append(mute);}
      const preview=roomPreview(room);const small=document.createElement("small");small.textContent=preview.text;small.classList.toggle("draft",preview.draft);copy.append(line,small);
      const meta=document.createElement("span");meta.className="chat-room-meta";const time=document.createElement("span");time.textContent=shortTime(room.lastMessage?.createdAt);meta.append(time);
      if(room.mentionCount){const mention=document.createElement("span");mention.className="chat-mention-badge";mention.textContent="@";meta.append(mention);}if(room.unreadCount){const unread=document.createElement("span");unread.className="chat-unread";unread.textContent=room.unreadCount>99?"99+":String(room.unreadCount);meta.append(unread);}if(room.pinnedRank!==null){const pin=document.createElement("span");pin.className="chat-room-pin";pin.textContent="⌖";meta.append(pin);}
      row.append(avatar,copy,meta);row.addEventListener("click",()=>selectHandler?.(room));roomsElement.append(row);
    }
  }
  function setFilter(filter) { currentFilter=filter;for(const [key,node] of filterButtons)node.classList.toggle("active",key===filter);renderRooms(); }
  for(const [key,node] of filterButtons)node.addEventListener("click",()=>setFilter(key));roomSearch.addEventListener("input",renderRooms);setFilter("ALL");
  backButton.addEventListener("click",()=>card.classList.remove("conversation-open"));

  return {
    controls:{newDirectButton,newGroupButton,menuButton,searchButton,roomInfoButton,attachmentButton,voiceButton,voicePause,voiceCancel,voiceDone,contextClose},
    input, messagesElement, typingElement, pinsElement:pins, uploadsElement:uploads, voiceElement:voice,
    renderRooms(items,{activeId=null,onSelect}={}){currentRooms=Array.isArray(items)?items.slice():[];currentRoomId=activeId;if(onSelect)selectHandler=onSelect;renderRooms();},
    setRoom(room){currentRoomId=room?.id??null;identityTitle.textContent=room?.title||"Выберите чат";let meta="";if(room){if(room.kind==="DIRECT")meta=room.peer?.lastSeenAt?`был(а) в сети ${shortTime(room.peer.lastSeenAt)}`:"Личный чат";else meta=`${ROOM_KIND_LABELS[room.kind]||"Чат"}${room.memberCount?` · ${room.memberCount} участников`:""}${room.role&&room.kind==="GROUP"?` · ${ROLE_LABELS[room.role]||room.role}`:""}`;}identityMeta.textContent=meta;empty.hidden=Boolean(room);messagesElement.hidden=!room;form.hidden=!room;typingElement.hidden=!room;searchButton.disabled=!room;roomInfoButton.disabled=!room;if(room)card.classList.add("conversation-open");renderRooms();},
    setConnection(text,kind=""){stateElement.textContent=text;stateElement.dataset.state=kind;identityMeta.dataset.connection=kind;},
    setTyping(text=""){typingElement.textContent=text;},
    renderPins(items,onOpen){pins.replaceChildren();for(const item of items||[]){const node=button("");node.className="chat-pin-card";const strong=document.createElement("strong");strong.textContent=item.sender?.nickname||"Сообщение";const small=document.createElement("small");small.textContent=item.text||item.poll?.question||item.attachments?.[0]?.fileName||"Закреплённое сообщение";node.append(strong,small);node.addEventListener("click",()=>onOpen?.(item));pins.append(node);}},
    setComposerContext(mode,message){context.classList.toggle("active",Boolean(mode));context.dataset.mode=mode||"";contextTitle.textContent=mode==="edit"?"Редактирование":mode==="reply"?`Ответ · ${message?.sender?.nickname||""}`:"";contextText.textContent=message?.text||message?.poll?.question||message?.attachments?.[0]?.fileName||"";},
    clearComposerContext(){context.classList.remove("active");delete context.dataset.mode;contextTitle.textContent="";contextText.textContent="";},
    renderUploads(items,onRemove){uploads.replaceChildren();for(const item of items||[]){const chip=document.createElement("span");chip.className="chat-upload-chip";const mark=document.createElement("span");mark.textContent=item.kind==="IMAGE"?"▧":item.kind==="VIDEO"?"▶":item.kind==="AUDIO"?"♪":"▤";const name=document.createElement("strong");name.textContent=item.fileName;const close=iconButton("×",`Убрать ${item.fileName}`);close.style.width="30px";close.style.height="30px";close.addEventListener("click",()=>onRemove?.(item));chip.append(mark,name,close);uploads.append(chip);}},
    setVoice(active,{elapsed="0:00",paused=false}={}){voice.classList.toggle("active",Boolean(active));voiceTime.textContent=elapsed;voicePause.textContent=paused?"Продолжить":"Пауза";},
    showDialog(titleText,content){dialogTitle.textContent=titleText;dialogBody.replaceChildren();if(content instanceof Node)dialogBody.append(content);else if(Array.isArray(content))dialogBody.append(...content);dialog.showModal();return dialog;},
    closeDialog(){dialog.close();},
    makeRow({title:rowTitle,subtitle="",actions=[]}){const row=document.createElement("div");row.className="chat-dialog-row";const copy=document.createElement("div");const strong=document.createElement("strong");strong.textContent=rowTitle;copy.append(strong);if(subtitle){const small=document.createElement("small");small.textContent=subtitle;copy.append(small);}const box=document.createElement("div");box.className="chat-dialog-actions";box.append(...actions);row.append(copy,box);return row;},
    makeAction(text,handler,{danger=false}={}){const node=button(text);if(danger)node.classList.add("danger");node.addEventListener("click",handler);return node;},
    makeSelect(values,current,handler){const node=document.createElement("select");for(const [value,label] of values)node.append(option(value,label));node.value=current;node.addEventListener("change",()=>handler(node.value));return node;},
    makeForm(fields,submitText,onSubmit){const formNode=document.createElement("form");formNode.className="chat-form-stack";for(const field of fields){const label=document.createElement("label");label.textContent=field.label;let inputNode;if(field.type==="select"){inputNode=document.createElement("select");for(const [value,caption] of field.options)inputNode.append(option(value,caption));inputNode.value=field.value??field.options[0]?.[0]??"";}else if(field.type==="textarea"){inputNode=document.createElement("textarea");inputNode.rows=3;inputNode.maxLength=field.maxLength||500;inputNode.value=field.value||"";}else{inputNode=document.createElement("input");inputNode.type=field.type||"text";inputNode.value=field.value||"";if(field.maxLength)inputNode.maxLength=field.maxLength;if(field.minLength)inputNode.minLength=field.minLength;}inputNode.name=field.name;if(field.required)inputNode.required=true;label.append(inputNode);formNode.append(label);}const actions=document.createElement("div");actions.className="chat-form-actions";const cancel=button("Отмена");cancel.addEventListener("click",()=>dialog.close());const submit=document.createElement("button");submit.type="submit";submit.className="primary";submit.textContent=submitText;actions.append(cancel,submit);formNode.append(actions);formNode.addEventListener("submit",async(event)=>{event.preventDefault();submit.disabled=true;try{const result=await onSubmit(Object.fromEntries(new FormData(formNode).entries()));if(result!==false)dialog.close();}finally{submit.disabled=false;}});return formNode;},
    destroy(){dialog.remove();card.classList.remove("chat-console-card","conversation-open");}
  };
}

export const CHAT_ROOM_KIND_LABELS = ROOM_KIND_LABELS;
export const CHAT_ROLE_LABELS = ROLE_LABELS;
