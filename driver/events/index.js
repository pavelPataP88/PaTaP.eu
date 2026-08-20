import { createEventCenterUi,eventCard,CATEGORY_LABELS,PRIORITY_LABELS } from "./console.mjs?v=20260820-events1";

const CATEGORY_KEYS=["CHAT","PEOPLE","COMMUNITY","RADIO","ROAD","PARKING","SYSTEM"];
const PRIORITY_OPTIONS=[["SILENT","Все"],["NORMAL","Обычные и выше"],["IMPORTANT","Только важные и срочные"],["URGENT","Только срочные"]];

function el(tag,className="",text=""){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}
function button(text,handler,className=""){const node=el("button",className,text);node.type="button";node.addEventListener("click",handler);return node;}
function option(value,text,current){const node=document.createElement("option");node.value=value;node.textContent=text;node.selected=value===current;return node;}
function formatStatus(value){return String(value||"UNKNOWN").replaceAll("_"," ");}
function urlBase64ToUint8Array(value){const padding="=".repeat((4-value.length%4)%4);const base64=(value+padding).replaceAll("-","+").replaceAll("_","/");const raw=atob(base64);return Uint8Array.from(raw,char=>char.charCodeAt(0));}

export function createDriverModule(context){
  const ui=createEventCenterUi();
  ui.actions.hidden=true;
  let profileReady=false;
  let overview=null;
  let items=[];
  let category="ALL";
  let unreadOnly=false;
  let urgentOnly=false;
  let stream=null;
  let toast=null;
  let toastTimer=null;
  let workerRegistration=null;
  let started=false;

  function report(error,fallback="Не удалось обновить центр событий."){
    if(error?.status===401)return context.onAuthLost?.();
    context.showError?.(fallback);
  }

  function closeToast(){if(toastTimer){window.clearTimeout(toastTimer);toastTimer=null;}toast?.remove();toast=null;}
  function showToast(event,policy){
    if(!policy?.interrupt||!profileReady)return;
    closeToast();toast=el("button","event-toast");toast.type="button";toast.dataset.priority=event.priority;
    toast.append(el("strong","",event.title));
    if(overview?.preferences?.showPreviews!==false&&event.preview)toast.append(el("small","",event.preview));
    toast.addEventListener("click",()=>{closeToast();openEvent(event).catch(()=>{});});
    document.body.append(toast);
    toastTimer=window.setTimeout(closeToast,event.priority==="URGENT"?10000:6000);
  }

  function queryPath(){
    const params=new URLSearchParams();params.set("limit","60");
    if(category!=="ALL")params.set("category",category);
    if(unreadOnly)params.set("unread","1");
    if(urgentOnly)params.set("priority","URGENT");
    return `/api/driver/events?${params}`;
  }

  function render(){
    ui.list.replaceChildren();
    if(!items.length)return ui.empty(unreadOnly?"Непрочитанных событий нет.":"Здесь пока нет событий.");
    for(const item of items){
      ui.list.append(eventCard(item,{
        onOpen:event=>openEvent(event).catch(error=>report(error,"Не удалось открыть событие.")),
        onRead:async(event,read)=>{try{await context.api(`/api/driver/events/${event.id}`,{method:"PATCH",body:{read}});await refresh();}catch(error){report(error);}},
        onArchive:async event=>{try{await context.api(`/api/driver/events/${event.id}/archive`,{method:"POST",body:{}});await refresh();}catch(error){report(error);}},
        onSnooze:async(event,minutes)=>{try{await context.api(`/api/driver/events/${event.id}/snooze`,{method:"POST",body:{minutes}});await refresh();}catch(error){report(error);}},
        onMute:async event=>{try{await context.api(`/api/driver/events/sources/${encodeURIComponent(event.source.kind)}/${encodeURIComponent(event.source.id)}`,{method:"PUT",body:{mode:"MUTED"}});context.showError?.("Источник оставлен в inbox, но больше не будет отвлекать.");}catch(error){report(error);}}
      }));
    }
  }

  async function refresh({quiet=false}={}){
    if(!profileReady)return;
    try{
      overview=await context.api("/api/driver/events/overview");
      const filtered=category!=="ALL"||unreadOnly||urgentOnly;
      items=filtered?(await context.api(queryPath())).events||[]:overview.events||[];
      ui.setBadge(overview.counts);ui.state.textContent=`Непрочитано: ${overview.counts?.unread||0}`;
      ui.controls.driving.textContent=overview.preferences?.drivingMode?"За рулём ✓":"За рулём";
      await refreshPushState();render();
    }catch(error){if(!quiet)report(error);}
  }

  async function openView(view,moduleId=view){
    const module=context.getModule?.(moduleId);if(typeof module?.activate==="function")await module.activate();
    document.querySelector(`[data-driver-target="${view}"]`)?.click();
  }

  async function showDetail(title,lines,actions=[]){
    const dialog=el("dialog","event-settings-dialog");const heading=el("h3","",title);const body=el("div","event-settings");
    for(const line of lines.filter(Boolean))body.append(el("p","",String(line)));
    const buttons=el("div","event-toolbar-actions");for(const action of actions)buttons.append(action);buttons.append(button("Закрыть",()=>dialog.close()));
    dialog.append(heading,body,buttons);document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();return dialog;
  }

  async function openPeopleFilter(filter="ALL"){
    await openView("contacts","contacts");
    await new Promise(resolve=>window.setTimeout(resolve,0));
    document.querySelector(`[data-people-filter="${CSS.escape(filter)}"]`)?.click();
  }

  async function openCommunity(communityId){
    const data=await context.api(`/api/driver/people/communities/${Number(communityId)}`);const community=data.community;
    if(!community)return openPeopleFilter("COMMUNITIES");
    const actions=[button("Открыть сообщества",()=>{openPeopleFilter("COMMUNITIES");})];
    if(community.joined&&community.chatRoomId)actions.unshift(button("Чат",()=>context.openChatRoom?.(community.chatRoomId),"primary"));
    if(community.joined&&community.radioChannelId)actions.unshift(button("Рация",()=>context.openRadioChannel?.(community.radioChannelId)));
    await showDetail(community.title,[community.description,[community.category,community.countryCode,community.memberCount?`${community.memberCount} участников`:null].filter(Boolean).join(" · ")],actions);
  }

  async function openParking(placeId){
    const data=await context.api(`/api/driver/parking/places/${Number(placeId)}`);const place=data.place;if(!place)throw new Error("parking_not_found");
    const occupancy=place.occupancy?.status||"UNKNOWN";const lines=[place.address||place.road,`Статус: ${formatStatus(occupancy)}`,place.capacity?.truck!==null&&place.capacity?.truck!==undefined?`Мест TIR: ${place.capacity.truck}`:null,place.reviews?.overall?`Рейтинг: ${place.reviews.overall} / 5`:null];
    const actions=[button("Паркинги",()=>openView("parking","parking"))];
    const map=context.getModule?.("map")?.controller;
    if(map?.showParkingPlace)actions.unshift(button("На карте",async()=>{await map.showParkingPlace(place);document.querySelector('[data-driver-target="map"]')?.click();},"primary"));
    await showDetail(place.name,lines,actions);
  }

  async function openRoad(event){
    await openView("map","map");
    const route=event.route||{};
    if(Number.isFinite(Number(route.latitude))&&Number.isFinite(Number(route.longitude))){
      context.showError?.(`${event.title}: ${Number(route.latitude).toFixed(4)}, ${Number(route.longitude).toFixed(4)}`);
    }
  }

  async function openEvent(event){
    if(!event)return;
    if(!event.read){try{await context.api(`/api/driver/events/${event.id}`,{method:"PATCH",body:{read:true}});}catch{}}
    ui.drawer.close();
    const route=event.route||{};
    if(route.kind==="CHAT_ROOM"&&route.roomId)return context.openChatRoom?.(Number(route.roomId));
    if(route.kind==="RADIO_CHANNEL"&&route.channelId)return context.openRadioChannel?.(Number(route.channelId));
    if(route.kind==="DRIVER"&&route.nickname)return context.openDriverCard?.(route.nickname);
    if(route.kind==="PEOPLE_FILTER")return openPeopleFilter(route.filter||"ALL");
    if(route.kind==="COMMUNITY"&&route.communityId)return openCommunity(route.communityId);
    if(route.kind==="PARKING"&&route.placeId)return openParking(route.placeId);
    if(route.kind==="ROAD_REPORT")return openRoad(event);
    await refresh({quiet:true});
  }

  async function openEventById(eventId){
    const id=Number(eventId);if(!Number.isSafeInteger(id)||id<1)return;
    try{const data=await context.api(`/api/driver/events/${id}`);if(data.event)await openEvent(data.event);}catch(error){report(error,"Событие больше недоступно.");}
  }

  function startStream(){
    stream?.close();stream=new EventSource("/api/driver/events/stream",{withCredentials:true});
    stream.addEventListener("driver-event",message=>{
      try{
        const payload=JSON.parse(message.data);
        if(payload.type==="event.committed"){showToast(payload.event,payload.policy);refresh({quiet:true});}
        else if(payload.type==="event.counts"){ui.setBadge(payload.counts);}
        else if(payload.type==="event.ready"&&payload.counts){ui.setBadge(payload.counts);}
      }catch{}
    });
    stream.onerror=()=>{ui.state.textContent="Связь с событиями восстанавливается…";};
  }

  async function ensureWorker(){
    if(workerRegistration)return workerRegistration;
    if(!("serviceWorker" in navigator)||!(globalThis.isSecureContext||location.hostname==="127.0.0.1"||location.hostname==="localhost"))return null;
    workerRegistration=await navigator.serviceWorker.register("/event-worker.js?v=20260820-events1",{scope:"/"});
    return workerRegistration;
  }

  async function currentSubscription(){try{return (await ensureWorker())?.pushManager?.getSubscription?.()||null;}catch{return null;}}
  async function refreshPushState(){
    if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator)){ui.controls.push.textContent="Push недоступен";ui.controls.push.disabled=true;return;}
    const subscription=await currentSubscription();ui.controls.push.disabled=false;ui.controls.push.textContent=subscription?"Push ✓":"Push";
  }

  async function togglePush(){
    try{
      if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator))return context.showError?.("Web Push не поддерживается этим браузером.");
      if(Notification.permission==="default"){const permission=await Notification.requestPermission();if(permission!=="granted")return context.showError?.("Разрешение на системные уведомления не выдано.");}
      if(Notification.permission!=="granted")return context.showError?.("Системные уведомления заблокированы в настройках браузера.");
      const registration=await ensureWorker();if(!registration?.pushManager)return context.showError?.("Push Manager недоступен.");
      const existing=await registration.pushManager.getSubscription();
      if(existing){await context.api("/api/driver/events/push-subscriptions",{method:"DELETE",body:{endpoint:existing.endpoint}});await existing.unsubscribe();await refreshPushState();return;}
      const config=await context.api("/api/driver/events/push-config");if(!config.supported||!config.publicKey)return context.showError?.("Сервер Push пока недоступен.");
      const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(config.publicKey)});
      await context.api("/api/driver/events/push-subscriptions",{method:"POST",body:subscription.toJSON()});await refreshPushState();
    }catch(error){report(error,"Не удалось изменить настройку Push.");}
  }

  function checkbox(labelText,value){const label=el("label");const input=document.createElement("input");input.type="checkbox";input.checked=Boolean(value);label.append(input,el("span","",labelText));return {label,input};}
  async function openSettings(){
    if(!overview)await refresh();const pref=overview?.preferences||{};const dialog=el("dialog","event-settings-dialog"),form=el("form","event-settings"),title=el("h3","","Настройки событий");
    const enabled=checkbox("Центр событий включён",pref.enabled),driving=checkbox("Режим «За рулём» — отвлекать только срочным",pref.drivingMode),quiet=checkbox("Тихие часы",pref.quietEnabled),previews=checkbox("Показывать текст в уведомлениях",pref.showPreviews),popups=checkbox("Всплывающие уведомления внутри Driver",pref.inAppPopups);
    const times=el("div","times"),startLabel=el("label","","Начало"),endLabel=el("label","","Конец"),start=document.createElement("input"),end=document.createElement("input");start.type=end.type="time";start.value=pref.quietStart||"22:00";end.value=pref.quietEnd||"07:00";startLabel.append(start);endLabel.append(end);times.append(startLabel,endLabel);
    form.append(title,enabled.label,driving.label,quiet.label,times,previews.label,popups.label,el("h4","","Категории"));
    const categoryControls=new Map();
    for(const key of CATEGORY_KEYS){const current=overview?.categories?.[key]||{};const row=el("div","event-settings");const heading=el("strong","",CATEGORY_LABELS[key]||key);const inbox=checkbox("Хранить в inbox",current.inboxEnabled!==false),push=checkbox("Разрешить Push",current.pushEnabled!==false);const select=document.createElement("select");for(const [value,label] of PRIORITY_OPTIONS)select.append(option(value,label,current.minPriority||"NORMAL"));row.append(heading,inbox.label,push.label,select);form.append(row);categoryControls.set(key,{inbox:inbox.input,push:push.input,select});}
    const actions=el("div","event-toolbar-actions"),cancel=button("Отмена",()=>dialog.close()),save=button("Сохранить",()=>{},"primary");save.type="submit";actions.append(cancel,save);form.append(actions);dialog.append(form);document.body.append(dialog);dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{
      await context.api("/api/driver/events/preferences",{method:"PATCH",body:{enabled:enabled.input.checked,drivingMode:driving.input.checked,quietEnabled:quiet.input.checked,quietStart:start.value,quietEnd:end.value,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Warsaw",showPreviews:previews.input.checked,inAppPopups:popups.input.checked}});
      for(const [key,controls] of categoryControls)await context.api(`/api/driver/events/categories/${key}`,{method:"PATCH",body:{inboxEnabled:controls.inbox.checked,pushEnabled:controls.push.checked,minPriority:controls.select.value}});
      dialog.close();await refresh();
    }catch(error){report(error,"Не удалось сохранить настройки событий.");}finally{save.disabled=false;}});dialog.showModal();
  }

  async function toggleDriving(){
    if(!overview)return refresh();
    try{await context.api("/api/driver/events/preferences",{method:"PATCH",body:{drivingMode:!overview.preferences.drivingMode}});await refresh();}catch(error){report(error);}
  }

  ui.bell.addEventListener("click",()=>refresh({quiet:true}));
  ui.controls.settings.addEventListener("click",()=>openSettings().catch(error=>report(error)));
  ui.controls.markAll.addEventListener("click",async()=>{try{await context.api("/api/driver/events/mark-all-read",{method:"POST",body:{}});await refresh();}catch(error){report(error);}});
  ui.controls.unread.addEventListener("click",()=>{unreadOnly=!unreadOnly;ui.controls.unread.classList.toggle("primary",unreadOnly);refresh();});
  ui.controls.urgent.addEventListener("click",()=>{urgentOnly=!urgentOnly;ui.controls.urgent.classList.toggle("primary",urgentOnly);refresh();});
  ui.controls.push.addEventListener("click",togglePush);
  ui.controls.driving.addEventListener("click",toggleDriving);
  for(const [key,node] of ui.controls.filterButtons)node.addEventListener("click",()=>{category=key;ui.setFilter(key);refresh();});
  ui.setFilter(category);

  navigator.serviceWorker?.addEventListener?.("message",message=>{if(message.data?.type==="patap.event.open")openEventById(message.data.eventId);});

  async function start(){
    if(started||!profileReady)return;started=true;ui.actions.hidden=false;await ensureWorker().catch(()=>null);await refresh({quiet:true});startStream();
    const id=new URL(location.href).searchParams.get("event");if(id){history.replaceState(null,"",`${location.pathname}${location.hash||""}`);await openEventById(id);}
  }

  return {
    async setSession({profile}){profileReady=Boolean(profile);if(profileReady)await start();else ui.actions.hidden=true;},
    async setProfileReady(profile){profileReady=Boolean(profile);if(profileReady)await start();},
    async openEvent(eventId){return openEventById(eventId);},
    async reset(){profileReady=false;started=false;stream?.close();stream=null;closeToast();ui.actions.hidden=true;if(ui.drawer.open)ui.drawer.close();overview=null;items=[];ui.setBadge({});}
  };
}
