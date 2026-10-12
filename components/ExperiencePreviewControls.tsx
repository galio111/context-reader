"use client";
import { useState } from "react";
export function ExperiencePreviewControls() {
  const [plan,setPlan]=useState("guest"),[balance,setBalance]=useState("available"),[screen,setScreen]=useState("home"),[width,setWidth]=useState("desktop"),[revision,setRevision]=useState(0);
  return <main style={{height:"100dvh",display:"flex",flexDirection:"column",background:"#edf2f5",color:"#263e4b"}}>
    <header style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",borderBottom:"1px solid #cbd8e0"}}>
      <a href="/admin">← 返回 Admin</a><strong>用户体验预览</strong>
      <label>身份 <select aria-label="预览身份" value={plan} onChange={e=>setPlan(e.target.value)}>{[["guest","游客"],["free","Free"],["basic","Basic"],["plus","Plus"],["max","Max"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>额度 <select aria-label="预览额度" value={balance} onChange={e=>setBalance(e.target.value)}><option value="available">充足</option><option value="low">不足 5%</option><option value="empty">已用完</option></select></label>
      <label>界面 <select aria-label="预览界面" value={screen} onChange={e=>setScreen(e.target.value)}><option value="home">首页与阅读</option><option value="account">账号与用量</option><option value="billing">套餐</option></select></label>
      <label>屏幕 <select aria-label="预览屏幕" value={width} onChange={e=>setWidth(e.target.value)}><option value="desktop">桌面</option><option value="mobile">手机</option></select></label>
      <button onClick={()=>setRevision(n=>n+1)}>重新开始</button>
      <small>使用正式组件与当前套餐配置；示例账号和本机数据独立，预览不生成、不保存、不支付。</small>
    </header>
    <iframe key={`${plan}:${balance}:${screen}:${revision}`} title="用户界面预览" src={`/admin/experience/frame?plan=${plan}&balance=${balance}&screen=${screen}`} style={{border:0,flex:1,minHeight:0,width:width==="mobile"?390:"100%",maxWidth:"100%",alignSelf:"center",background:"white"}} />
  </main>;
}
