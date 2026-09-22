export const DAILY_CATEGORY_MIN=13;
export const DAILY_CATEGORY_MAX=17;
export const DAILY_TOTAL_MIN=55;
export const DAILY_TOTAL_TARGET=60;
export const DAILY_TOTAL_MAX=68;
export const DAILY_CATEGORIES=['时事','科技','文化','商业'] as const;
export function distributionSatisfied(counts:Record<string,number>){const total=DAILY_CATEGORIES.reduce((n,k)=>n+(counts[k]||0),0);return total>=DAILY_TOTAL_MIN&&total<=DAILY_TOTAL_MAX&&DAILY_CATEGORIES.every(k=>(counts[k]||0)>=DAILY_CATEGORY_MIN&&(counts[k]||0)<=DAILY_CATEGORY_MAX);}
