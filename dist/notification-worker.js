// Notification display/click support only: no polling, push subscription or cache.
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL('/#alerts',self.location.origin).href;
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      if(new URL(client.url).origin===self.location.origin&&typeof client.focus==='function'){
        if(typeof client.navigate==='function')await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
