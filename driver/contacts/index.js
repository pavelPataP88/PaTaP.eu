import { createPeopleConsoleUi } from "./console.mjs?v=20260819-people1";

const RELATION_LABELS = Object.freeze({
  STRANGER:"Незнакомый", REQUEST_SENT:"Запрос отправлен", REQUEST_INCOMING:"Входящий запрос",
  CONTACT:"Контакт", BLOCKED:"Заблокирован", SELF:"Это вы"
});
const ROLE_LABELS = Object.freeze({ OWNER:"Владелец", MODERATOR:"Модератор", MEMBER:"Участник" });
const CATEGORY_LABELS = Object.freeze({ GENERAL:"Все водители", TIR:"TIR", TAXI:"Taxi", DELIVERY:"Доставка", LOCAL:"Местное" });

function friendlyError(error) {
  const code = String(error?.message || "");
  const labels = {
    contact_requests_disabled:"Этот водитель не принимает новые запросы в контакты.",
    driver_blocked:"Связь с этим водителем заблокирована.",
    people_contact_required:"Действие доступно только для подтверждённого контакта.",
    community_invite_not_allowed:"В сообщество можно пригласить только контакт, который разрешил приглашения.",
    community_forbidden:"Недостаточно прав для этого действия.",
    community_owner_transfer_required:"Сначала передайте права владельца другому участнику.",
    community_banned:"Доступ к этому сообществу закрыт модератором.",
    community_already_member:"Водитель уже состоит в сообществе.",
    people_rate_limited:"Слишком много действий подряд. Повторите немного позже."
  };
  return labels[code] || "Не удалось выполнить действие.";
}

export function createDriverModule(context) {
  const view = document.querySelector("#contacts-view");
  const card = view?.querySelector(".card");
  const oldList = document.querySelector("#contacts-list");
  const ui = createPeopleConsoleUi({ card, list: oldList });
  let overview = null;
  let searchResults = [];
  let nearbyResults = [];
  let activated = false;
  let profileReady = false;
  let filter = "ALL";
  let refreshTimer = null;

  function report(error, fallback = null) {
    if (error?.status === 401) return context.onAuthLost?.();
    context.showError?.(fallback || friendlyError(error));
  }

  async function api(pathname, options) {
    return context.api(pathname, options);
  }

  function action(text, handler, options) {
    return ui.action(text, async (event) => {
      event.currentTarget.disabled = true;
      try { await handler(); }
      catch (error) { report(error); }
      finally { event.currentTarget.disabled = false; }
    }, options);
  }

  function personActions(person) {
    const actions = [action("Карточка", () => context.openDriverCard?.(person.nickname))];
    if (person.relationship === "REQUEST_INCOMING") {
      actions.push(action("Принять", async () => { await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/contact`, { method:"POST", body:{} }); await reload(); }, { primary:true }));
      actions.push(action("Отклонить", async () => { await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/decline`, { method:"POST", body:{} }); await reload(); }));
      return actions;
    }
    if (person.relationship === "REQUEST_SENT") {
      actions.push(action("Отменить запрос", async () => { await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/contact`, { method:"DELETE", body:{} }); await reload(); }));
      return actions;
    }
    if (person.relationship === "BLOCKED") {
      actions.push(action("Разблокировать", async () => { await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/block`, { method:"PUT", body:{enabled:false} }); await reload(); }, { primary:true }));
      return actions;
    }
    if (person.relationship === "STRANGER" && person.canRequestContact !== false) {
      actions.push(action("В контакты", async () => { await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/contact`, { method:"POST", body:{} }); await reload(); }, { primary:true }));
    }
    if (person.canChat !== false) actions.push(action("Чат", () => context.openDirectChat?.(person.nickname)));
    if (person.relationship === "CONTACT") {
      actions.push(action("Рация", () => context.openDirectRadio?.(person.nickname)));
      actions.push(action(person.favorite ? "★" : "☆", async () => { await updateContactPreference(person,{favorite:!person.favorite}); }, { primary:person.favorite }));
      actions.push(action(person.trusted ? "Доверенный ✓" : "Доверять", async () => { await updateContactPreference(person,{trusted:!person.trusted}); }));
      actions.push(action("Заметка", () => openContactNote(person)));
      actions.push(action("Удалить контакт", async () => { if (!confirm(`Удалить ${person.nickname} из контактов?`)) return; await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/contact`, { method:"DELETE", body:{} }); await reload(); }, { danger:true }));
    }
    if (person.relationship !== "SELF") actions.push(action("Блок", async () => { if (!confirm(`Заблокировать ${person.nickname}? Контакт и личные метки будут удалены.`)) return; await api(`/api/driver/drivers/${encodeURIComponent(person.nickname)}/block`, { method:"PUT", body:{enabled:true} }); await reload(); }, { danger:true }));
    return actions;
  }

  async function updateContactPreference(person, patch) {
    const data = await api(`/api/driver/people/contacts/${encodeURIComponent(person.nickname)}/preferences`, { method:"PATCH", body:patch });
    Object.assign(person, data.person || {});
    await reload({ preserveFilter:true });
  }

  function openContactNote(person) {
    const form = ui.form([{name:"privateNote",label:"Личная заметка — видна только вам",type:"textarea",maxLength:120,value:person.privateNote||""}],"Сохранить",async({privateNote})=>{
      try { await updateContactPreference(person,{privateNote}); return true; }
      catch(error){ report(error); return false; }
    });
    ui.showDialog(`Заметка · ${person.nickname}`,form);
  }

  function appendPeople(title, people) {
    if (!people?.length) return false;
    const grid = ui.section(title);
    for (const person of people) grid.append(ui.personCard(person,{actions:personActions(person)}));
    return true;
  }

  function communityActions(community) {
    const actions = [action("Открыть", () => openCommunity(community.id), { primary:true })];
    if (!community.joined && community.visibility === "PUBLIC") actions.push(action("Вступить", async()=>{await api(`/api/driver/people/communities/${community.id}/join`,{method:"POST",body:{}});await reload();}));
    if (community.joined) {
      if (community.chatRoomId) actions.push(action("Чат", () => openCommunityChat(community)));
      if (community.radioChannelId) actions.push(action("Рация", () => openCommunityRadio(community)));
      actions.push(action(community.favorite?"★":"☆",async()=>{await api(`/api/driver/people/communities/${community.id}/preferences`,{method:"PATCH",body:{favorite:!community.favorite}});await reload();}));
    }
    return actions;
  }

  function appendCommunities(title, communities) {
    if (!communities?.length) return false;
    const grid = ui.section(title);
    for (const community of communities) grid.append(ui.communityCard(community,{actions:communityActions(community)}));
    return true;
  }

  function render() {
    ui.clear();
    ui.setCounts(overview?.counts || {});
    let rendered = false;
    const groups = overview?.groups || {};
    const communities = overview?.communities || [];
    if (filter === "ALL") {
      rendered = appendPeople("Входящие запросы",groups.incoming) || rendered;
      rendered = appendPeople("Избранные",groups.favorites) || rendered;
      rendered = appendPeople("Контакты",groups.contacts) || rendered;
      rendered = appendCommunities("Мои сообщества",communities) || rendered;
    } else if (filter === "CONTACTS") rendered = appendPeople("Контакты",groups.contacts);
    else if (filter === "FAVORITES") rendered = appendPeople("Избранные",groups.favorites);
    else if (filter === "TRUSTED") rendered = appendPeople("Доверенные",groups.trusted);
    else if (filter === "REQUESTS") {
      rendered = appendPeople("Входящие",groups.incoming) || rendered;
      rendered = appendPeople("Исходящие",groups.outgoing) || rendered;
    } else if (filter === "BLOCKED") rendered = appendPeople("Заблокированные",groups.blocked);
    else if (filter === "NEARBY") rendered = appendPeople("Водители рядом",nearbyResults);
    else if (filter === "COMMUNITIES") {
      rendered = appendCommunities("Мои сообщества",communities) || rendered;
      rendered = appendCommunityInvites() || rendered;
    }
    if (searchResults.length && ["ALL","CONTACTS","FAVORITES","TRUSTED","REQUESTS","BLOCKED"].includes(filter)) rendered = appendPeople("Результаты поиска",searchResults) || rendered;
    if (!rendered) ui.empty(filter === "NEARBY" ? "Рядом пока никого не видно по вашим и их настройкам приватности." : filter === "COMMUNITIES" ? "Сообществ пока нет. Создайте своё или найдите открытое." : "Здесь пока пусто.");
  }

  function appendCommunityInvites() {
    const invites = overview?.communityInvites || [];
    if (!invites.length) return false;
    const grid = ui.section("Приглашения в сообщества");
    for (const invite of invites) {
      const pseudo = { id:invite.communityId,title:invite.title,description:invite.description,category:invite.category,countryCode:invite.countryCode,memberCount:invite.memberCount,visibility:"PRIVATE" };
      const accept = action("Принять",async()=>{await api(`/api/driver/people/community-invites/${invite.communityId}/respond`,{method:"POST",body:{action:"ACCEPT"}});await reload();},{primary:true});
      const decline = action("Отклонить",async()=>{await api(`/api/driver/people/community-invites/${invite.communityId}/respond`,{method:"POST",body:{action:"DECLINE"}});await reload();});
      grid.append(ui.communityCard(pseudo,{actions:[accept,decline]}));
    }
    return true;
  }

  async function loadOverview() {
    overview = await api("/api/driver/people/overview");
    return overview;
  }

  async function reload({preserveFilter=true}={}) {
    if (!profileReady) return;
    await loadOverview();
    if (!preserveFilter) { filter="ALL"; ui.setFilter(filter); }
    if (filter === "NEARBY") await loadNearby();
    render();
  }

  async function runSearch() {
    const query = ui.controls.searchInput.value.trim();
    const type = ui.controls.typeSelect.value;
    if (!query && !type) { searchResults=[]; return render(); }
    try {
      const data = await api(`/api/driver/people/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&limit=40`);
      searchResults = data.drivers || [];
      if (!["ALL","CONTACTS","FAVORITES","TRUSTED","REQUESTS","BLOCKED"].includes(filter)) { filter="ALL"; ui.setFilter(filter); }
      render();
    } catch(error){ report(error,"Не удалось выполнить поиск водителей."); }
  }

  async function loadNearby(radius=25) {
    try { const data=await api(`/api/driver/people/nearby?radius=${radius}`);nearbyResults=data.people||[];render(); }
    catch(error){report(error,"Не удалось загрузить водителей рядом.");}
  }

  function openSettings() {
    const settings = overview?.settings || {};
    const form = ui.form([
      {name:"discoverability",label:"Кто может найти меня по никнейму",type:"select",value:settings.discoverability,options:[["EVERYONE","Все"],["CONTACTS","Только контакты"],["HIDDEN","Никто"]]},
      {name:"nearbyVisibility",label:"Кто может видеть меня рядом и на карте",type:"select",value:settings.nearbyVisibility,options:[["EVERYONE","Все"],["CONTACTS","Контакты"],["TRUSTED","Только доверенные"],["NOBODY","Никто"]]},
      {name:"contactRequests",label:"Новые запросы в контакты",type:"select",value:settings.contactRequests,options:[["EVERYONE","Разрешить"],["NOBODY","Не принимать"]]},
      {name:"communityInvites",label:"Приглашения в сообщества",type:"select",value:settings.communityInvites,options:[["CONTACTS","От контактов"],["NOBODY","Не принимать"]]},
      {name:"vehicleVisibility",label:"Кто видит автомобиль",type:"select",value:settings.vehicleVisibility,options:[["EVERYONE","Все"],["CONTACTS","Контакты"],["NOBODY","Никто"]]}
    ],"Сохранить",async(values)=>{
      try { await api("/api/driver/people/settings",{method:"PATCH",body:values});await reload();return true; }
      catch(error){report(error,"Не удалось сохранить приватность.");return false;}
    });
    const wrap=document.createElement("div");wrap.className="people-form";const note=document.createElement("p");note.className="people-help";note.textContent="Настройка «Рядом» управляет и точными маркерами старой карты. Выключение GPS по-прежнему полностью прекращает передачу координат.";wrap.append(note,form);ui.showDialog("Приватность",wrap);
  }

  function openCommunityHub() {
    const wrap=document.createElement("div");wrap.className="people-form";
    wrap.append(ui.row("Создать сообщество","Один состав участников для сообщества, группового чата и радиоканала.",[ui.action("Создать",()=>openCreateCommunity())]));
    wrap.append(ui.row("Найти открытое","Поиск сообществ по названию и типу водителей.",[ui.action("Найти",()=>openDiscoverCommunities())]));
    wrap.append(ui.row("Приглашения",`${overview?.communityInvites?.length||0} новых`,[ui.action("Показать",()=>{filter="COMMUNITIES";ui.setFilter(filter);ui.closeDialog();render();})]));
    ui.showDialog("Сообщества",wrap);
  }

  function openCreateCommunity() {
    const form=ui.form([
      {name:"title",label:"Название",required:true,minLength:3,maxLength:48},
      {name:"description",label:"Описание",type:"textarea",maxLength:240},
      {name:"visibility",label:"Доступ",type:"select",options:[["PRIVATE","Закрытое"],["PUBLIC","Открытое"]]},
      {name:"category",label:"Тип",type:"select",options:[["GENERAL","Все водители"],["TIR","TIR"],["TAXI","Taxi"],["DELIVERY","Доставка"],["LOCAL","Местное"]]},
      {name:"countryCode",label:"Страна, ISO-2 (необязательно)",maxLength:2}
    ],"Создать",async(values)=>{
      try { const data=await api("/api/driver/people/communities",{method:"POST",body:values});await reload();if(data.community)openCommunity(data.community.id);return true; }
      catch(error){report(error,"Не удалось создать сообщество.");return false;}
    });
    ui.showDialog("Новое сообщество",form);
  }

  function openDiscoverCommunities() {
    const wrap=document.createElement("div");wrap.className="people-form";
    const search=document.createElement("input");search.type="search";search.placeholder="Название сообщества";
    const category=document.createElement("select");for(const [value,label] of [["","Все типы"],["GENERAL","Все водители"],["TIR","TIR"],["TAXI","Taxi"],["DELIVERY","Доставка"],["LOCAL","Местное"]]){const o=document.createElement("option");o.value=value;o.textContent=label;category.append(o);}
    const results=document.createElement("div");results.className="people-form";const go=ui.action("Найти",async()=>{try{const data=await api(`/api/driver/people/communities/discover?q=${encodeURIComponent(search.value.trim())}&category=${encodeURIComponent(category.value)}`);results.replaceChildren();for(const community of data.communities||[]){results.append(ui.row(community.title,`${CATEGORY_LABELS[community.category]||community.category} · ${community.memberCount} участников · ${community.description||""}`,[ui.action(community.joined?"Открыть":"Вступить",async()=>{if(!community.joined)await api(`/api/driver/people/communities/${community.id}/join`,{method:"POST",body:{}});ui.closeDialog();await reload();openCommunity(community.id);})]));}if(!results.children.length)results.textContent="Ничего не найдено.";}catch(error){report(error,"Поиск сообществ недоступен.");}});
    wrap.append(search,category,go,results);ui.showDialog("Открытые сообщества",wrap);go.click();
  }

  async function openCommunity(id) {
    try {
      const data=await api(`/api/driver/people/communities/${id}`);const community=data.community;
      if(!community)return;
      const wrap=document.createElement("div");wrap.className="people-form";
      const intro=document.createElement("p");intro.className="people-help";intro.textContent=`${community.description||"Без описания"} · ${CATEGORY_LABELS[community.category]||community.category} · ${community.memberCount} участников`;
      wrap.append(intro);
      if(community.joined){
        wrap.append(ui.row("Связь","Один состав сообщества используется в чате и рации.",[
          ui.action("Открыть чат",()=>openCommunityChat(community)),ui.action("Открыть рацию",()=>openCommunityRadio(community))
        ]));
      }
      if(!community.joined&&community.visibility==="PUBLIC")wrap.append(ui.row("Открытое сообщество","Можно вступить без приглашения.",[ui.action("Вступить",async()=>{await api(`/api/driver/people/communities/${id}/join`,{method:"POST",body:{}});ui.closeDialog();await reload();openCommunity(id);})]));
      if(community.joined&&community.canModerate)wrap.append(ui.row("Участники","Приглашения, роли и модерация.",[ui.action("Управлять",()=>openCommunityMembers(id))]));
      if(community.joined&&community.canManage)wrap.append(ui.row("Настройки","Название, описание и доступ.",[ui.action("Изменить",()=>openEditCommunity(community))]));
      if(community.joined&&community.role!=="OWNER")wrap.append(ui.row("Выйти из сообщества","Вы также покинете связанный групповой чат и радиоканал.",[ui.action("Выйти",async()=>{if(!confirm(`Выйти из «${community.title}»?`))return;await api(`/api/driver/people/communities/${id}/leave`,{method:"POST",body:{}});ui.closeDialog();await reload();},{danger:true})]));
      if(community.role==="OWNER")wrap.append(ui.row("Удалить сообщество","Удалятся связанный групповой чат и радиоканал вместе с их историей.",[ui.action("Удалить",async()=>{if(!confirm(`Полностью удалить «${community.title}»?`))return;await api(`/api/driver/people/communities/${id}`,{method:"DELETE",body:{}});ui.closeDialog();await reload();},{danger:true})]));
      ui.showDialog(community.title,wrap);
    }catch(error){report(error,"Не удалось открыть сообщество.");}
  }

  async function openCommunityMembers(id) {
    try {
      const data=await api(`/api/driver/people/communities/${id}`);const community=data.community;const wrap=document.createElement("div");wrap.className="people-form";
      if(community.canModerate)wrap.append(ui.row("Пригласить контакт","Приглашение возможно только подтверждённому контакту, если он разрешил приглашения.",[ui.action("Пригласить",()=>openCommunityInvite(id))]));
      for(const member of data.members||[]){const actions=[];if(community.canManage&&member.role!=="OWNER"){actions.push(ui.select([["MEMBER","Участник"],["MODERATOR","Модератор"],["OWNER","Передать владельца"]],member.role,async(role)=>{if(role==="OWNER"&&!confirm(`Передать владение ${member.nickname}?`))return;try{await api(`/api/driver/people/communities/${id}/members/${encodeURIComponent(member.nickname)}`,{method:"PATCH",body:{role}});ui.closeDialog();await reload();openCommunityMembers(id);}catch(error){report(error);}}));}if(community.canModerate&&member.role!=="OWNER"&&member.nickname!==overview?.selfNickname){actions.push(ui.action("Удалить",async()=>{await api(`/api/driver/people/communities/${id}/members/${encodeURIComponent(member.nickname)}`,{method:"DELETE",body:{ban:false}});ui.closeDialog();await reload();openCommunityMembers(id);},{danger:true}));actions.push(ui.action("Бан",async()=>{if(!confirm(`Заблокировать ${member.nickname} в сообществе?`))return;await api(`/api/driver/people/communities/${id}/members/${encodeURIComponent(member.nickname)}`,{method:"DELETE",body:{ban:true}});ui.closeDialog();await reload();openCommunityMembers(id);},{danger:true}));}wrap.append(ui.row(member.nickname,`${member.driverType} · ${ROLE_LABELS[member.role]||member.role}`,actions));}
      if((data.bans||[]).length){const h=document.createElement("p");h.className="people-help";h.textContent="Заблокированные в сообществе";wrap.append(h);for(const banned of data.bans)wrap.append(ui.row(banned.nickname,banned.driverType,[ui.action("Разбанить",async()=>{await api(`/api/driver/people/communities/${id}/bans/${encodeURIComponent(banned.nickname)}`,{method:"DELETE",body:{}});ui.closeDialog();openCommunityMembers(id);})]));}
      ui.showDialog(`Участники · ${community.title}`,wrap);
    }catch(error){report(error,"Не удалось загрузить участников.");}
  }

  function openCommunityInvite(id) {
    const form=ui.form([{name:"nickname",label:"Никнейм контакта",required:true,maxLength:32}],"Пригласить",async({nickname})=>{try{await api(`/api/driver/people/communities/${id}/invites`,{method:"POST",body:{nickname}});context.showError?.("Приглашение отправлено.");return true;}catch(error){report(error);return false;}});ui.showDialog("Пригласить в сообщество",form);
  }

  function openEditCommunity(community) {
    const form=ui.form([
      {name:"title",label:"Название",required:true,value:community.title,maxLength:48},
      {name:"description",label:"Описание",type:"textarea",value:community.description,maxLength:240},
      {name:"visibility",label:"Доступ",type:"select",value:community.visibility,options:[["PRIVATE","Закрытое"],["PUBLIC","Открытое"]]},
      {name:"category",label:"Тип",type:"select",value:community.category,options:[["GENERAL","Все водители"],["TIR","TIR"],["TAXI","Taxi"],["DELIVERY","Доставка"],["LOCAL","Местное"]]},
      {name:"countryCode",label:"Страна ISO-2",value:community.countryCode||"",maxLength:2}
    ],"Сохранить",async(values)=>{try{await api(`/api/driver/people/communities/${community.id}`,{method:"PATCH",body:values});await reload();return true;}catch(error){report(error);return false;}});ui.showDialog(`Настройки · ${community.title}`,form);
  }

  async function openCommunityChat(community) {
    if (!community.chatRoomId) return context.showError?.("Групповой чат недоступен.");
    if (typeof context.openChatRoom === "function") return context.openChatRoom(community.chatRoomId);
    context.showError?.("Чат сообщества создан. Откройте его в разделе «Чат».");
  }

  async function openCommunityRadio(community) {
    if (!community.radioChannelId) return context.showError?.("Радиоканал недоступен.");
    if (typeof context.openRadioChannel === "function") return context.openRadioChannel(community.radioChannelId);
    context.showError?.("Радиоканал сообщества создан. Откройте его в разделе «Рация».");
  }

  for(const [key,node] of ui.controls.filterButtons){node.addEventListener("click",async()=>{filter=key;ui.setFilter(key);if(key==="NEARBY")await loadNearby();else render();});}
  ui.controls.searchButton.addEventListener("click",runSearch);
  ui.controls.searchInput.addEventListener("keydown",(event)=>{if(event.key==="Enter"){event.preventDefault();runSearch();}});
  ui.controls.typeSelect.addEventListener("change",runSearch);
  ui.controls.settingsButton.addEventListener("click",openSettings);
  ui.controls.communitiesButton.addEventListener("click",openCommunityHub);

  return {
    async activate(){ activated=true;if(!profileReady)return;try{await reload();if(!refreshTimer)refreshTimer=window.setInterval(()=>{if(activated&&document.visibilityState==="visible")reload().catch(()=>{});},30_000);}catch(error){report(error,"Не удалось загрузить людей и сообщества.");} },
    setSession({profile}){profileReady=Boolean(profile);},
    setProfileReady(profile){profileReady=Boolean(profile);},
    async reset(){activated=false;profileReady=false;overview=null;searchResults=[];nearbyResults=[];if(refreshTimer)window.clearInterval(refreshTimer);refreshTimer=null;ui.clear();ui.empty("Сначала войдите в Driver Patap.");}
  };
}
