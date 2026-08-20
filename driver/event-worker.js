const PRIORITY_ORDER=Object.freeze({URGENT:3,IMPORTANT:2,NORMAL:1,SILENT:0});

async function latestEvent(){
  const response=await fetch('/api/driver/events/overview',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)return null;
  const data=await response.json();
  const events=(data.events||[]).filter(event=>!event.read&&!event.archived&&!event.snoozed);
  events.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||((PRIORITY_ORDER[b.priority]||0)-(PRIORITY_ORDER[a.priority]||0))||b.id-a.id);
  return events.length?{event:events[0],preferences:data.preferences||{}}:null;
}

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    try{
      const current=await latestEvent();
      if(!current)return;
      const item=current.event;
      const showPreview=current.preferences.showPreviews!==false;
      const body=showPreview&&item.preview?item.preview:`${item.category} · ${item.priority}`;
      await self.registration.showNotification(item.title,{
        body,
        tag:`patap-event-${item.id}`,
        renotify:item.priority==='URGENT',
        requireInteraction:item.priority==='URGENT',
        silent:item.priority==='NORMAL'||item.priority==='SILENT',
        icon:'/favicon.svg',
        data:{eventId:item.id,route:item.route||null,url:`/?event=${encodeURIComponent(item.id)}`}
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


