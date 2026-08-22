const VALID_PRIORITIES=new Set(['URGENT','IMPORTANT','NORMAL','SILENT']);
const VALID_CATEGORIES=new Set(['CHAT','PEOPLE','COMMUNITY','RADIO','ROAD','PARKING','SYSTEM']);

function cleanText(value,max){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function pushItem(event){
  if(!event.data)return {eventId:0,priority:'NORMAL',category:'SYSTEM',title:'PaTaP Driver',body:'Новое событие в Driver'};
  let data;try{data=event.data.json();}catch{return null;}
  const eventId=Number(data?.eventId);if(!Number.isSafeInteger(eventId)||eventId<=0)return null;
  const priority=VALID_PRIORITIES.has(String(data?.priority||'').toUpperCase())?String(data.priority).toUpperCase():'NORMAL';
  const category=VALID_CATEGORIES.has(String(data?.category||'').toUpperCase())?String(data.category).toUpperCase():'SYSTEM';
  return {eventId,priority,category,title:cleanText(data?.title,160)||'PaTaP Driver',body:cleanText(data?.body,240)||'Новое событие в Driver'};
}

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    const item=pushItem(event);if(!item)return;
    try{
      await self.registration.showNotification(item.title,{
        body:item.body,
        tag:item.eventId?`patap-event-${item.eventId}`:'patap-event-legacy',
        renotify:item.priority==='URGENT',
        requireInteraction:item.priority==='URGENT',
        silent:item.priority==='NORMAL'||item.priority==='SILENT',
        icon:'/favicon.svg',
        data:{eventId:item.eventId,url:item.eventId?`/?event=${encodeURIComponent(item.eventId)}`:'/'}
      });
    }catch{}
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const eventId=Number(event.notification.data?.eventId||0);
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const target=clients.find(client=>{try{return new URL(client.url).origin===self.location.origin;}catch{return false;}});
    if(target){
      await target.focus();
      if(eventId)target.postMessage({type:'patap.event.open',eventId});
      return;
    }
    await self.clients.openWindow(eventId?`/?event=${encodeURIComponent(eventId)}`:'/');
  })());
});
