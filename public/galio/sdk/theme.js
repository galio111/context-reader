/** One source for the workbench, live samples and project adapter. */
export const DEFAULT_THEME=Object.freeze({palette:'stone',font:'system',radius:12,density:'comfortable',duration:220,fontSize:16,hover:'quiet'});
export const THEME_PALETTES=Object.freeze({
  stone:{name:'石墨',accent:'#373633',soft:'#efede8',bg:'#f6f5f2',surface:'#fff',ink:'#2b2b2a',muted:'#686865',line:'#e1e1dc'},
  blue:{name:'雾蓝',accent:'#365d91',soft:'#e9eff8',bg:'#f3f5f8',surface:'#fff',ink:'#25333e',muted:'#5f6e7a',line:'#dce3e8'},
  violet:{name:'淡紫',accent:'#655184',soft:'#f0ebf6',bg:'#f6f4f8',surface:'#fff',ink:'#342c40',muted:'#73677d',line:'#e4dfe9'},
  sand:{name:'暖沙',accent:'#796046',soft:'#f3ece2',bg:'#f8f5f0',surface:'#fffefa',ink:'#3d3429',muted:'#776b5c',line:'#e5dfd5'},
});
export const THEME_FONTS=Object.freeze({
  system:'"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  humanist:'"Trebuchet MS", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  serif:'Georgia, "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif',
});
