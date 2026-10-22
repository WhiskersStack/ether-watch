export function notificationPermission(browser=globalThis){return browser.Notification?.permission||'unsupported';}
function notificationAPI(browser){
  if(browser.isSecureContext===false)throw new Error('Notifications require a secure HTTPS connection.');
  if(!browser.Notification)throw new Error('Notifications are unavailable in this browser. Open Ether Watch in your regular browser, such as Chrome.');
  return browser.Notification;
}
export async function requestNotificationPermission(browser=globalThis,timeoutMs=30000){
  const api=notificationAPI(browser);
  if(api.permission!=='default')return api.permission;
  let timer;
  try{return await Promise.race([api.requestPermission(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('No permission response was received. Check your browser notification prompt and try again.')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
export async function showDeviceNotification(title,options={},browser=globalThis,timeoutMs=10000){
  const api=notificationAPI(browser);
  if(api.permission!=='granted')throw new Error('Allow notifications on this device first.');
  const service=browser.navigator?.serviceWorker;
  if(service?.register){
    let timer;
    try{
      await Promise.race([
        (async()=>{await service.register('/notification-worker.js',{scope:'/'});const registration=await service.ready;await registration.showNotification(title,options);})(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Notification setup timed out. Reload the page and try again.')),timeoutMs);})
      ]);
      return 'service-worker';
    }finally{clearTimeout(timer);}
  }
  new api(title,options);return 'page';
}
