export const DAILY_CATEGORY_MIN=14;
export const DAILY_TOTAL_MIN=56;
export const DAILY_CATEGORIES=['时事','科技','文化','商业'] as const;
/** All four categories have a minimum; no publication count is a ceiling. */
export function distributionSatisfied(counts:Record<string,number>){return DAILY_CATEGORIES.every(k=>(counts[k]||0)>=DAILY_CATEGORY_MIN);}
