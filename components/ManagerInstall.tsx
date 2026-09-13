'use client';
import { useEffect,useState } from 'react';
type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export default function ManagerInstall(){
 const [prompt,setPrompt]=useState<InstallEvent|null>(null),[help,setHelp]=useState(false),[installed,setInstalled]=useState(false);
 useEffect(()=>{setInstalled(window.matchMedia('(display-mode: standalone)').matches);const listener=(e:Event)=>{e.preventDefault();setPrompt(e as InstallEvent);};const done=()=>{setInstalled(true);setPrompt(null);};window.addEventListener('beforeinstallprompt',listener);window.addEventListener('appinstalled',done);if('serviceWorker'in navigator)navigator.serviceWorker.register('/manager-sw.js',{scope:'/'}).catch(()=>{});return()=>{window.removeEventListener('beforeinstallprompt',listener);window.removeEventListener('appinstalled',done);};},[]);
 if(installed)return null;
 return <div className="mb-5 rounded-xl border bg-white p-3 text-sm"><button className="min-h-11 font-medium" onClick={async()=>{if(prompt){await prompt.prompt();await prompt.userChoice;setPrompt(null);}else setHelp(v=>!v);}}>휴대폰 홈 화면에 설치하기</button>{help&&<p className="text-stone-600 leading-6">아이폰은 Safari의 공유 → 홈 화면에 추가, 안드로이드는 Chrome 메뉴 → 앱 설치 또는 홈 화면에 추가를 선택하세요. 기존 계정으로 로그인하며, 작업 저장에는 인터넷 연결이 필요합니다.</p>}</div>;
}
